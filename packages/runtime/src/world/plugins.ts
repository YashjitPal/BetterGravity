import type { PluginStorageSnapshot, PluginRecord } from "../protocol.js";
import { createPluginContext, type ContextDependencies, type RegisteredPlugin } from "./context.js";

export interface HostDependencies {
  readonly persist: (pluginId: string, key: string, value: unknown) => void;
  readonly report: (message: string) => void;
  /** Exposed to plugins as the `BetterGravity` parameter. */
  readonly api: unknown;
}

export interface SyncOutcome {
  readonly started: readonly string[];
  readonly stopped: readonly string[];
}

/**
 * Runs plugins in the page's own world. Because the host lives here rather than
 * in the preload, a plugin's context can hand out real DOM utilities instead of
 * values that would have to survive serialisation across the context bridge.
 */
export class PluginHost {
  private readonly running = new Map<string, RegisteredPlugin>();

  private storage: Record<string, Record<string, unknown>> = {};

  constructor(private readonly dependencies: HostDependencies) {}

  useStorage(snapshot: PluginStorageSnapshot): void {
    this.storage = Object.fromEntries(Object.entries(snapshot).map(([id, bucket]) => [id, { ...bucket }]));
  }

  /**
   * Mirrors writes into the in-memory snapshot as well as sending them to the
   * main process, so a plugin restarted by a source edit sees the values it had
   * saved rather than the ones present when the page loaded.
   */
  private readonly persist = (pluginId: string, key: string, value: unknown): void => {
    const bucket = (this.storage[pluginId] ??= {});
    if (value === undefined) delete bucket[key];
    else bucket[key] = value;
    this.dependencies.persist(pluginId, key, value);
  };

  /** Brings the running set in line with what settings and disk now say. */
  sync(plugins: readonly PluginRecord[]): SyncOutcome {
    const started: string[] = [];
    const stopped: string[] = [];
    const desired = new Map(plugins.filter((plugin) => plugin.enabled).map((plugin) => [plugin.id, plugin]));

    for (const [id, registered] of [...this.running]) {
      const wanted = desired.get(id);
      // Editing a plugin's file restarts it, which is what makes iterating on a
      // plugin feel like editing a theme.
      const changed = wanted !== undefined && wanted.source !== registered.record.source;
      if (wanted && !changed) continue;
      this.stop(id, registered);
      stopped.push(id);
    }

    for (const plugin of desired.values()) {
      if (this.running.has(plugin.id)) continue;
      if (this.start(plugin)) started.push(plugin.id);
    }

    return { started, stopped };
  }

  listRunning(): readonly RegisteredPlugin[] {
    return [...this.running.values()];
  }

  get(id: string): RegisteredPlugin | undefined {
    return this.running.get(id);
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  private start(plugin: PluginRecord): boolean {
    const dependencies: ContextDependencies = {
      initialStorage: this.storage[plugin.id] ?? {},
      persist: this.persist,
      report: this.dependencies.report
    };
    const registered = createPluginContext(plugin, dependencies);

    try {
      // Compiled rather than injected as a script tag so the plugin's context
      // can be passed by reference instead of serialised into source text.
      const factory = new Function("BetterGravity", "plugin", "module", "exports", plugin.source);
      const module = { exports: {} as Record<string, unknown> };
      factory(this.dependencies.api, registered.context, module, module.exports);
      this.running.set(plugin.id, registered);
      return true;
    } catch (error) {
      registered.dispose();
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      this.dependencies.report(`plugin ${plugin.id} failed to start: ${detail}`);
      console.error(`[BetterGravity] Plugin ${plugin.id} threw during startup.`, error);
      return false;
    }
  }

  private stop(id: string, registered: RegisteredPlugin): void {
    try {
      registered.dispose();
    } catch (error) {
      this.dependencies.report(`plugin ${id} threw while stopping: ${String(error)}`);
    }
    this.running.delete(id);
  }
}

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

  private storage: PluginStorageSnapshot = {};

  constructor(private readonly dependencies: HostDependencies) {}

  useStorage(snapshot: PluginStorageSnapshot): void {
    this.storage = snapshot;
  }

  /** Brings the running set in line with what settings now say should run. */
  sync(plugins: readonly PluginRecord[]): SyncOutcome {
    const started: string[] = [];
    const stopped: string[] = [];
    const desired = new Set(plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id));

    for (const [id, registered] of [...this.running]) {
      if (desired.has(id)) continue;
      this.stop(id, registered);
      stopped.push(id);
    }

    for (const plugin of plugins) {
      if (!plugin.enabled || this.running.has(plugin.id)) continue;
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
      persist: this.dependencies.persist,
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

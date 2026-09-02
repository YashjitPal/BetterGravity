import type { PluginRecord } from "../protocol.js";

const PLUGIN_ATTRIBUTE = "data-bettergravity-plugin";

/**
 * Plugins need the page's own globals, so they are injected as script tags into
 * the main world rather than evaluated here in the preload's isolated world.
 *
 * Execution is one-way within a session: a plugin that has started keeps running
 * until the window reloads, because arbitrary code cannot be reliably unloaded.
 */
export class PluginHost {
  private readonly started = new Set<string>();

  start(plugins: readonly PluginRecord[]): readonly string[] {
    const launched: string[] = [];

    for (const plugin of plugins) {
      if (!plugin.enabled || this.started.has(plugin.id)) continue;
      this.started.add(plugin.id);

      const script = document.createElement("script");
      script.setAttribute(PLUGIN_ATTRIBUTE, plugin.id);
      script.textContent = wrap(plugin);
      document.documentElement.appendChild(script);
      script.remove();
      launched.push(plugin.id);
    }

    return launched;
  }

  /** Plugins enabled in settings but only able to start after a reload. */
  pending(plugins: readonly PluginRecord[]): readonly string[] {
    return plugins.filter((plugin) => !plugin.enabled && this.started.has(plugin.id)).map((plugin) => plugin.id);
  }

  isRunning(id: string): boolean {
    return this.started.has(id);
  }
}

function wrap(plugin: PluginRecord): string {
  const id = JSON.stringify(plugin.id);
  return [
    `(function(){`,
    `  var api = window.BetterGravity;`,
    `  try {`,
    `    (function(BetterGravity, module, exports){`,
    plugin.source,
    `    })(api, { exports: {} }, {});`,
    `  } catch (error) {`,
    `    console.error("[BetterGravity] Plugin " + ${id} + " threw during startup.", error);`,
    `    if (api && api.reportPluginError) api.reportPluginError(${id}, String(error));`,
    `  }`,
    `})();`
  ].join("\n");
}

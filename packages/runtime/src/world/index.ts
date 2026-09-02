import type { BetterGravityGlobal } from "@bettergravity/plugin-api";
import type { RuntimeState } from "../protocol.js";
import type { BetterGravityApi } from "./api.js";
import { resolveBridge, type RuntimeBridge } from "./bridge.js";
import { createPanel } from "./panel/index.js";
import { PluginHost } from "./plugins.js";

export type { BetterGravityApi, PluginSummary } from "./api.js";

// Keeps the implementation from drifting away from the contract that plugin
// authors compile against.
type PublicSurfaceIsHonoured = BetterGravityApi extends BetterGravityGlobal ? true : never;
const _publicSurface: PublicSurfaceIsHonoured = true;
void _publicSurface;

declare global {
  // eslint-disable-next-line no-var
  var BetterGravity: BetterGravityApi | undefined;
}

async function boot(bridge: RuntimeBridge, initial: RuntimeState): Promise<void> {
  let latest = initial;
  const listeners = new Set<(state: RuntimeState) => void>();

  const host = new PluginHost({
    persist: (pluginId, key, value) => bridge.writeStorage(pluginId, key, value),
    report: (message) => bridge.log(message),
    get api() {
      return api;
    }
  });

  const api: BetterGravityApi = {
    version: initial.version,
    hostVersion: initial.hostVersion,
    state: () => latest,
    getState: () => bridge.getState(),
    setSettings: (patch) => bridge.setSettings(patch),
    openDirectory: (key) => bridge.openDirectory(key),
    onStateChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    plugins: {
      list: () =>
        latest.plugins.map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          author: plugin.author,
          enabled: plugin.enabled,
          running: host.isRunning(plugin.id),
          schema: host.get(plugin.id)?.schema ?? {}
        })),
      isRunning: (id) => host.isRunning(id),
      getSetting: (pluginId, key) => host.get(pluginId)?.readSetting(key),
      setSetting: (pluginId, key, value) => host.get(pluginId)?.writeSetting(key, value)
    },
    panel: {
      open: () => panel.open(),
      close: () => panel.close(),
      toggle: () => panel.toggle()
    }
  };

  globalThis.BetterGravity = api;
  const panel = createPanel(api);

  const apply = (state: RuntimeState) => {
    latest = state;
    const { started, stopped } = host.sync(state.plugins);
    // A plugin in both lists was restarted by an edit to its source.
    const restarted = started.filter((id) => stopped.includes(id));
    const report = (verb: string, ids: readonly string[]) => {
      const only = ids.filter((id) => !restarted.includes(id));
      if (only.length > 0) bridge.log(`${verb} plugin(s): ${only.join(", ")}`);
    };
    if (restarted.length > 0) bridge.log(`reloaded plugin(s): ${restarted.join(", ")}`);
    report("stopped", stopped);
    report("started", started);
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        bridge.log(`a state listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  // Storage has to be in hand before the first plugin starts. Subscribing any
  // earlier lets a file-watcher broadcast start a plugin against an empty store.
  const snapshot = await bridge.readStorage().catch((error: unknown) => {
    bridge.log(`could not read plugin storage: ${String(error)}`);
    return {};
  });
  host.useStorage(snapshot);

  bridge.onStateChanged(apply);
  apply(initial);
}

const bridge = resolveBridge();
if (!bridge) {
  console.error("[BetterGravity] The runtime bridge is unavailable; plugins will not load.");
} else {
  void bridge
    .getState()
    .then((state) => boot(bridge, state))
    .catch((error: unknown) => bridge.log(`could not start the page runtime: ${String(error)}`));
}

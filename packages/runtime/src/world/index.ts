import type { BetterGravityGlobal, PluginSettingsSchema } from "@bettergravity/plugin-api";
import type { DirectoryKey, RuntimeState, SettingsPatch } from "../protocol.js";
import { resolveBridge, type RuntimeBridge } from "./bridge.js";
import { PluginHost } from "./plugins.js";

export interface PluginSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly enabled: boolean;
  readonly running: boolean;
  readonly schema: PluginSettingsSchema;
}

/** The `BetterGravity` global available to plugins and to the settings panel. */
export interface BetterGravityApi {
  readonly version: string;
  readonly hostVersion: string;
  state(): RuntimeState | undefined;
  getState(): Promise<RuntimeState>;
  setSettings(patch: SettingsPatch): Promise<RuntimeState>;
  openDirectory(key: DirectoryKey): Promise<string>;
  onStateChanged(listener: (state: RuntimeState) => void): () => void;
  plugins: {
    list(): readonly PluginSummary[];
    isRunning(id: string): boolean;
    getSetting(pluginId: string, key: string): unknown;
    setSetting(pluginId: string, key: string, value: unknown): void;
  };
}

// Keeps the implementation from drifting away from the contract that plugin
// authors compile against.
type PublicSurfaceIsHonoured = BetterGravityApi extends BetterGravityGlobal ? true : never;
const _publicSurface: PublicSurfaceIsHonoured = true;
void _publicSurface;

declare global {
  // eslint-disable-next-line no-var
  var BetterGravity: BetterGravityApi | undefined;
}

function boot(bridge: RuntimeBridge, initial: RuntimeState): void {
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
    }
  };

  globalThis.BetterGravity = api;

  const apply = (state: RuntimeState) => {
    latest = state;
    const { started, stopped } = host.sync(state.plugins);
    if (started.length > 0) bridge.log(`started plugin(s): ${started.join(", ")}`);
    if (stopped.length > 0) bridge.log(`stopped plugin(s): ${stopped.join(", ")}`);
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        bridge.log(`a state listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  bridge.onStateChanged(apply);

  void bridge
    .readStorage()
    .then((snapshot) => {
      host.useStorage(snapshot);
      apply(initial);
    })
    .catch((error: unknown) => bridge.log(`could not read plugin storage: ${String(error)}`));
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

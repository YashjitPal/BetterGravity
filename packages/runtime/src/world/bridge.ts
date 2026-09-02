import type { DirectoryKey, PluginStorageSnapshot, RuntimeState, SettingsPatch } from "../protocol.js";

/**
 * The surface the preload exposes across the context bridge. Only JSON crosses
 * it — DOM nodes and live objects cannot be serialised between worlds, which is
 * exactly why plugins run in the page's own world instead of in the preload.
 */
export interface RuntimeBridge {
  getState(): Promise<RuntimeState>;
  setSettings(patch: SettingsPatch): Promise<RuntimeState>;
  openDirectory(key: DirectoryKey): Promise<string>;
  readStorage(): Promise<PluginStorageSnapshot>;
  writeStorage(pluginId: string, key: string, value: unknown): void;
  log(message: string): void;
  onStateChanged(listener: (state: RuntimeState) => void): void;
}

export const BRIDGE_GLOBAL = "__betterGravityBridge";

export function resolveBridge(): RuntimeBridge | undefined {
  return (globalThis as unknown as Record<string, RuntimeBridge | undefined>)[BRIDGE_GLOBAL];
}

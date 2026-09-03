import type { ContentKind, ContentResult, DirectoryKey, PluginStorageSnapshot, RuntimeState, SettingsPatch } from "../protocol.js";

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
  importThemes(): Promise<ContentResult>;
  importPlugin(): Promise<ContentResult>;
  installThemeText(fileName: string, css: string): Promise<ContentResult>;
  removeItem(kind: ContentKind, id: string, label: string): Promise<ContentResult>;
  revealItem(kind: ContentKind, id: string): Promise<ContentResult>;
  log(message: string): void;
  onStateChanged(listener: (state: RuntimeState) => void): void;
}

export const BRIDGE_GLOBAL = "__betterGravityBridge";

export function resolveBridge(): RuntimeBridge | undefined {
  return (globalThis as unknown as Record<string, RuntimeBridge | undefined>)[BRIDGE_GLOBAL];
}

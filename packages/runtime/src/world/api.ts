import type { PluginSettingsSchema } from "@bettergravity/plugin-api";
import type { DirectoryKey, RuntimeState, SettingsPatch } from "../protocol.js";

export interface PluginSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly enabled: boolean;
  /** Enabled plugins are running unless they threw while starting. */
  readonly running: boolean;
  /** Empty until the plugin has started and declared its options. */
  readonly schema: PluginSettingsSchema;
}

/** The `BetterGravity` global, shared by plugins and by the settings panel. */
export interface BetterGravityApi {
  readonly version: string;
  readonly hostVersion: string;
  state(): RuntimeState | undefined;
  getState(): Promise<RuntimeState>;
  setSettings(patch: SettingsPatch): Promise<RuntimeState>;
  openDirectory(key: DirectoryKey): Promise<string>;
  onStateChanged(listener: (state: RuntimeState) => void): () => void;
  readonly plugins: {
    list(): readonly PluginSummary[];
    isRunning(id: string): boolean;
    getSetting(pluginId: string, key: string): unknown;
    setSetting(pluginId: string, key: string, value: unknown): void;
  };
  readonly panel: {
    open(): void;
    close(): void;
    toggle(): void;
  };
}

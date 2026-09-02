/**
 * The contract between the runtime's main-process half and its preload half.
 * Both sides import from here so a channel or payload can never drift.
 */

export const CHANNEL = {
  getState: "bettergravity:get-state",
  setSettings: "bettergravity:set-settings",
  openDirectory: "bettergravity:open-directory",
  stateChanged: "bettergravity:state-changed",
  readStorage: "bettergravity:read-storage",
  writeStorage: "bettergravity:write-storage",
  log: "bettergravity:log"
} as const;

/** Persisted per-plugin key/value data, keyed by plugin id. */
export type PluginStorageSnapshot = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export type DirectoryKey = "themes" | "plugins" | "root";

export interface RuntimeContext {
  readonly version: string;
  readonly hostVersion: string;
  readonly runtimeDirectory: string;
}

export interface ThemeRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly author: string;
  readonly version: string;
  readonly source?: string;
  readonly css: string;
  readonly enabled: boolean;
}

export interface PluginRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly source: string;
  readonly enabled: boolean;
}

export interface RuntimeSettings {
  readonly schemaVersion: 1;
  readonly themes: { readonly enabled: readonly string[] };
  readonly plugins: {
    /**
     * Plugins execute real code in the page. Loading them from disk stays off
     * until the user deliberately turns it on.
     */
    readonly developerMode: boolean;
    readonly enabled: readonly string[];
  };
  /**
   * Whether to reapply the patch after Antigravity updates itself. Antigravity
   * replaces app.asar during an update, which removes BetterGravity entirely.
   */
  readonly reapplyAfterHostUpdate: boolean;
}

/** A theme or plugin that could not be loaded, surfaced instead of swallowed. */
export interface RuntimeDiagnostic {
  readonly source: string;
  readonly message: string;
}

export interface RuntimeState {
  readonly version: string;
  readonly hostVersion: string;
  readonly directories: Record<DirectoryKey, string>;
  readonly settings: RuntimeSettings;
  readonly themes: readonly ThemeRecord[];
  readonly plugins: readonly PluginRecord[];
  readonly diagnostics: readonly RuntimeDiagnostic[];
}

/** Partial update accepted by the settings channel. */
export interface SettingsPatch {
  readonly themes?: { readonly enabled?: readonly string[] };
  readonly plugins?: {
    readonly developerMode?: boolean;
    readonly enabled?: readonly string[];
  };
  readonly reapplyAfterHostUpdate?: boolean;
}

export const DEFAULT_SETTINGS: RuntimeSettings = {
  schemaVersion: 1,
  themes: { enabled: [] },
  plugins: { developerMode: false, enabled: [] },
  reapplyAfterHostUpdate: true
};

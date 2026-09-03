/**
 * The contract between the runtime's main-process half and its preload half.
 * Both sides import from here so a channel or payload can never drift.
 */

import type { CatalogEntry } from "@bettergravity/marketplace";

export type { CatalogEntry, CatalogFile } from "@bettergravity/marketplace";

export const CHANNEL = {
  getState: "bettergravity:get-state",
  setSettings: "bettergravity:set-settings",
  openDirectory: "bettergravity:open-directory",
  stateChanged: "bettergravity:state-changed",
  readStorage: "bettergravity:read-storage",
  writeStorage: "bettergravity:write-storage",
  importThemes: "bettergravity:import-themes",
  importThemeFolder: "bettergravity:import-theme-folder",
  importPlugin: "bettergravity:import-plugin",
  installThemeText: "bettergravity:install-theme-text",
  removeItem: "bettergravity:remove-item",
  revealItem: "bettergravity:reveal-item",
  fetchCatalog: "bettergravity:fetch-catalog",
  installFromCatalog: "bettergravity:install-from-catalog",
  presenceOpen: "bettergravity:presence-open",
  presenceUpdate: "bettergravity:presence-update",
  presenceClose: "bettergravity:presence-close",
  presenceStatus: "bettergravity:presence-status",
  log: "bettergravity:log"
} as const;

export type ContentKind = "theme" | "plugin";

/** Outcome of adding or removing content, phrased for display. */
export interface ContentResult {
  readonly ok: boolean;
  /** Absent when the user simply cancelled the dialog. */
  readonly message?: string;
}

/**
 * The community catalog, read on demand rather than polled. `cached` says the
 * answer came from a recent fetch, which is what lets the panel show a
 * refresh control that means something.
 */
export interface CatalogResult {
  readonly ok: boolean;
  readonly entries?: readonly CatalogEntry[];
  readonly cached?: boolean;
  readonly message?: string;
}

/**
 * What a plugin asks Discord to show. Deliberately not Discord's own shape —
 * the main process translates it — so a plugin never has to know the wire
 * format, and the format can change without touching plugins.
 */
export interface PresenceActivity {
  /** The first line under the application name. */
  readonly details?: string;
  /** The second line. */
  readonly state?: string;
  /** Epoch milliseconds. Discord counts up from it without further updates. */
  readonly startedAt?: number;
  readonly endsAt?: number;
  /** An asset key uploaded to the Discord application, or an image URL. */
  readonly largeImage?: string;
  readonly largeText?: string;
  readonly smallImage?: string;
  readonly smallText?: string;
}

export type PresencePhase = "off" | "connecting" | "connected" | "unavailable";

export interface PresenceStatus {
  readonly phase: PresencePhase;
  /** The signed-in Discord account, once connected. */
  readonly user?: string;
  /** Why the phase is what it is, phrased for display. */
  readonly message?: string;
}

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
  /** Ready to inject. For a folder theme this is the folded result, not the entry file. */
  readonly css: string;
  /** A folder with a theme.css rather than a single .css file. */
  readonly folder: boolean;
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

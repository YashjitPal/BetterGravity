/**
 * The public contract a BetterGravity plugin is written against.
 *
 * A plugin is a folder containing `plugin.json` and an entry script. The script
 * runs in Antigravity's own page with two values in scope:
 *
 *   BetterGravity  the shared runtime api
 *   plugin         this plugin's context, typed as PluginContext below
 *
 * Nothing here executes; this package is types only, so plugin authors can
 * depend on it without shipping any runtime weight.
 */

export interface PluginManifest {
  /** Taken from the folder name, so it is unique within an installation. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface SettingBase {
  readonly label: string;
  readonly description?: string;
}

export type PluginSetting =
  | (SettingBase & { readonly type: "boolean"; readonly default: boolean })
  | (SettingBase & { readonly type: "string"; readonly default: string; readonly placeholder?: string })
  | (SettingBase & { readonly type: "number"; readonly default: number; readonly min?: number; readonly max?: number })
  | (SettingBase & {
      readonly type: "select";
      readonly default: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    });

export type PluginSettingsSchema = Readonly<Record<string, PluginSetting>>;

/** The value type a single declared setting holds. */
export type SettingValue<Setting extends PluginSetting> = Setting extends { type: "boolean" }
  ? boolean
  : Setting extends { type: "number" }
    ? number
    : Setting extends { type: "select"; options: readonly { value: infer Option }[] }
      ? Option
      : string;

/**
 * Live view over a plugin's settings. Reading a property returns the current
 * value, and assigning to one persists it and notifies listeners.
 */
export type SettingsAccessor<Schema extends PluginSettingsSchema> = {
  [Key in keyof Schema]: SettingValue<Schema[Key]>;
};

export interface PluginSettingsApi {
  /**
   * Declares the options this plugin exposes and returns a typed accessor for
   * them. Call once during startup; the BetterGravity settings panel renders
   * whatever is registered here.
   */
  define<Schema extends PluginSettingsSchema>(schema: Schema): SettingsAccessor<Schema>;
  /** Dynamic access, for keys that are not known at author time. */
  get<Value = unknown>(key: string): Value;
  set(key: string, value: unknown): void;
  /** Fires when a value changes, including from the settings panel. */
  onChange(listener: (key: string, value: unknown) => void): () => void;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface PluginLogger {
  info(...parts: readonly unknown[]): void;
  warn(...parts: readonly unknown[]): void;
  error(...parts: readonly unknown[]): void;
}

/**
 * Values are read synchronously from a snapshot loaded before the plugin starts
 * and written through to disk in the background.
 */
export interface PluginStorage {
  get<Value>(key: string, fallback: Value): Value;
  get<Value>(key: string): Value | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  keys(): readonly string[];
}

export interface PluginStyles {
  /** Injects CSS scoped to this plugin. Returns a function that removes it. */
  add(css: string): () => void;
}

export interface WaitForOptions {
  /** Milliseconds before the promise rejects. Defaults to 10000. */
  readonly timeout?: number;
  /** Root to search within. Defaults to `document`. */
  readonly within?: ParentNode;
}

/**
 * Antigravity's interface is a single-page app that rebuilds its DOM
 * constantly, so plugins need to react to elements appearing rather than query
 * once at startup.
 */
export interface PluginDom {
  /** Resolves as soon as a matching element exists. */
  waitFor<Element_ extends Element = Element>(selector: string, options?: WaitForOptions): Promise<Element_>;
  /**
   * Calls back for every current and future match. Each element is delivered
   * once. Returns a function that stops observing.
   */
  observe<Element_ extends Element = Element>(selector: string, onMatch: (element: Element_) => void): () => void;
}

/**
 * The `BetterGravity` global, shared by every plugin and by the settings panel.
 * Plugin-specific capabilities live on the `plugin` context instead.
 */
export interface BetterGravityGlobal {
  readonly version: string;
  readonly hostVersion: string;
  /** Opens `themes`, `plugins`, or `root` in the system file browser. */
  openDirectory(key: "themes" | "plugins" | "root"): Promise<string>;
  onStateChanged(listener: (state: unknown) => void): () => void;
  readonly plugins: {
    isRunning(id: string): boolean;
  };
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly log: PluginLogger;
  readonly storage: PluginStorage;
  readonly settings: PluginSettingsApi;
  readonly styles: PluginStyles;
  readonly dom: PluginDom;
  /**
   * Registers cleanup to run when the plugin is disabled. Injected code cannot
   * be truly unloaded, so this is how a plugin undoes its own visible effects.
   */
  onDispose(cleanup: () => void): void;
}

/**
 * The public contract a BetterGravity plugin is written against.
 *
 * A plugin is a folder containing `plugin.json` and an entry script. The script
 * runs in Antigravity's own page with two values in scope:
 *
 *   BetterGravity  the shared runtime api
 *   plugin         this plugin's context, typed as PluginContext below
 *
 * The manifest may also list stylesheets under `styles`; they are injected for
 * as long as the plugin is enabled, so a plugin that is mostly a look keeps its
 * CSS in .css files rather than in a string.
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
  | (SettingBase & {
      readonly type: "string";
      readonly default: string;
      readonly placeholder?: string;
      /**
       * Renders as a password field and is never shown in full, for values like
       * an API key. It is still stored in plain text with the plugin's other
       * settings; this hides it from someone looking at the screen, nothing more.
       */
      readonly secret?: boolean;
    })
  | (SettingBase & { readonly type: "number"; readonly default: number; readonly min?: number; readonly max?: number })
  | (SettingBase & {
      readonly type: "select";
      readonly default: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    })
  | (SettingBase & {
      readonly type: "palette";
      readonly default: string;
      readonly options: readonly { readonly value: string; readonly label: string; readonly hex: string }[];
    })
  | (SettingBase & {
      /** A button rather than a value: nothing is stored for this key. */
      readonly type: "action";
      /** Text on the button. */
      readonly action: string;
      /** Awaited. A returned string is shown in the panel as a notice. */
      onSelect(): void | string | Promise<void | string>;
    })
  | (SettingBase & {
      /** Read-only text rather than a value: nothing is stored for this key. */
      readonly type: "note";
      /** Called each time the panel renders, so it can report live state. */
      read(): string;
    });

export type PluginSettingsSchema = Readonly<Record<string, PluginSetting>>;

/** Rows that are a control or a readout, and so hold no stored value. */
export type ValuelessSetting = { readonly type: "action" } | { readonly type: "note" };

/** The value type a single declared setting holds. */
export type SettingValue<Setting extends PluginSetting> = Setting extends ValuelessSetting
  ? never
  : Setting extends { type: "boolean" }
    ? boolean
    : Setting extends { type: "number" }
      ? number
      : Setting extends { type: "select"; options: readonly { value: infer Option }[] }
        ? Option
        : Setting extends { type: "palette"; options: readonly { value: infer Option }[] }
          ? Option
          : string;

/**
 * Live view over a plugin's settings. Reading a property returns the current
 * value, and assigning to one persists it and notifies listeners. Action and
 * note rows are left out, since they hold nothing to read or write.
 */
export type SettingsAccessor<Schema extends PluginSettingsSchema> = {
  [Key in keyof Schema as Schema[Key] extends ValuelessSetting ? never : Key]: SettingValue<Schema[Key]>;
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
  /** The BetterGravity settings panel, also reachable with Ctrl+Shift+G. */
  readonly panel: {
    open(): void;
    close(): void;
    toggle(): void;
  };
}

// ---------------------------------------------------------------------------
// Reaching into Antigravity itself
// ---------------------------------------------------------------------------

export type Unpatch = () => void;

export interface PatchContext {
  readonly self: unknown;
  /** Mutable: changing entries changes what the original receives. */
  readonly args: unknown[];
}

export interface AfterContext extends PatchContext {
  readonly result: unknown;
}

/**
 * Intercepts methods on any object a plugin can reach. Antigravity's bundle is
 * compiled with Closure Compiler, so there is no module registry to search and
 * identifiers are mangled; this works on whatever you can get hold of, usually
 * through the React tree or a global.
 */
export interface PluginPatcher {
  /** Runs before the original. Mutate `context.args` to change its input. */
  before(target: object, method: string, hook: (context: PatchContext) => void): Unpatch;
  /** Runs after the original. Return a value to replace its result. */
  after(target: object, method: string, hook: (context: AfterContext) => unknown): Unpatch;
  /** Replaces the original. Call the supplied function to run it anyway. */
  instead(
    target: object,
    method: string,
    hook: (context: PatchContext, original: (...args: unknown[]) => unknown) => unknown
  ): Unpatch;
}

export interface ReactFiber {
  readonly type: unknown;
  readonly key: string | null;
  readonly stateNode: unknown;
  readonly return: ReactFiber | null;
  readonly child: ReactFiber | null;
  readonly sibling: ReactFiber | null;
  readonly memoizedProps: Record<string, unknown> | null;
  readonly memoizedState: unknown;
}

/**
 * Antigravity's component names are mangled by its compiler, so searching by
 * name is useless. Search by props instead — `data-testid` is the most stable
 * handle the application offers.
 */
export interface PluginReact {
  getFiber(node: Element): ReactFiber | undefined;
  getProps(node: Element): Record<string, unknown> | undefined;
  findOwner(from: ReactFiber | Element, predicate: (fiber: ReactFiber) => boolean, depth?: number): ReactFiber | undefined;
  findChild(from: ReactFiber | Element, predicate: (fiber: ReactFiber) => boolean, depth?: number): ReactFiber | undefined;
  findAll(from: ReactFiber | Element, predicate: (fiber: ReactFiber) => boolean, depth?: number): readonly ReactFiber[];
  hasProps(fiber: ReactFiber, props: Readonly<Record<string, unknown>>): boolean;
  forceUpdate(fiber: ReactFiber): boolean;
  getInstance(fiber: ReactFiber): Record<string, unknown> | undefined;
}

export type FetchMiddleware = (request: Request, next: (request: Request) => Promise<Response>) => Promise<Response>;

/**
 * Antigravity talks to a local language server over connect-rpc. Plugins are
 * started before the application's own scripts, so these see its traffic from
 * the beginning. Bodies are protobuf rather than JSON.
 */
export interface PluginNetwork {
  /**
   * Wraps every fetch the page makes. Call `next` to continue, or return your
   * own Response to answer without touching the network.
   */
  onFetch(middleware: FetchMiddleware): Unpatch;
  onWebSocket(handler: (event: { readonly url: string; readonly socket: WebSocket }) => void): Unpatch;
  onRequest(handler: (method: string, url: string) => void): Unpatch;
}

// ---------------------------------------------------------------------------
// Adding to Antigravity's interface
// ---------------------------------------------------------------------------

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastAction {
  readonly label: string;
  onSelect(): void;
}

export interface ToastOptions {
  readonly title: string;
  readonly body?: string;
  readonly kind?: ToastKind;
  /** Milliseconds until it dismisses itself. 0 keeps it until dismissed. */
  readonly duration?: number;
  readonly actions?: readonly ToastAction[];
}

export interface ToastHandle {
  dismiss(): void;
}

/**
 * Material Symbols path data on a `0 -960 960 960` viewBox, which is the set
 * and the box Antigravity draws its own icons from. `ICONS` carries a few.
 */
export type IconPath = string;

export interface MenuItemSpec {
  readonly label: string;
  readonly icon?: IconPath;
  readonly disabled?: boolean;
  /** Renders in the host's destructive colour, as its own delete entries do. */
  readonly danger?: boolean;
  onSelect(): void;
}

/**
 * A menu Antigravity has just opened. Component names are mangled, so a menu is
 * identified by the `data-testid`s of the entries the host put in it.
 */
export interface MenuContext {
  readonly element: HTMLElement;
  readonly testids: readonly string[];
  readonly labels: readonly string[];
  has(testid: string): boolean;
  /** The control the menu was opened from, where it can be determined. */
  readonly trigger: HTMLElement | undefined;
  close(): void;
}

/** Return the entries to add, or nothing to leave the menu alone. */
export type MenuContributor = (menu: MenuContext) => readonly MenuItemSpec[] | undefined;

/**
 * `titleBar` is the strip beside the window's menus; `sidebar` is the column of
 * full-width actions above the conversation list.
 */
export type ButtonArea = "titleBar" | "sidebar";

export interface ButtonSpec {
  readonly area: ButtonArea;
  readonly label: string;
  readonly icon?: IconPath;
  readonly tooltip?: string;
  onClick(event: MouseEvent): void;
}

export interface ButtonHandle {
  /** Replaced whenever the host rebuilds its toolbar, so read it each time. */
  readonly element: HTMLElement | undefined;
  setLabel(label: string): void;
  setActive(active: boolean): void;
  remove(): void;
}

export interface ModalOptions {
  readonly title: string;
  readonly description?: string;
  /** Fills the dialog's body. Call `close` to dismiss it from inside. */
  render(body: HTMLElement, close: () => void): void;
  /** Maximum width in pixels. Defaults to 520. */
  readonly width?: number;
  onClose?(): void;
}

export interface ModalHandle {
  close(): void;
}

export interface SettingsSectionOptions {
  /** Appears in Antigravity's settings sidebar, under the built-in entries. */
  readonly label: string;
  /** Called with an empty container each time the section is shown. */
  render(container: HTMLElement): void;
}

export interface SettingsSectionHandle {
  /** Re-runs `render` if the section is currently on screen. */
  refresh(): void;
  remove(): void;
}

/**
 * Antigravity styles itself with utility classes over CSS custom properties.
 * These are its own class strings, so UI built with them inherits the app's
 * theme and spacing — including when the user switches Antigravity themes.
 */
export interface HostClasses {
  readonly button: string;
  readonly buttonQuiet: string;
  readonly card: string;
  readonly input: string;
  readonly menu: string;
  readonly menuItem: string;
  readonly separator: string;
  readonly title: string;
  readonly subtitle: string;
  readonly row: string;
  readonly group: string;
  readonly groupHeading: string;
}

/**
 * Places a plugin's own controls in Antigravity's interface, using the host's
 * markup so they are indistinguishable from its own. Every registration is
 * undone when the plugin is disabled.
 */
export interface PluginUi {
  /** Shows a message in Antigravity's own toast area. */
  toast(options: ToastOptions): ToastHandle;
  /** Adds entries to the host's menus as it opens them. */
  contextMenu(contributor: MenuContributor): Unpatch;
  /** Adds a button to a toolbar, re-adding it if the host rebuilds. */
  button(spec: ButtonSpec): ButtonHandle;
  /** Opens a dialog centred over the app. */
  modal(options: ModalOptions): ModalHandle;
  /** Gives the plugin its own entry in Antigravity's settings sidebar. */
  settingsSection(options: SettingsSectionOptions): SettingsSectionHandle;
  /** Builds an element from a tag, attributes, and children. */
  element(tag: string, attributes?: Readonly<Record<string, unknown>>, children?: readonly (Node | string)[]): HTMLElement;
  /** Renders a Material Symbols path as an SVG matching the host's icons. */
  icon(path: IconPath, size?: number): SVGElement;
  readonly classes: HostClasses;
  /** A few Material Symbols paths, for menu entries and toolbar buttons. */
  readonly icons: Readonly<Record<IconName, IconPath>>;
}

export type IconName =
  | "gear"
  | "folder"
  | "trash"
  | "copy"
  | "star"
  | "download"
  | "refresh"
  | "plus"
  | "check"
  | "close"
  | "info"
  | "warning"
  | "error";

/** What Discord shows while the presence is set. Every field is optional. */
export interface PresenceActivity {
  /** The first line under the application name. */
  readonly details?: string;
  /** The second line. */
  readonly state?: string;
  /**
   * Epoch milliseconds. Discord counts up from it by itself, so a running
   * timer needs one update rather than one per second.
   */
  readonly startedAt?: number;
  readonly endsAt?: number;
  /** An art asset key from the Discord application, or an image URL. */
  readonly largeImage?: string;
  /** Tooltip for the large image. */
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

/**
 * Drives Discord Rich Presence through the main process, which owns the socket
 * because reaching it needs Node and the page does not have it.
 *
 * `unavailable` is the ordinary state when Discord is closed, not an error;
 * the runtime keeps retrying and reports `connected` when it comes back, so a
 * plugin can set an activity once and leave it.
 */
export interface PluginPresence {
  /** Points the connection at a Discord application id. Safe to call repeatedly. */
  open(clientId: string): Promise<PresenceStatus>;
  /** Passing nothing clears the presence but stays connected. */
  update(activity?: PresenceActivity): Promise<PresenceStatus>;
  /** Disconnects and lets Discord drop the presence. */
  close(): Promise<PresenceStatus>;
  status(): PresenceStatus;
  onStatusChanged(listener: (status: PresenceStatus) => void): Unpatch;
}

/**
 * `off` — no key configured, the plugin asked to be bypassed, or the plugin has
 * been switched off and requests are being forwarded untranslated.
 * `listening` — the translator is up but Antigravity's language server is still
 * talking to Google directly, so it has to be restarted.
 * `routing` — the language server is pointed at the translator.
 * `blocked` — something is wrong with the translator, described by `message`; the
 * usual case is a trust store that would not take its certificate.
 */
export type GeminiPhase = "off" | "listening" | "routing" | "blocked";

export interface GeminiCounts {
  /** Requests answered with the user's own key. */
  readonly translated: number;
  /** Requests handed to Google unchanged, on the host's own credentials. */
  readonly passedThrough: number;
  readonly failed: number;
}

export interface GeminiStatus {
  readonly phase: GeminiPhase;
  /** Loopback port the translator listens on, once it is up. */
  readonly port?: number;
  /** Whether a key is configured. Never the key itself. */
  readonly keyed: boolean;
  /** Whether the generated authority is in this account's trust store. */
  readonly trusted: boolean;
  /** SHA-1 thumbprint of that authority, so it can be found by hand. */
  readonly thumbprint?: string;
  /**
   * Whether restarting Antigravity would change anything: the translator is
   * serving and the language server that is running is not using it. The endpoint
   * is an argument to a process that has already started, so nothing else can
   * redirect it.
   */
  readonly restartRequired: boolean;
  readonly message?: string;
  readonly counts: GeminiCounts;
}

export interface GeminiConfig {
  /**
   * A Google AI Studio key. It is held in the main process and sent to the API
   * below; it is never written to a log, and never leaves the machine anywhere
   * else.
   */
  readonly apiKey?: string;
  /**
   * Where the translated requests go, as an origin with an optional path —
   * `https://generativelanguage.googleapis.com` when empty or unreadable. The
   * standard `/v1beta/...` path is appended, so anything that speaks the public
   * Gemini API works. `http://` is accepted for loopback addresses only, since
   * off this machine it would put the key on the wire in clear text.
   */
  readonly baseUrl?: string;
  /** Streams replies as they arrive rather than answering in one piece. Default true. */
  readonly stream?: boolean;
  /** Passes the model's own thinking through to the interface. Default true. */
  readonly thoughts?: boolean;
  /** Leaves Antigravity on its bundled subscription while staying installed. */
  readonly bypass?: boolean;
  /** Records one redacted line per request under the runtime directory. */
  readonly audit?: boolean;
}

export interface GeminiKeyTest {
  readonly ok: boolean;
  /** How the API answered, phrased for display. */
  readonly message: string;
  /** How many models the key can reach, when it works. */
  readonly models?: number;
}

/**
 * Routes Antigravity's model traffic through the user's own Gemini API key.
 *
 * The work is in the main process: it serves a loopback HTTPS endpoint,
 * translates between Antigravity's internal protocol and the public Gemini API,
 * and rewrites the language server's endpoint argument as it starts. A plugin
 * only supplies the key and the preferences, and reads the status back.
 *
 * Requires the plugin's manifest to declare `"gemini": true`, because the
 * endpoint has to be in place before the language server starts, which is
 * before any plugin runs.
 *
 * The certificate is not part of this interface on purpose. The language server
 * will only talk to the translator over a certificate the platform trusts, so
 * the runtime installs its own authority into the current user's store while a
 * plugin declares the flag — no administrator rights, nothing outside this
 * account — and removes it again when none does. A plugin has nothing to decide
 * there, and a user has nothing to press.
 */
export interface PluginGemini {
  /** Supplies the key and preferences. Safe to call repeatedly. */
  configure(config: GeminiConfig): Promise<GeminiStatus>;
  status(): GeminiStatus;
  /** Asks the API what the configured key can see, changing nothing. */
  test(): Promise<GeminiKeyTest>;
  onStatusChanged(listener: (status: GeminiStatus) => void): Unpatch;
}

/**
 * The name on the Google account Antigravity is signed in with. Both fields are
 * absent when it cannot be read — no name, rather than a guessed one.
 *
 * There is no address and no identifier here on purpose. This is for addressing
 * the user by name, and the runtime does not hand a plugin the account the user
 * signs in with.
 */
export interface AccountProfile {
  /** Google's own `given_name` — "Ada" in "Ada Lovelace". */
  readonly firstName?: string;
  readonly fullName?: string;
  readonly email?: string;
  readonly pictureUrl?: string;
}

/**
 * Who is signed in, for an interface that greets the user by name.
 *
 * Antigravity itself knows only the address the user signed in with, so the name
 * is read from the Chromium profile it signs into Google through, which needs the
 * main process: the page cannot read files. The answer is cached for the life of
 * the page and shared by every plugin, so calling this on every render is fine.
 */
export interface PluginAccount {
  read(): Promise<AccountProfile>;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly log: PluginLogger;
  readonly storage: PluginStorage;
  readonly settings: PluginSettingsApi;
  readonly styles: PluginStyles;
  readonly dom: PluginDom;
  readonly patcher: PluginPatcher;
  readonly react: PluginReact;
  readonly net: PluginNetwork;
  readonly ui: PluginUi;
  readonly presence: PluginPresence;
  readonly gemini: PluginGemini;
  readonly account: PluginAccount;
  /**
   * Registers cleanup to run when the plugin is disabled. Injected code cannot
   * be truly unloaded, so this is how a plugin undoes its own visible effects.
   */
  onDispose(cleanup: () => void): void;
}

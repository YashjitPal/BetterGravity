# Plugin API reference

Everything below is available to a plugin's entry script. For a guided
introduction, start with [making a plugin](plugins.md).

Types come from [`@bettergravity/plugin-api`](../packages/plugin-api/src/index.ts).

## `plugin`

This plugin's own capabilities.

### `plugin.manifest`

```ts
readonly manifest: {
  readonly id: string;          // the folder name
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
};
```

### `plugin.log`

Writes to `runtime.log`, prefixed with your plugin's id.

```ts
plugin.log.info(...parts: unknown[]): void;
plugin.log.warn(...parts: unknown[]): void;
plugin.log.error(...parts: unknown[]): void;
```

### `plugin.storage`

Persists across restarts. Reads are synchronous, from a snapshot loaded before
the plugin starts; writes go to disk in the background.

```ts
plugin.storage.get<Value>(key: string, fallback: Value): Value;
plugin.storage.get<Value>(key: string): Value | undefined;
plugin.storage.set(key: string, value: unknown): void;
plugin.storage.delete(key: string): void;
plugin.storage.keys(): readonly string[];
```

Values must survive `JSON.stringify`. `keys()` excludes anything backing a
declared setting.

### `plugin.settings`

```ts
plugin.settings.define(schema): SettingsAccessor;
plugin.settings.get<Value>(key: string): Value;
plugin.settings.set(key: string, value: unknown): void;
plugin.settings.onChange(listener: (key, value) => void): () => void;
```

`define` returns a live view: reading a property gives the current value,
assigning to one saves it and notifies listeners.

```ts
const settings = plugin.settings.define({
  compact: { type: "boolean", label: "Compact mode", default: false }
});

settings.compact;        // boolean
settings.compact = true; // saved, listeners fire
```

Setting shapes:

```ts
{ type: "boolean", label, description?, default: boolean }
{ type: "string",  label, description?, default: string, placeholder?, secret? }
{ type: "number",  label, description?, default: number, min?, max? }
{ type: "select",  label, description?, default: string,
  options: readonly { value: string; label: string }[] }
{ type: "action",  label, description?, action: string,
  onSelect(): void | string | Promise<void | string> }
{ type: "note",    label, description?, read(): string }
```

A `select` declared with `as const` narrows to the literal union of its option
values.

`secret` renders a string as a password field, for something like an API key. It
is still stored in plain text with the plugin's other settings — this hides it
from someone looking at the screen, nothing more.

`action` and `note` rows hold no value, so they are absent from the accessor
`define` returns. An `action` is a button; whatever `onSelect` returns as a
string is shown in the panel as a notice. A `note` is read-only text, and `read`
is called every time the panel renders, so it can report live state.

### `plugin.styles`

```ts
plugin.styles.add(css: string): () => void;
```

Injects CSS scoped to this plugin and returns a remover. Everything added is
removed when the plugin stops, so calling the remover yourself is optional.

### `plugin.dom`

Antigravity's UI rebuilds constantly, so these exist instead of querying once.

```ts
plugin.dom.waitFor<E extends Element>(
  selector: string,
  options?: { timeout?: number; within?: ParentNode }
): Promise<E>;

plugin.dom.observe<E extends Element>(
  selector: string,
  onMatch: (element: E) => void
): () => void;
```

`waitFor` resolves immediately if a match already exists, and rejects after
`timeout` (default 10000 ms).

`observe` calls back for every current and future match, delivering each element
exactly once. Both stop automatically when the plugin stops.

### `plugin.patcher`

Intercepts a method on any object you can reach. See
[reaching into Antigravity](advanced.md#patching-functions).

```ts
plugin.patcher.before(target: object, method: string, hook: (context) => void): Unpatch;
plugin.patcher.after(target: object, method: string, hook: (context) => unknown): Unpatch;
plugin.patcher.instead(target: object, method: string, hook: (context, original) => unknown): Unpatch;
```

`context.args` is mutable, so a `before` hook changes what the original
receives. Returning a value from an `after` hook replaces the result. Hooks run
in registration order, a throwing hook is contained, and every patch is removed
when the plugin stops.

### `plugin.react`

Reads Antigravity's React tree. Component names are mangled by its compiler, so
search by props rather than by name.

```ts
plugin.react.getFiber(node: Element): ReactFiber | undefined;
plugin.react.getProps(node: Element): Record<string, unknown> | undefined;
plugin.react.findOwner(from, predicate, depth?): ReactFiber | undefined;
plugin.react.findChild(from, predicate, depth?): ReactFiber | undefined;
plugin.react.findAll(from, predicate, depth?): readonly ReactFiber[];
plugin.react.hasProps(fiber, props): boolean;
plugin.react.forceUpdate(fiber): boolean;
plugin.react.getInstance(fiber): Record<string, unknown> | undefined;
```

`from` accepts a DOM element or a fiber. `findChild` searches breadth-first, so
the nearest match wins. `depth` defaults to 30.

### `plugin.net`

Watches and rewrites what the page sends. Plugins start before Antigravity's own
scripts, so this sees its traffic from the first request.

```ts
plugin.net.onFetch(middleware: FetchMiddleware): Unpatch;
plugin.net.onWebSocket(handler: (event: { url: string; socket: WebSocket }) => void): Unpatch;
plugin.net.onRequest(handler: (method: string, url: string) => void): Unpatch;

type FetchMiddleware = (request: Request, next: (request: Request) => Promise<Response>) => Promise<Response>;
```

Call `next` to continue, or return your own `Response` to answer without
touching the network. Middleware runs in registration order.

Antigravity uses connect-rpc, so the service and method are in the URL path and
are **not** minified. Bodies are protobuf. See
[the language server, by name](advanced.md#the-language-server-by-name).

### `plugin.ui`

Puts a plugin's own controls into Antigravity's interface, built from the host's
own class names. See [adding to Antigravity's interface](interface.md).

```ts
plugin.ui.toast(options: ToastOptions): ToastHandle;
plugin.ui.contextMenu(contributor: MenuContributor): Unpatch;
plugin.ui.button(spec: ButtonSpec): ButtonHandle;
plugin.ui.modal(options: ModalOptions): ModalHandle;
plugin.ui.settingsSection(options: SettingsSectionOptions): SettingsSectionHandle;

plugin.ui.element(tag: string, attributes?, children?): HTMLElement;
plugin.ui.icon(path: string, size?: number): SVGElement;
readonly classes: HostClasses;   // the host's class strings
readonly icons: Record<IconName, string>;
```

```ts
type ToastOptions = {
  title: string;
  body?: string;
  kind?: "info" | "success" | "warning" | "error";
  duration?: number;             // 0 keeps it until dismissed
  actions?: readonly { label: string; onSelect(): void }[];
};

type MenuContributor = (menu: MenuContext) => readonly MenuItemSpec[] | undefined;

type MenuContext = {
  element: HTMLElement;
  testids: readonly string[];    // the host's own entries, which identify the menu
  labels: readonly string[];
  has(testid: string): boolean;
  trigger: HTMLElement | undefined;
  close(): void;
};

type MenuItemSpec = { label: string; icon?: string; disabled?: boolean; danger?: boolean; onSelect(): void };

type ButtonSpec = { area: "titleBar" | "sidebar"; label: string; icon?: string; tooltip?: string; onClick(event: MouseEvent): void };
type ButtonHandle = { element: HTMLElement | undefined; setLabel(label): void; setActive(active): void; remove(): void };

type ModalOptions = { title: string; description?: string; width?: number; render(body: HTMLElement, close: () => void): void; onClose?(): void };
type SettingsSectionOptions = { label: string; render(container: HTMLElement): void };
```

Identify a menu with `menu.has(testid)`; component names are mangled but
`data-testid` values survive. `ButtonHandle.element` changes whenever the host
rebuilds its toolbar, so read it rather than holding on to it. Every
registration is undone when the plugin stops.

### `plugin.presence`

Drives Discord Rich Presence. See [Discord Rich Presence](presence.md) for the
setup a working presence needs.

```ts
plugin.presence.open(clientId: string): Promise<PresenceStatus>;
plugin.presence.update(activity?: PresenceActivity): Promise<PresenceStatus>;
plugin.presence.close(): Promise<PresenceStatus>;
plugin.presence.status(): PresenceStatus;
plugin.presence.onStatusChanged(listener: (status: PresenceStatus) => void): Unpatch;
```

```ts
type PresenceActivity = {
  details?: string;              // the first line under the application name
  state?: string;                // the second line
  startedAt?: number;            // epoch ms; Discord counts up from it itself
  endsAt?: number;
  largeImage?: string;           // an art asset key, or an image URL
  largeText?: string;
  smallImage?: string;
  smallText?: string;
};

type PresenceStatus = {
  phase: "off" | "connecting" | "connected" | "unavailable";
  user?: string;                 // the signed-in account, once connected
  message?: string;
};
```

Unlike the rest of the API this is not the page doing the work. Discord's
transports are a local socket, which needs Node, and a WebSocket that checks the
`Origin` header against a list registered on the application — and Antigravity's
origin carries a port that changes every launch, so no registered origin would
keep matching. The main process therefore owns the socket, and it dials
Discord's own socket names and nothing else, so this is not a general outbound
socket for plugins.

`unavailable` is the ordinary state when Discord is closed rather than an error.
The runtime reconnects on its own and reports `connected` when Discord returns,
so a plugin can set an activity once and leave it. Do re-send on `connected`
though: Discord drops whatever it was showing when the socket went away.

Updates are spaced out to stay inside Discord's rate limit, and a change made
inside that window is delayed rather than dropped, so the last activity a plugin
asks for is always the one that ends up displayed. `startedAt` means an elapsed
timer needs one update rather than one per second.

### `plugin.gemini`

Routes Antigravity's chat through the user's own Gemini API key. See
[a Gemini key of your own](gemini-key.md) for what the feature does and the setup
it needs.

```ts
plugin.gemini.configure(config: GeminiConfig): Promise<GeminiStatus>;
plugin.gemini.status(): GeminiStatus;
plugin.gemini.test(): Promise<GeminiKeyTest>;
plugin.gemini.onStatusChanged(listener: (status: GeminiStatus) => void): Unpatch;
```

```ts
type GeminiConfig = {
  apiKey?: string;               // held in the main process, sent upstream only
  baseUrl?: string;              // where the key is spent; Google's own API when empty
  stream?: boolean;              // default true
  thoughts?: boolean;            // pass the model's thinking through; default true
  bypass?: boolean;              // stay installed, forward untranslated
  audit?: boolean;               // one redacted line per request
};

type GeminiStatus = {
  phase: "off" | "listening" | "routing" | "blocked";
  port?: number;                 // the loopback port, once it is up
  keyed: boolean;                // whether a key is set — never the key
  trusted: boolean;              // whether the authority is in the trust store
  thumbprint?: string;           // SHA-1, so it can be found by hand
  restartRequired: boolean;
  message?: string;
  counts: { translated: number; passedThrough: number; failed: number };
};

type GeminiKeyTest = { ok: boolean; message: string; models?: number };
```

The manifest must declare `"gemini": true`. The work is all in the main process —
a loopback HTTPS listener, a translation between Antigravity's internal protocol
and the public Gemini API, and a rewrite of the language server's endpoint
argument as it is spawned — and that has to be in place before the language
server starts, which is before any plugin script exists to ask for it. The
manifest flag is what arms it at launch, from the settings saved last time; a
plugin supplies the key and the preferences and reads the status back.

There is one translator, so if several enabled plugins declare the flag, one of
them supplies the settings that arm it and `runtime.log` says which. The others
still see the same status and can still configure it.

`baseUrl` is an origin, optionally with a path, and the standard `/v1beta/...` is
appended to it: `https://relay.example/gemini` is asked for
`https://relay.example/gemini/v1beta/models/...`. Empty means Google's own API.
`http://` is accepted for loopback only, since anywhere else it would put the key
on the wire in clear text. A value that cannot be read is not an error a plugin
has to handle — requests go to Google and `message` says why, so a typed-in
address can never cost the user their chat. `test()` uses the same address, which
makes it the diagnostic for one that does not work.

The key never appears in a status, a log line, or the request log, so anything a
plugin displays is safe to display.

The certificate is not a plugin's business, and deliberately not part of this
interface. The language server refuses an untrusted handshake, so the runtime adds
its own authority to `Cert:\CurrentUser\Root` while an enabled plugin declares the
flag and removes it at the first launch where none does. Until it is in there the
endpoint argument is left as Antigravity wrote it, because taking chat away
entirely is worse than leaving it with Google. `trusted` says where that has got
to; on anything but Windows it stays false and `message` says why.

Switching a plugin off is followed too: the translator forwards untranslated from
that moment, so chat is back on the bundled subscription without a restart, and
`configure()` from a plugin that has been switched on again resumes translating.

`restartRequired` is what a panel would say out loud: the endpoint is an argument
to a process that is already running, so a plugin switched on mid-session cannot
redirect the language server that is already talking to Google. Clearing the key
needs no restart, though — the listener forwards requests untouched when there is
no key, so being routed costs nothing.

### `plugin.account`

The name on the Google account Antigravity is signed in with, for a plugin that
wants to greet the user by it.

```ts
plugin.account.read(): Promise<AccountProfile>;
```

```ts
type AccountProfile = {
  firstName?: string;   // Google's own given name — "Ada" in "Ada Lovelace"
  fullName?: string;
};
```

A name and nothing else. No address, no identifier, no picture: this crosses to
the page, where every plugin can read it, and a name is what greeting the user
takes.

Both fields are absent when Google's record cannot be read — an empty object, not
a name guessed from an address. So treat a missing name as the ordinary case and
fall back on wording that does not need one, the way Antigravity's own screens do.

Antigravity does not know the name. Its own state has the address the user signed
in with and no display name anywhere; the name is in the Chromium profile
Antigravity signs into Google through, which only the main process can read. So
the answer comes back over IPC and `read()` is asynchronous.

One read serves the whole page, however many plugins ask and however often, since
Google's record does not change between two calls in the same session. A read that
fails is not remembered, so a profile being rewritten as the page loads is asked
again rather than held wrong until the next reload.

### `plugin.onDispose`

```ts
plugin.onDispose(cleanup: () => void): void;
```

Runs when the plugin is switched off. Injected code cannot be truly unloaded, so
this is how a plugin undoes its own visible effects.

## `BetterGravity`

Shared by every plugin and by the settings section.

```ts
readonly version: string;      // BetterGravity's version
readonly hostVersion: string;  // Antigravity's version

openDirectory(key: "themes" | "plugins" | "root"): Promise<string>;
onStateChanged(listener: (state) => void): () => void;

readonly plugins: {
  isRunning(id: string): boolean;
};

readonly panel: {
  open(): void;    // opens Antigravity's settings on the BetterGravity section
  close(): void;
  toggle(): void;
};
```

## Lifecycle

1. BetterGravity reads your folder and, with developer mode on, loads the entry
   script.
2. The script is compiled and run once with `plugin` and `BetterGravity` in
   scope. There is no exported entry point to define.
3. Editing the file stops the plugin, runs its cleanups, and starts the new
   version.
4. Switching it off runs its cleanups and removes its styles and observers.

A plugin that throws while starting is contained and reported; others keep
running.

## Limits

- Plugin folders are read only when developer mode is on.
- An entry script above 4 MB is skipped.
- `main` cannot resolve outside the plugin's own folder.
- Storage values must be JSON-serialisable.

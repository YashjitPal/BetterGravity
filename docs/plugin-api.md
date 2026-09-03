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
{ type: "string",  label, description?, default: string, placeholder? }
{ type: "number",  label, description?, default: number, min?, max? }
{ type: "select",  label, description?, default: string,
  options: readonly { value: string; label: string }[] }
```

A `select` declared with `as const` narrows to the literal union of its option
values.

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

# Making a plugin

A plugin is a folder with a manifest and a script. Plain JavaScript, no build
step — but you still get full type checking and editor completion by copying one
file.

For the complete surface, see the [plugin API reference](plugin-api.md).

## Before you start

**Plugins run real code inside Antigravity**, in the same page your source code
and credentials appear in. Because of that, loading them is off until you turn
on **Developer mode** on the Plugins tab of BetterGravity's settings.

Only enable plugins you have written or read.

## Your first plugin

Open **Settings → BetterGravity**, press **Open folder** next to Plugins, and
make a folder called `hello`:

```text
hello/
├── plugin.json
└── index.js
```

```json
{
  "name": "Hello",
  "description": "My first BetterGravity plugin.",
  "version": "1.0.0",
  "author": "your name",
  "main": "index.js"
}
```

```js
plugin.log.info("hello from a plugin");

const badge = document.createElement("div");
badge.textContent = "Hello";
badge.style.cssText = "position:fixed;bottom:14px;left:14px;z-index:2147483000";
document.body.appendChild(badge);

plugin.onDispose(() => badge.remove());
```

Turn on Developer mode, then switch the plugin on. It starts immediately.

**Editing the file restarts the plugin**, so iterating feels like editing a
theme. Switching it off runs your cleanups.

## The manifest

| Field | Meaning |
| --- | --- |
| `name` | Shown in settings. Falls back to the folder name. |
| `description` | One line under the name. |
| `version` | Shown beside the author. |
| `author` | Shown beside the version. |
| `main` | Entry script. Defaults to `index.js`. |

The folder name is the plugin's id, so it must be unique. `main` is resolved
relative to the folder and cannot point outside it.

## Type checking, without TypeScript

Copy
[`globals.d.ts`](../examples/plugins/session-timer/globals.d.ts) next to your
script and add a `tsconfig.json` with `checkJs`. You get completion and errors
on plain `.js` files, including on your own settings schema.

The example plugin is type-checked this way in CI, so the types are proven
against the format people actually write.

## What is in scope

| Value | What it is |
| --- | --- |
| `plugin` | This plugin's own capabilities |
| `BetterGravity` | The shared runtime, common to every plugin |

## Reacting to the interface

Antigravity's UI is a single-page application that rebuilds its DOM constantly,
so a plugin that queries once at startup usually finds nothing. Use these:

```js
// Resolves as soon as a match exists.
const box = await plugin.dom.waitFor('[data-testid="agent-input-box"]');

// Called for every current and future match, each element exactly once.
plugin.dom.observe('[data-testid="conversation-row-sidebar"]', (row) => {
  row.dataset.seen = "true";
});
```

Both clean themselves up when the plugin is switched off.

Antigravity ships around a hundred `data-testid` attributes, which are far more
stable than its Tailwind classes. The [theme guide](themes.md#target-components-by-test-id)
lists the common ones.

## Settings

Declare your options once and you get a typed, live view of them. Whatever you
register appears behind the gear beside your plugin in Antigravity's settings,
rendered with Antigravity's own controls.

```js
const settings = plugin.settings.define({
  showSeconds: {
    type: "boolean",
    label: "Show seconds",
    description: "Include seconds in the readout.",
    default: false
  },
  corner: {
    type: "select",
    label: "Corner",
    default: "bottom-right",
    options: [
      { value: "bottom-right", label: "Bottom right" },
      { value: "bottom-left", label: "Bottom left" }
    ]
  }
});

settings.showSeconds;            // reads the current value
settings.corner = "bottom-left"; // saves it
```

Supported types are `boolean`, `string`, `number`, and `select`.

## Saving data

```js
plugin.storage.set("count", 3);   // persists across restarts
plugin.storage.get("count", 0);   // reads synchronously
```

Values are read from a snapshot loaded before your plugin starts, so reads are
synchronous, and written through to disk in the background.

## Styling from a plugin

```js
const remove = plugin.styles.add(`
  .my-plugin-badge { color: var(--primary); }
`);
```

Styles added this way are removed automatically when the plugin stops, so a
plugin that needs both look and behaviour does not also need a theme.

## Cleaning up

```js
plugin.onDispose(() => {
  // Runs when the plugin is switched off.
});
```

Anything registered through `plugin.dom`, `plugin.styles`, or `plugin.onDispose`
is torn down for you. Anything else — a global you set, a listener you added
directly — needs a restart to undo.

## When something goes wrong

A plugin that throws while starting is caught, reported, and skipped. Other
plugins keep running, and Antigravity is unaffected.

`runtime.log` in `%APPDATA%\BetterGravity` records every plugin that failed to
load and why, along with anything you send to `plugin.log`. The **Problems** tab
in settings shows the same failures.

If the runtime itself fails, Antigravity starts as though BetterGravity were not
installed. Nothing you write can stop the editor from opening.

## A complete example

[`examples/plugins/session-timer`](../examples/plugins/session-timer) exercises
the whole surface: settings, storage, styles, DOM work, and cleanup.

## Sharing a plugin

Share the folder however you like — installing one is **Add plugin** in
BetterGravity's settings.

To have it listed for everyone, submit it to
[`community/plugins/`](../community/plugins) as a pull request. Because a plugin
is arbitrary code running beside your source and credentials, the point of
keeping submissions in the repository is that somebody reads them before anyone
runs them, and the diff stays public afterwards.

Keep it readable, avoid minified or generated code, and say what it does. The
rules are in [the community README](../community/README.md), and
`pnpm community:check` runs the same validation CI does.

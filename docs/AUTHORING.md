# Authoring themes and plugins

Everything you make lives in your Antigravity installation under
`resources/.bettergravity/`. That folder survives uninstalling BetterGravity, so
your work is never destroyed by a repatch.

```text
resources/.bettergravity/
├── themes/           your .css files
├── plugins/          one folder per plugin
├── settings.json     which themes and plugins are turned on
├── storage.json      data plugins have saved
└── runtime.log       what the runtime did, and anything that failed
```

Working examples of both live in [`examples/`](../examples).

## Themes

A theme is a single `.css` file dropped into `themes/`. The file name is its id.
Save the file and Antigravity restyles immediately — no build step, no reload.

Metadata goes in a comment at the top, so a theme stays one portable file:

```css
/**
 * @name        Midnight
 * @description A calm dark theme.
 * @author      your name
 * @version     1.0.0
 * @source      https://github.com/you/midnight
 */

:root {
  --my-accent: #7c5cff;
}
```

Every annotation is optional. Without a `@name`, the file name is used.

Themes are pure styling. They cannot read files, reach the network, or observe
what you type, which is why they load without any developer-mode gate.

### One quirk worth knowing

Antigravity's UI does not render pseudo-elements on the `html` element. Use
`body::before` or `body::after` instead. Everything else behaves normally.

### Limits

A theme file above 2 MB is skipped, and the reason is written to `runtime.log`.

## Plugins

A plugin is a folder in `plugins/` containing a `plugin.json` manifest and an
entry script. The folder name is the plugin's id.

```text
plugins/session-timer/
├── plugin.json
└── index.js
```

```json
{
  "name": "Session Timer",
  "description": "Shows how long this session has been running.",
  "version": "1.0.0",
  "author": "your name",
  "main": "index.js"
}
```

`main` is resolved relative to the plugin folder and cannot point outside it.

### What is in scope

Your entry script runs with two values available:

| Value | What it is |
| --- | --- |
| `plugin` | This plugin's own capabilities |
| `BetterGravity` | The shared runtime, common to every plugin |

For editor completion and type checking, copy
[`globals.d.ts`](../examples/plugins/session-timer/globals.d.ts) next to your
script. It works for plain JavaScript — no build step required.

### The plugin context

```js
plugin.log.info("hello");                    // goes to runtime.log
plugin.manifest.version;                     // "1.0.0"

plugin.storage.set("count", 3);              // persists across restarts
plugin.storage.get("count", 0);              // reads synchronously

const remove = plugin.styles.add("body {}"); // scoped CSS, removed on disable
plugin.onDispose(() => { /* cleanup */ });   // runs when the plugin is turned off
```

### Reacting to the interface

Antigravity's UI is a single-page app that rebuilds its DOM constantly, so a
plugin that queries once at startup usually finds nothing. Use these instead:

```js
// Resolves as soon as a match exists.
const composer = await plugin.dom.waitFor(".composer", { timeout: 5000 });

// Called for every current and future match, each element exactly once.
plugin.dom.observe(".message", (element) => {
  element.dataset.seen = "true";
});
```

Both clean themselves up automatically when the plugin is disabled.

### Settings

Declare your options once and you get a typed, live view of them. The
BetterGravity settings panel renders whatever you register here.

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

settings.showSeconds;          // reads the current value
settings.corner = "bottom-left"; // saves it

plugin.settings.onChange((key, value) => {
  // Also fires when the user changes something in the settings panel.
});
```

Supported types are `boolean`, `string`, `number`, and `select`.

### Developer mode

Plugins run real JavaScript inside Antigravity, in the same page your source
code and credentials are displayed in. Because of that, **plugin loading stays
off until you turn on developer mode**, either in the settings panel or in
`settings.json`:

```json
{
  "plugins": { "developerMode": true, "enabled": ["session-timer"] }
}
```

Enabling a plugin starts it immediately. Disabling one runs its `onDispose`
cleanups, removes its styles, and disconnects its observers. Anything a plugin
did that it did not register cleanup for needs a restart to undo.

## When something does not work

`runtime.log` records every theme and plugin that failed to load and why. A
plugin that throws while starting is contained, reported there, and skipped —
other plugins keep running.

If the runtime itself fails, Antigravity starts as if BetterGravity were never
installed. That is deliberate: nothing you author can stop your IDE from
launching.

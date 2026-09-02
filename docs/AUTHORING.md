# Authoring themes and plugins

Everything you make lives in your Antigravity installation under
`resources/.bettergravity/`. That folder survives uninstalling BetterGravity, so
your work is never destroyed by a repatch.

```text
resources/.bettergravity/
├── themes/           your .css files
├── plugins/          one folder per plugin
├── settings.json     which themes and plugins are turned on
└── runtime.log       what the runtime did, and anything that failed
```

## Themes

A theme is a single `.css` file dropped into `themes/`. The file name is its id.
Save the file and Antigravity restyles immediately — there is no build step and
no reload.

```css
/* themes/midnight.css */
:root {
  --bg-accent: #7c5cff;
}

body::after {
  content: "midnight";
  position: fixed;
  right: 14px;
  bottom: 14px;
}
```

Themes are pure styling. They cannot read files, reach the network, or observe
what you type, which is why they load without any developer-mode gate.

### One quirk worth knowing

Antigravity's UI does not render pseudo-elements on the `html` element. Use
`body::after` rather than `html::after`. Everything else behaves normally.

### Limits

A theme file above 2 MB is skipped and the reason is written to `runtime.log`.

## Plugins

A plugin is a folder in `plugins/` containing a `plugin.json` manifest and an
entry script.

```text
plugins/word-count/
├── plugin.json
└── index.js
```

```json
{
  "name": "Word Count",
  "description": "Counts words in the composer.",
  "version": "1.0.0",
  "author": "your name",
  "main": "index.js"
}
```

```js
// index.js — BetterGravity is injected as a parameter.
console.log("Word Count starting on Antigravity", BetterGravity.currentState()?.hostVersion);

BetterGravity.onStateChanged((state) => {
  console.log("settings changed", state.settings);
});
```

The folder name is the plugin's id, so it must be unique. `main` is resolved
relative to the plugin folder and cannot point outside it.

### Developer mode

Plugins run real JavaScript inside Antigravity, with access to the same page
your source code and credentials are displayed in. Because of that, **plugin
loading is off until you turn on developer mode**, either in BetterGravity's
settings panel or by editing `settings.json`:

```json
{
  "plugins": { "developerMode": true, "enabled": ["word-count"] }
}
```

Enabling a plugin starts it immediately. Disabling one stops it from starting
next time — it cannot be torn out of a running page, so restart Antigravity to
fully unload it.

### What plugins can do today

| Call | What it does |
| --- | --- |
| `BetterGravity.currentState()` | Last known runtime state, read synchronously |
| `BetterGravity.getState()` | Fetches fresh state from the main process |
| `BetterGravity.setSettings(patch)` | Turns themes or plugins on and off |
| `BetterGravity.onStateChanged(fn)` | Subscribes to changes; returns an unsubscribe function |
| `BetterGravity.openDirectory(key)` | Opens `themes`, `plugins`, or `root` in Explorer |

Plugins run in the page's main world, so they can also reach the DOM and
anything Antigravity exposes on `window`.

## When something does not work

`runtime.log` in `resources/.bettergravity/` records every theme and plugin that
failed to load and why. A plugin that throws while starting is caught and
reported there; it cannot prevent Antigravity from opening.

If the runtime itself fails, Antigravity starts as if BetterGravity were not
installed. That is deliberate — nothing you author can stop your IDE from
launching.

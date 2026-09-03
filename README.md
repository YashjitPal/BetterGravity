<div align="center">

# BetterGravity

**Themes and plugins for [Google Antigravity](https://antigravity.google).**

Settings that live inside Antigravity, not beside it. Drop in a `.css` file and
the interface restyles instantly. Write a plugin in plain JavaScript with no
build step.

[![Checks](https://github.com/YashjitPal/BetterGravity/actions/workflows/ci.yml/badge.svg)](https://github.com/YashjitPal/BetterGravity/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Antigravity 2.x](https://img.shields.io/badge/Antigravity-2.x-FFC799)](https://antigravity.google)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4)](docs/installation.md)

[Install](docs/installation.md) · [Make a theme](docs/themes.md) ·
[Make a plugin](docs/plugins.md) · [How it works](docs/architecture.md)

<img src="docs/images/settings.png" alt="The BetterGravity section inside Antigravity's settings" width="720">

</div>

---

## What it does

|  | |
| --- | --- |
| **Themes** | One `.css` file. Save it and Antigravity restyles immediately — no build step, no reload. Around twenty design tokens recolour the entire app. |
| **Plugins** | A folder with a manifest and a script. Persistent storage, declarative settings, scoped styles, and DOM helpers built for a UI that constantly re-renders. |
| **Interface hooks** | Add toasts, entries in Antigravity's menus, toolbar buttons, dialogs, and a settings screen of your own — built from the app's own components. See [adding to Antigravity's interface](docs/interface.md). |
| **Deeper hooks** | Patch Antigravity's own functions, read its React tree, intercept its language-server traffic by RPC method name, and rewrite its bundle before it runs. See [reaching into Antigravity](docs/advanced.md). |
| **Native settings** | BetterGravity appears in Antigravity's own settings sidebar, using Antigravity's own components — so it follows your theme automatically. |
| **Survives updates** | Antigravity replaces its own program files when it updates, which removes BetterGravity. It is put back for you. |
| **Fully reversible** | The original bundle is kept beside the patched one. Uninstall restores it byte for byte and keeps your content. |

## Install

Windows, Antigravity 2.x.

Download the installer from [releases](https://github.com/YashjitPal/BetterGravity/releases),
run it, press **Install**. Then open Antigravity and find **BetterGravity** in
Settings.

Full instructions and troubleshooting are in the
[installation guide](docs/installation.md).

## A theme in ten seconds

```css
/**
 * @name Neon
 * @author you
 */

:root {
  --primary: #22d3ee !important;
  --background: #16091f !important;
}

[data-testid="agent-input-box"] {
  border: 2px solid #7c5cff !important;
  border-radius: 18px !important;
}
```

Drop it on the BetterGravity settings page, or put it in the themes folder.
Switch it on.

> `!important` matters: Antigravity applies its theme as inline custom
> properties, so ordinary rules lose. The [theme guide](docs/themes.md) explains
> what else is reachable, including how to replace the app's own animations.

## A plugin in twenty

```js
plugin.log.info("started");

const settings = plugin.settings.define({
  greeting: { type: "string", label: "Greeting", default: "Hello" }
});

plugin.dom.observe('[data-testid="conversation-row-sidebar"]', (row) => {
  row.title = settings.greeting;
});
```

With a `plugin.json` beside it, that is a complete plugin. Turn on developer
mode, switch it on, and editing the file reloads it live.

Plain JavaScript gets full type checking and editor completion by copying one
[`globals.d.ts`](examples/plugins/session-timer/globals.d.ts) — no TypeScript
required. See [making a plugin](docs/plugins.md).

## How it works

Antigravity is not a normal Electron app, and that shapes everything here. Its
`app.asar` is a small launcher: it starts a native language server and points a
window at `https://127.0.0.1:<port>`, so **the entire interface is a web app
served over loopback**. There are no UI files on disk to patch.

So BetterGravity injects at runtime instead. The installer swaps `app.asar` for
a small bootstrap and keeps the original as `_app.asar`. The bootstrap restores
Antigravity's identity, starts the BetterGravity runtime, and hands control to
the original entry point. If anything in the runtime fails, it is caught and
Antigravity starts exactly as it would without BetterGravity.

**Nothing you install can stop your editor from opening.**

[Architecture](docs/architecture.md) goes into detail.

## Safety

The installer is privileged code that modifies an application on your machine.
It keeps timestamped backups, verifies every step, refuses host versions it has
not been tested against, and never deletes your content.

Plugins are the opposite: untrusted code running in the same page as your source
and credentials. **Plugin loading is off until you turn on developer mode**, and
the settings page says exactly why. Themes are plain CSS and carry no such risk,
so they load freely.

Found a vulnerability? See the [security policy](SECURITY.md).

## Repository

```text
apps/installer          The Windows installer: Electron shell and its UI
packages/patcher        Patching, verification, uninstall, update guardian
packages/runtime        The layer that runs inside Antigravity
packages/plugin-api     The public contract plugins are written against
packages/theme-api      Theme metadata format
packages/marketplace    Submission rules and the catalog shape
packages/shared         Version constants and shared types
community/              Submitted themes and plugins, and the catalog
examples/               A reference plugin, type-checked in CI
docs/                   Everything above, in detail
```

## Development

Node.js 22+ and pnpm 10+.

```bash
pnpm install
pnpm check     # verify structure, typecheck, build, and test
pnpm dev       # the installer UI in a browser, against a safe preview patcher
```

`pnpm dev` never touches Antigravity. To work against a real installation, and
for the DevTools-protocol harness used to develop the injected UI, see
[contributing](CONTRIBUTING.md).

## Sharing what you make

Themes and plugins are submitted to [`community/`](community) as pull requests,
reviewed, and indexed into a [catalog](community/catalog.json). Keeping them in
the repository means every listing has a readable diff and a review attached —
which matters, because a plugin is arbitrary code running beside your source and
your credentials.

`pnpm community:check` runs the same validation CI does. The rules are in the
[community README](community/README.md).

## Status

Windows only, Antigravity 2.x, and not code-signed yet. Submissions are open,
but nothing reads the catalog from inside Antigravity yet — installing still
means adding the file yourself. See the [roadmap](docs/roadmap.md).

## Licence

[MIT](LICENSE).

BetterGravity is an unofficial community project. It is not affiliated with,
endorsed by, or sponsored by Google, and it distributes none of Google's files.

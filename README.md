# BetterGravity

An open community modification layer for [Google Antigravity](https://antigravity.google).
Themes and plugins, loaded from your own folder, with a settings panel inside
Antigravity itself.

BetterGravity is unofficial and not affiliated with Google. It ships none of
Google's files: it patches an installation you already have, keeps the original
bundle beside the patched one, and can put everything back exactly as it was.

## What you get

- **Themes.** A theme is one `.css` file. Save it and Antigravity restyles
  immediately — no build step, no reload.
- **Plugins.** A folder with a manifest and a script. Plugins get persistent
  storage, declarative settings, scoped styles, and DOM helpers built for a
  single-page app that constantly re-renders.
- **A settings panel.** `Ctrl+Shift+G` inside Antigravity, to turn things on and
  off and change plugin options.
- **It survives updates.** Antigravity replaces its own program files when it
  updates, which removes BetterGravity. It gets put back automatically.

Writing your own is covered in [`docs/AUTHORING.md`](docs/AUTHORING.md), with
working examples in [`examples/`](examples).

## How it works

Antigravity is not a normal Electron app, and the difference shapes everything
here. Its `app.asar` is a small launcher: it starts a native language server and
points a window at `https://127.0.0.1:<port>`, so **the entire interface is a web
app served over loopback**. There are no UI files on disk to patch.

So BetterGravity injects at runtime instead:

1. The installer swaps `app.asar` for a small bootstrap and keeps the original as
   `_app.asar`. The bootstrap restores Antigravity's identity, starts the
   BetterGravity runtime, and then hands control to the original entry point.
2. The runtime registers an *additional* preload, so Antigravity's own preload
   and its APIs keep working untouched.
3. Plugins run in the page's own world, where they can reach the DOM and the
   application's globals.

If anything in the runtime fails, the bootstrap catches it and Antigravity starts
exactly as it would without BetterGravity. Nothing you install can stop your IDE
from opening.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) goes into detail.

## Installing

Windows only for now, on Antigravity 2.x.

Download the installer from the releases page, run it, and press **Install**. It
finds Antigravity, backs up the original bundle, and patches it. **Uninstall** in
the same window restores everything and keeps your themes and plugins.

Your content lives in `%APPDATA%\BetterGravity`, outside Antigravity, so it
survives updates, reinstalls, and removing BetterGravity entirely.

## Repository map

```text
apps/installer          The Windows installer: Electron shell and its UI
packages/patcher        Patching, verification, uninstall, update guardian
packages/runtime        The layer that runs inside Antigravity
packages/plugin-api     The public contract plugins are written against
packages/theme-api      Theme metadata format
packages/marketplace    Catalog contracts, not yet wired up
packages/shared         Version constants and shared types
examples/               A reference plugin and a reference theme
docs/                   Architecture, authoring, installer, roadmap
```

## Development

Node.js 22+ and pnpm 10+.

```text
pnpm install
pnpm check          verify structure, typecheck, build, and test
pnpm dev            the installer UI in a browser, against a safe preview patcher
```

`pnpm dev` never touches Antigravity: in a plain browser the UI runs against a
simulated patcher.

To work against a real installation:

```text
pnpm build
pnpm patch install          patch the Antigravity on this machine
pnpm patch uninstall        put it back
node scripts/dev-inspect.mjs launch     start Antigravity with a debug port
node scripts/dev-inspect.mjs shot ui.png
```

Build the portable executable with `pnpm build:installer`. It is written to
`release-<version>/` and is unsigned until release signing is set up.

## Safety

The installer is privileged code that modifies an application on your machine.
It keeps timestamped backups, verifies every step, refuses host versions it has
not been tested against, and never deletes your content.

Plugins are the opposite: untrusted code running in the same page as your source
and credentials. **Plugin loading is off until you turn on developer mode**, and
the panel says exactly why. Themes are plain CSS and carry no such risk, so they
load freely.

## Licence

GPL-3.0-or-later.

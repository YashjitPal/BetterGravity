# Architecture

## The shape of the host

Everything here follows from one finding: **Antigravity's `app.asar` is not the
IDE.** It is a small launcher. Reading `dist/main.js` inside it:

- it spawns a native `language_server` binary on a loopback port,
- it opens a `BrowserWindow` pointed at `https://127.0.0.1:<port>/`,
- the IDE proper is a separate application it can install for you.

So the interface is a web application served over loopback, and **there are no
UI files on disk to modify**. Every visible change has to be injected into a
live renderer.

Two consequences worth stating plainly:

- The launcher's code is unminified, so there is no need to pattern-match
  against a minified bundle that breaks on every host release. This is the
  single biggest difference from modding a client like Discord.
- As of 2.11 the loopback pages carry no `Content-Security-Policy`. The runtime
  strips CSP headers on that origin anyway, because their absence is an
  implementation detail rather than a promise.

## The patch

`packages/patcher` replaces `resources/app.asar` with a bootstrap and keeps the
original as `_app.asar`.

The bootstrap is deliberately tiny, and two properties matter more than anything
else it does.

**It is identity-transparent.** Its `package.json` mirrors the host's `name`,
`productName`, and `version`, and it calls `app.setName()` before anything reads
a name-derived path. Electron derives `app.getName()` from the loaded package,
and Antigravity builds *both* its `userData` directory and its `antigravity://`
protocol registration from that name. A bootstrap that names itself would
silently orphan user data into a directory named after the bootstrap. Because
the bootstrap is indistinguishable by name, an installation is identified by the
`.bettergravity.json` marker inside the archive instead.

**It fails open.** Loading the runtime is wrapped so that any failure is logged
and execution continues to `require(originalMain)`. A broken runtime, a corrupt
plugin, a missing file — none of them can stop Antigravity from starting.

Operations are `install`, `update`, `reinstall`, `repair`, and `uninstall`.
Every one closes only processes belonging to the target installation, takes a
timestamped snapshot, stages the new archive under a temporary name, verifies
it, and only then swaps it into place. Uninstall restores `_app.asar` byte for
byte and leaves user content alone.

### One Electron trap

Electron rewrites `fs` so that any path containing `.asar` is treated as a path
*inside* an archive. That is correct for application code and fatal for a
patcher, whose entire job is to copy and replace the archive files themselves:
`copyFileSync` on `app.asar` fails with an ENOENT for an empty filename.
`packages/patcher/src/native/fs.ts` routes all filesystem access through
`original-fs` whenever it is running under Electron.

## The runtime, in three parts

`packages/runtime` builds to two files that the patcher deploys next to the
installation. It is split three ways because of what can cross a context bridge.

**Main process** (`src/main`) has Node and Electron. It reads themes and plugins
from disk, owns settings and plugin storage, watches for changes, relaxes CSP,
and registers the preload. It uses `session.registerPreloadScript`, which is
*additive*: Antigravity's own preload and its `contextBridge` APIs keep working.

It also owns the two capabilities the page cannot have: the Discord socket behind
[`plugin.presence`](plugin-api.md#pluginpresence), and the Gemini translator
behind [`plugin.gemini`](plugin-api.md#plugingemini) — a loopback HTTPS listener
and a rewrite of the language server's endpoint argument, both of which have to
exist before Antigravity spawns that server, and so before any plugin runs. The
one file read on the page's behalf lives here too:
[`plugin.account`](plugin-api.md#pluginaccount) answers out of the Chromium
profile Antigravity signs into Google through, which is the only place on the
machine that has the user's name.

**Preload** (`src/preload`) is sandboxed and context-isolated. It exposes a
JSON-only bridge and injects theme CSS. Themes live here rather than in the page
world so they keep working even if the plugin runtime fails to boot.

**Page world** (`src/world`) is the plugin host and the settings section. Plugins
need the page's own globals and live DOM nodes, and neither survives
serialisation across a context bridge — so the host runs in the page instead,
and only JSON crosses. Since a sandboxed preload also cannot read from disk, the
page-world bundle is inlined into the preload as a string at build time.

Plugins are compiled with `new Function` rather than injected as script text, so
their context is passed by reference instead of serialised into source.

## Living inside Antigravity's settings

BetterGravity appears as an entry in Antigravity's own settings dialog rather
than as a window of its own. `src/world/settings` adds a nav item and a screen
to the dialog and reuses Antigravity's Tailwind class strings verbatim, so the
section inherits the app's theme, spacing, and hover behaviour — including when
the user changes theme. Those class strings are collected in `native.ts`, which
is the one file genuinely coupled to the host's markup.

Two details make it hold together. The dialog is React-rendered, so both the nav
item and the screen are re-added whenever it is rebuilt, and the section
re-asserts itself if a re-render tries to show a native screen underneath it.
And because Antigravity toggles its screens with inline `display`, the values it
had are recorded before they are overwritten and restored on the way out —
without that, the screen BetterGravity hid stays hidden when the user selects it
again, because React will not rewrite a value it believes is already correct.

## Where things live

```text
%APPDATA%\BetterGravity\          your content, independent of Antigravity
├── themes/  plugins/
├── settings.json  storage.json
└── runtime.log

<Antigravity>\resources\
├── app.asar                      the bootstrap while patched
├── _app.asar                     the original, untouched
└── .bettergravity\
    ├── runtime/                  main.cjs, preload.cjs, repair.cjs
    └── backups/                  timestamped snapshots, pruned to five
```

Content is deliberately outside the installation so it survives Antigravity
being updated, reinstalled, or removed. Only code and backups sit beside the
application, and both are specific to that installation.

## Surviving host updates

Antigravity updates through electron-updater, which replaces `app.asar` in an
install that runs *after* the application quits. By then BetterGravity is gone,
because the bootstrap it lived in was the file that got replaced, so nothing
inside Antigravity can react.

The job therefore goes to a process that outlives the application. Before
quitting, the runtime spawns a detached guardian (`repair.cjs`, run through the
Electron binary in Node mode). It waits for Antigravity to exit, watches for the
bundle to come back unpatched, and reapplies the patch — adopting the newer
bundle as the original. It treats doing nothing as a perfectly good outcome.

The awkward part is that **an update ends with Antigravity relaunching itself**.
The guardian originally stopped as soon as it saw the application running again,
on the reasoning that patching underneath a running editor would fight the user.
That reasoning is right, but the stop condition was wrong: the relaunch is the
normal end of an update, so the guardian could only ever act if it won a race
against it. On a real 2.11 to 2.12 update it lost, logged "Antigravity started
again", and left the installation unpatched.

So the two cases are now separated. Antigravity coming back with the patch
intact means nothing was waiting to be done, and the guardian stops. Coming back
with the patch gone means the update landed, and the guardian keeps waiting —
for hours if need be — for the user to close the application, then reapplies.
It still never closes anything itself.

Because the guardian *is* an `Antigravity.exe` process, process lookups take an
exclusion list and always exclude the caller. Without that it would wait for
itself forever, and then terminate itself.

## Trust boundaries

The installer is privileged. It owns backups, compatibility gating, path
validation, and verification, and nothing downloaded or authored by a community
member can influence it.

Themes are styling. They cannot read files, reach the network, or observe input,
so they load without a gate.

Plugins are arbitrary code in the same page as your source and credentials.
Loading them from disk is off until the user turns on developer mode, and the
panel explains the risk in those terms. A plugin that throws is contained and
reported; disabling one runs its cleanups, removes its styles, and disconnects
its observers.

The intended long-term model is a curated marketplace for people who just want
things to work, with developer mode for people writing their own. That mirrors
where VS Code and Vencord both ended up, and it is why the gate exists now even
though the marketplace does not.

## Dependency direction

```text
shared ← theme-api  ─┐
shared ← plugin-api ─┴→ runtime → (deployed by) patcher → installer
shared ← patcher
```

`packages/patcher` has two entry points: the default one is browser-safe types
and a preview adapter, while `@bettergravity/patcher/native` holds the
privileged implementation. `scripts/verify-structure.mjs` fails the build if a
renderer source ever imports the latter.

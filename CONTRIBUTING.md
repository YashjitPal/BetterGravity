# Contributing to BetterGravity

Thanks for helping build an open community layer for Antigravity.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first. Most of the design
here follows from one fact about the host, and changes that ignore it tend not
to work.

## Getting set up

Node.js 22+ and pnpm 10+.

```text
pnpm install
pnpm check
```

`pnpm check` is the gate: it verifies package boundaries, typechecks everything
including tests, builds, and runs the suite. CI runs it on Windows and Linux.

## Working on the installer UI

```text
pnpm dev
```

This serves the installer's interface in a browser against a **preview patcher**
that simulates operations and never touches Antigravity. It is the safe way to
iterate on the interface.

For the real Electron shell with live reload:

```text
pnpm build
pnpm --filter @bettergravity/installer dev:desktop
```

## Working on the runtime

The runtime only exists inside a patched Antigravity, so the loop is:

```text
pnpm build
pnpm patch install
node scripts/dev-inspect.mjs launch
```

`scripts/dev-inspect.mjs` drives Antigravity over the DevTools protocol, which
is how you inspect injected UI without fighting the Windows foreground lock:

```text
node scripts/dev-inspect.mjs shot panel.png
node scripts/dev-inspect.mjs eval "window.BetterGravity.version"
node scripts/dev-inspect.mjs run scratch.js
```

`%APPDATA%\BetterGravity\runtime.log` records what the runtime did, including
anything that failed to load. Editing a theme or plugin reloads it immediately;
changing the runtime itself needs `pnpm build && pnpm patch reinstall`.

`pnpm patch uninstall` always puts Antigravity back.

## Testing

Tests live in `packages/*/tests`. They are typechecked along with the source.

The patcher is tested against synthetic Antigravity bundles built with
`@electron/asar` in temporary directories, so install, repair, uninstall, and
the host-update path are exercised for real rather than mocked. Process
discovery is injectable so the suite never shells out.

Runtime injection is tested under jsdom, which really executes injected scripts,
so plugin containment is proven rather than asserted structurally.

If you fix a bug, add the test that would have caught it and say so in a comment
above it. Several tests here exist because something broke on a real machine.

## What to keep in mind

**The bootstrap must fail open.** Anything you add to the runtime's startup path
has to be survivable. Antigravity opening is more important than BetterGravity
working.

**Renderer code must never import `@bettergravity/patcher/native`.** The
structure check fails the build if it does, because that would ship `node:fs`
into a browser bundle.

**Privileged and community code stay apart.** Nothing a plugin or theme does may
influence the installer.

**Do not commit** build output, release binaries, credentials, or any of
Google's files.

## Community packages

A published plugin or theme should carry a manifest, an explicit licence, host
compatibility information, and a link to readable source.

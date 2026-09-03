# The installer

The installer is a focused maintenance tool. It is not the marketplace, a plugin
browser, or a settings application — those live inside Antigravity, as a
BetterGravity entry in its own settings dialog.

## What it offers, and when

The installer asks the patcher which operations apply to the installation in
front of it, so the interface can never offer something the patcher would
refuse.

| Installation state | Offered |
| --- | --- |
| Antigravity found, not patched | Install |
| Patched and current | Reinstall, Repair, Uninstall |
| Antigravity changed underneath the patch | Reapply, Uninstall |
| Patch incomplete or damaged | Repair, Uninstall |
| Nothing found | Choose a folder |

**Install** backs up the original bundle and patches Antigravity.
**Reapply** handles the case where Antigravity updated itself and replaced the
patched bundle; the newer bundle becomes the new original.
**Reinstall** rebuilds the patch from the original bundle.
**Repair** recovers an installation whose pieces are missing or inconsistent.
**Uninstall** restores the original bundle byte for byte and keeps every theme,
plugin, setting, and saved plugin value.

## What every operation guarantees

1. The path is validated as a real Antigravity installation, by reading the
   bundle manifest rather than trusting the folder name.
2. The host version is checked against the supported major. An untested version
   is refused rather than patched hopefully.
3. Only processes whose executable belongs to *this* installation are closed. A
   second Antigravity elsewhere on the machine is never touched. It is asked to
   close first and forced only after five seconds.
4. A timestamped snapshot is written to `resources/.bettergravity/backups`,
   pruned to the five most recent.
5. The new archive is staged under a temporary name and verified before it
   replaces anything.
6. The result is re-inspected. If verification fails, the original bundle and
   the backup are both still there.

## Where things end up

```text
%APPDATA%\BetterGravity\        themes, plugins, settings, storage, runtime.log
<Antigravity>\resources\
├── app.asar                    the BetterGravity bootstrap
├── _app.asar                   the original Antigravity bundle
└── .bettergravity\
    ├── runtime/                the code the bootstrap loads
    └── backups/
```

Uninstalling removes `runtime/`, restores `app.asar`, and leaves everything else
in place, so reinstalling is lossless.

## Antigravity updating itself

Antigravity updates through electron-updater, which replaces `app.asar` after
the application quits — at which point BetterGravity no longer exists to react.
The runtime handles this by spawning a detached guardian before quitting, which
waits for the application to close and reapplies the patch once the update has
landed.

Antigravity relaunches itself once an update is installed, so the patch usually
comes back the next time you close it rather than immediately. The guardian
never closes the application to get there.

This is on by default and can be turned off under **BetterGravity → Settings**.
With it off, the installer will report **Antigravity changed** the next time you
open it, and Reapply puts things back.

## Building it

```text
pnpm build:installer
```

The portable executable is written to
`release-<version>/BetterGravity-Installer-<version>.exe`, which is ignored by
Git. Local builds are unsigned until release signing is configured, so Windows
SmartScreen will warn on first run.

## Supported platforms

Windows, Antigravity 2.x. The patcher is written against that line specifically:
a launcher shell that serves its UI from a loopback language server, with a
single window-creation path. A new major version needs that re-verified before
the compatibility gate moves.

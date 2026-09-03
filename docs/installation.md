# Installing BetterGravity

Windows, Antigravity 2.x. Other platforms are not supported yet.

## Install

1. Download `BetterGravity-Installer-<version>.exe` from the
   [releases page](https://github.com/YashjitPal/BetterGravity/releases).
2. Run it. Windows SmartScreen will warn, because the build is not code-signed
   yet — choose **More info → Run anyway**.
3. The installer finds Antigravity on its own. Press **Install**.
4. Reopen Antigravity. BetterGravity is now in **Settings → BetterGravity**.

The installer closes Antigravity if it is running, backs up the original program
bundle, and verifies the result before reporting success.

## Uninstall

Run the installer again and press **Uninstall**. Antigravity is restored exactly
as it was, byte for byte.

Your themes, plugins, settings, and saved plugin data are kept, so reinstalling
picks up where you left off. To remove those too, delete
`%APPDATA%\BetterGravity`.

## Where things are kept

```text
%APPDATA%\BetterGravity\
├── themes\           your .css files
├── plugins\          one folder per plugin
├── settings.json     what is switched on
├── storage.json      data plugins have saved
└── runtime.log       what the runtime did, and anything that failed
```

This lives outside Antigravity on purpose, so it survives Antigravity being
updated, reinstalled, or removed.

## When Antigravity updates

Antigravity replaces its own program files when it updates, which removes
BetterGravity. It is put back automatically once the update finishes.

You can turn that off under **Settings → BetterGravity → General**. With it off,
the installer will report **Antigravity changed** next time you open it, and
**Reapply** restores things.

## Troubleshooting

**The installer says Antigravity was not found.**
Use **Choose a different location** and pick the folder containing
`Antigravity.exe`. Standard locations are checked automatically.

**It says the version has not been marked compatible.**
BetterGravity is verified against Antigravity 2.x and refuses versions it has
not been tested against rather than patching hopefully. Please
[open an issue](https://github.com/YashjitPal/BetterGravity/issues) with your
Antigravity version.

**Antigravity opens but BetterGravity is not in Settings.**
Check `%APPDATA%\BetterGravity\runtime.log`. If the runtime failed, Antigravity
starts as though BetterGravity were not installed — that is deliberate. The log
says what went wrong.

**A theme or plugin is not showing up.**
Themes must end in `.css`. Plugins must be a folder containing `plugin.json`,
and only load when **Developer mode** is on. Anything that failed to load is
listed under the **Problems** tab with the reason.

**Antigravity will not start after installing.**
Run the installer and press **Uninstall**, which restores the original bundle
from its backup. Then please open an issue — this should not be possible, since
the patch is designed to fall back to a normal launch if anything goes wrong.

**Something looks broken after enabling a theme.**
Switch the theme off in settings. Themes are plain CSS and cannot damage
anything, but they can certainly hide things.

## Building it yourself

```bash
pnpm install
pnpm build:installer
```

The portable executable is written to `release-<version>/`. See
[contributing](../CONTRIBUTING.md) for the development workflow.

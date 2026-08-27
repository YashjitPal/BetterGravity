# Installer Scope

The BetterGravity Installer is intentionally focused. It is not the Marketplace, a plugin browser, or a settings application.

## Operations

- **Install** adds BetterGravity to an Antigravity installation for the first time.
- **Update** moves the installed BetterGravity layer to a newer compatible version.
- **Reinstall** replaces the current BetterGravity layer from a clean package.
- **Repair** restores missing or corrupted BetterGravity files.

Every operation must confirm the path, validate compatibility, create a recoverable backup, apply changes atomically where possible, and verify the result. The Windows executable uses the native adapter: it backs up `resources/app.asar` as `_app.asar`, installs a BetterGravity bootstrap, and verifies the marker before reporting success.

If Antigravity is running, the Windows installer closes only processes whose executable belongs to the detected Antigravity installation. It waits for a graceful exit and uses forced termination only if the host does not close within five seconds.

## Windows executable

Run `pnpm build:installer` from the repository root. The generated portable executable is written to `release-<version>/BetterGravity-Installer-<version>.exe` and is intentionally ignored by Git. Local builds are unsigned until the public release-signing pipeline is configured.

On Windows, the desktop installer automatically checks the standard per-user and system Antigravity installation locations and validates that `Antigravity.exe` is present. The folder picker remains available as a fallback for portable or non-standard installations.

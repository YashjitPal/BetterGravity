# Installer Scope

The BetterGravity Installer is intentionally focused. It is not the Marketplace, a plugin browser, or a settings application.

## Operations

- **Install** adds BetterGravity to an Antigravity installation for the first time.
- **Update** moves the installed BetterGravity layer to a newer compatible version.
- **Reinstall** replaces the current BetterGravity layer from a clean package.
- **Repair** restores missing or corrupted BetterGravity files.

Every operation must confirm the path, validate compatibility, create a recoverable backup, apply changes atomically where possible, and verify the result. The current First Light build demonstrates this flow with a no-op preview adapter; it does not patch a real installation yet.

## Windows executable

Run `pnpm build:installer` from the repository root. The generated NSIS installer is written to `release/BetterGravity-Installer-<version>.exe` and is intentionally ignored by Git. Local builds are unsigned until the public release-signing pipeline is configured.

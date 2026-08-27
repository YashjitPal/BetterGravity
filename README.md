# BetterGravity

BetterGravity is an open-source community layer for Google Antigravity. It is planned as two connected products:

- **BetterGravity Installer**: a focused standalone utility for installing, updating, reinstalling, and repairing the BetterGravity layer.
- **BetterGravity Runtime**: the in-Antigravity community platform for plugins, themes, settings, and the Marketplace.

The installer does not contain the Marketplace. The Marketplace belongs inside the installed runtime and will eventually appear in Antigravity's sidebar.

## First Light status

The repository contains a professional monorepo and a safe browser preview. The Windows executable also includes a native, reversible Electron-bundle patcher with automatic version and patch-state detection.

## Repository map

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full boundary map.

```text
apps/installer          Standalone installer UI
packages/patcher        Install/update/reinstall/repair lifecycle
packages/core           Runtime lifecycle
packages/plugin-api     Community plugin API
packages/theme-api      Community theme API
packages/marketplace    Marketplace data contracts
packages/shared         Shared types and version constants
docs/                   Product and contributor docs
examples/               Creator examples
```

## Development

Requirements: Node.js 22+ and pnpm 10+.

```text
pnpm install
pnpm dev
pnpm check
```

Open the local Vite URL printed by `pnpm dev` to preview the installer.

Build the Windows executable with:

```text
pnpm build:installer
```

The resulting unsigned portable executable is placed in `release-<version>/`. Release binaries should be attached to a GitHub Release instead of committed to the source repository.

## Important safety note

BetterGravity is an unofficial community project. We will not distribute Google's proprietary Antigravity files. Before implementing native patching, we must document Antigravity's installation format, update behavior, and relevant terms so the adapter can be reversible and respectful of user data.

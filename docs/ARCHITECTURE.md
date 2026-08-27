# BetterGravity Architecture

BetterGravity has two user-facing products with different responsibilities:

1. **Installer**: a small standalone maintenance tool. It only detects Antigravity and performs `install`, `update`, `reinstall`, or `repair` operations.
2. **BetterGravity runtime**: the layer loaded by Antigravity after installation. This is where community plugins, themes, settings, and the Marketplace belong.

The repository reflects that boundary:

```text
apps/installer                 Standalone installer UI
packages/patcher               Filesystem/injection lifecycle
packages/core                  Runtime registration and lifecycle
packages/plugin-api            Public plugin contract for creators
packages/theme-api             Public theme contract for creators
packages/marketplace           Catalog and listing contracts
packages/shared                Versioned primitives shared by packages
examples/                      Small creator examples
docs/                          Product and contributor documentation
scripts/                       Repository checks and release helpers
```

## Trust boundaries

The installer is privileged code. It must own backups, compatibility checks, rollback, and path validation. Marketplace content is untrusted community code and must never be allowed to silently change installer behavior.

The browser adapter currently included in `packages/patcher` is a preview only. It does not read or write Antigravity files. A future desktop adapter will implement the same `Patcher` interface with native filesystem access.

## Dependency direction

```text
shared <- plugin-api <- core
shared <- theme-api  <- core
shared <- patcher   <- installer
plugin-api + theme-api + shared <- marketplace
```

Public creator APIs stay independent from the installer so third-party packages can be developed and tested without bundling privileged code.

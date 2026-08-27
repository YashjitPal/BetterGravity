# Contributing to BetterGravity

Thanks for helping build an open community layer for Antigravity.

Before opening a change, read `docs/ARCHITECTURE.md`, keep installer responsibilities separate from runtime/community responsibilities, and do not commit private configuration, credentials, local build output, or Antigravity proprietary files.

## Local workflow

```text
pnpm install
pnpm dev
pnpm check
```

The installer is currently a Vite browser preview. Native filesystem patching will arrive behind the `Patcher` interface after Antigravity's installation and update behavior have been mapped safely.

Community packages should include a manifest, an explicit license, host compatibility information, and a link to readable source code.

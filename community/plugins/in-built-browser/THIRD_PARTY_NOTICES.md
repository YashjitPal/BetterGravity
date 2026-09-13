# Third-party components

## OpenAI Codex browser client and interfaces

`vendor/codex-browser-client.mjs`, `vendor/command-contracts.json`, and
`vendor/api.json` derive from the installed OpenAI Codex browser plugin version
26.903.71938, included in Codex desktop 26.903.9818.0. Copyright and other rights
in these upstream materials remain with their respective owners. BetterGravity's
MIT license applies to the adapter written in this repository and does not
relicense extracted OpenAI materials.

The client was bundled for a standalone JavaScript import, with its bootstrap
replaced by the BetterGravity transport and console calls removed. The command
contracts were converted from bundled Zod schemas into JSON Schema. Original
source hashes and the extraction description are in `vendor/provenance.json`.
No Codex profile data, credentials, telemetry service, or native binaries are
included.

`vendor/codex-browser-cursor.js` and its generated block in `index.js` contain
the cursor PNG, spring renderer, motion constants, and Bezier path helpers
extracted from the same installed Codex version. The app-specific initializer
was replaced with a local interface for the browser overlay. Original source
hashes and extraction details are in `vendor/cursor-provenance.json`. Rights in
this cursor artwork and implementation remain with their respective owners.

`vendor/codex-instructions/` contains the original Browser skill, agent default
prompt, API manifest, document catalog, and all 26 Markdown browser-use guides
from Codex Browser 26.903.71938. These files are copied byte-for-byte, with source
hashes in `vendor/codex-instructions/provenance.json`. Tool descriptions retain
the original API comments/declarations. The registered skill changes its name,
normalizes line endings, and prepends separately labeled BetterGravity transport
notes; the source's wording is unchanged. Rights in the imported instructions
remain with their respective owners; they are not relicensed by BetterGravity.

## Willow Code testing visuals

The breathing page glow, floating control layout, blue cursor mark, and their
animation values are adapted from `features/code/src/workbench/WorkbenchPreview.tsx`
(`TestModeGlow`, `TestStatusIndicator`, and `pulseGlowOpacity`) in the local
Willow Code reference. BetterGravity supplies its own task-state subscription
and Take over/Resume handlers. Source details are recorded in
`vendor/willow-testing-provenance.json`; the MIT license and copyright notice
are included in [vendor/WILLOW-LICENSE](vendor/WILLOW-LICENSE).

## Playwright

`vendor/playwright-injected.js` is the Playwright DOM selector and accessibility
engine embedded in the Codex browser service. It has been minified and console
calls removed. Playwright is copyright Microsoft Corporation and contributors,
licensed under Apache License 2.0. The accompanying license is
[vendor/PLAYWRIGHT-LICENSE](vendor/PLAYWRIGHT-LICENSE).

## Zod

The extracted client includes Zod 3 schema validation code, copyright Colin
McDonnell and contributors, licensed under the MIT License. Its notice is in
[vendor/ZOD-LICENSE](vendor/ZOD-LICENSE).

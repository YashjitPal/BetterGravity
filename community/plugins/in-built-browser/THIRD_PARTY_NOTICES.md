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

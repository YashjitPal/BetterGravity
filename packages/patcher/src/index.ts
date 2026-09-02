// Browser-safe entry point: types and the preview adapter only.
// The privileged Windows implementation lives behind `@bettergravity/patcher/native`
// so renderer bundles can never pull in node:fs or @electron/asar.
export * from "./types.js";
export { createPreviewPatcher } from "./preview.js";

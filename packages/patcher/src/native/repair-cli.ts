// Entry point for the guardian process. Bundled to repair.cjs and deployed
// beside the runtime, then run by Electron in Node mode after Antigravity quits.

import { main } from "./repair.js";

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});

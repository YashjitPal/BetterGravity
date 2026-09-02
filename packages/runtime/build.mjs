// Bundles the runtime into the two CommonJS files the patcher deploys into an
// Antigravity installation. They are loaded by Electron directly, so they must
// carry their own dependencies and reference nothing from node_modules.

import { build } from "esbuild";
import { rm } from "node:fs/promises";

const production = process.env.NODE_ENV !== "development";

await rm("dist", { recursive: true, force: true });

/** @type {import("esbuild").BuildOptions} */
const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  // Matches the Electron 41 runtime shipped by Antigravity 2.x.
  target: "node22",
  external: ["electron"],
  minify: production,
  sourcemap: production ? false : "inline",
  legalComments: "none",
  logLevel: "warning"
};

await Promise.all([
  build({ ...shared, entryPoints: ["src/main/index.ts"], outfile: "dist/main.cjs" }),
  build({ ...shared, entryPoints: ["src/preload/index.ts"], outfile: "dist/preload.cjs" })
]);

console.log("Runtime bundled to dist/main.cjs and dist/preload.cjs");

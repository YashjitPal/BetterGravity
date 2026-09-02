// Bundles the runtime into the two CommonJS files the patcher deploys into an
// Antigravity installation. They are loaded by Electron directly, so they must
// carry their own dependencies and reference nothing from node_modules.
//
// There is a third piece: the page-world runtime that actually hosts plugins.
// It cannot be a separate file, because a sandboxed preload cannot read from
// disk, so it is built first and inlined into the preload as a string.

import { build } from "esbuild";
import { rm } from "node:fs/promises";

const production = process.env.NODE_ENV !== "development";

await rm("dist", { recursive: true, force: true });

/** @type {import("esbuild").BuildOptions} */
const shared = {
  bundle: true,
  // Matches the Electron 41 runtime shipped by Antigravity 2.x.
  target: ["node22", "chrome130"],
  minify: production,
  legalComments: "none",
  logLevel: "warning"
};

const world = await build({
  ...shared,
  entryPoints: ["src/world/index.ts"],
  platform: "browser",
  format: "iife",
  write: false
});

const worldSource = world.outputFiles[0]?.text;
if (!worldSource) throw new Error("The page-world runtime produced no output.");

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron"]
  }),
  build({
    ...shared,
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/preload.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron"],
    define: { __WORLD_SOURCE__: JSON.stringify(worldSource) }
  })
]);

console.log(`Runtime bundled: main.cjs, preload.cjs (page world inlined, ${(worldSource.length / 1024).toFixed(1)} KB)`);

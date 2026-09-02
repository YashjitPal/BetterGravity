// Bundles the installer's Electron main process and preload, then stages the
// runtime bundles beside them. Bundling keeps the packaged app independent of
// pnpm's symlinked node_modules layout, which electron-builder cannot follow.

import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(here, "dist-electron");
const runtimeDist = path.join(here, "..", "..", "packages", "runtime", "dist");

if (!existsSync(runtimeDist)) {
  console.error("The runtime has not been built. Run `pnpm --filter @bettergravity/runtime build` first.");
  process.exit(1);
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

/** @type {import("esbuild").BuildOptions} */
const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // Provided by the Electron runtime itself; everything else is inlined.
  // @electron/asar reaches for original-fs so it can read past the asar layer.
  external: ["electron", "original-fs"],
  logLevel: "warning"
};

const patcherSource = path.join(here, "..", "..", "packages", "patcher", "src", "native");

await Promise.all([
  build({ ...shared, entryPoints: [path.join(here, "electron", "main.ts")], outfile: path.join(outputDirectory, "main.cjs") }),
  build({ ...shared, entryPoints: [path.join(here, "electron", "preload.ts")], outfile: path.join(outputDirectory, "preload.cjs") })
]);

await cp(runtimeDist, path.join(outputDirectory, "runtime"), { recursive: true });

// The guardian is deployed with the runtime but owned by the patcher, since it
// reapplies the patch after Antigravity replaces app.asar during a self-update.
await build({
  ...shared,
  entryPoints: [path.join(patcherSource, "repair-cli.ts")],
  outfile: path.join(outputDirectory, "runtime", "repair.cjs")
});

console.log("Installer shell bundled to dist-electron/ with the runtime staged alongside.");

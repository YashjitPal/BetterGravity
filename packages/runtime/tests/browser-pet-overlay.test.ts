import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.runIf(process.platform === "win32")("keeps the browser visible during desktop pet hover and interactive with in-window pets", async () => {
  const require = createRequire(import.meta.url);
  const electron = process.env.BETTERGRAVITY_TEST_ELECTRON ?? require("electron") as string;
  if (basename(electron).toLowerCase() !== "electron.exe") throw new Error("Use standalone test Electron, never Antigravity.");
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-browser-pet-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await build({ entryPoints: [resolve("packages/runtime/src/main/browser/index.ts")], outfile: join(directory, "browser.cjs"), bundle: true,
      platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "silent" });
    try {
      await promisify(execFile)(electron, [resolve("packages/runtime/tests/fixtures/browser-electron.cjs"), directory, resolve("community/plugins"), "--pet-overlay-only"], { env, windowsHide: true, timeout: 50_000 });
    } catch (error) {
      throw new Error(await readFile(join(directory, "result.json"), "utf8").catch(() => "No browser pet report was written."), { cause: error });
    }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toMatchObject({ desktopPetHoverKeepsPage: true, desktopPetHoverKeepsPreview: true, petClickKeepsPreview: true, petClickKeepsInput: true, noBlankHandoff: true, petDragKeepsPreview: true,
      livePageKeepsPainting: true, cancelledPetKeepsInput: true, lateAcknowledgementsRejected: true, errors: [] });
  } finally {
    if (process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY) {
      const destination = resolve(process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY, "pet-overlay");
      await mkdir(destination, { recursive: true });
      for (const file of ["result.json", "pet-browser.png", "pet-browser-failed.png"]) {
        await copyFile(join(directory, file), join(destination, file)).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("bettergravity-browser-pet-")) throw new Error("Unexpected browser pet test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

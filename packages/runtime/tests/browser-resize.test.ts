import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.runIf(process.platform === "win32")("keeps composited pages proportional and current while maximizing under user control", async () => {
  const require = createRequire(import.meta.url);
  const electron = process.env.BETTERGRAVITY_TEST_ELECTRON ?? require("electron") as string;
  if (basename(electron).toLowerCase() !== "electron.exe") throw new Error("Use standalone test Electron, never Antigravity.");
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-browser-resize-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await build({ entryPoints: [resolve("packages/runtime/src/main/browser/index.ts")], outfile: join(directory, "browser.cjs"), bundle: true,
      platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "silent" });
    try {
      await promisify(execFile)(electron, [resolve("packages/runtime/tests/fixtures/browser-electron.cjs"), directory, resolve("community/plugins"), "--paused-resize-only"], { env, windowsHide: true, timeout: 75_000 });
    } catch (error) {
      const report = await readFile(join(directory, "result.json"), "utf8").catch(() => null);
      if (!report) throw new Error("No browser resize report was written.", { cause: error });
      const parsed = JSON.parse(report);
      if (parsed.errors?.length > 0 || !parsed.resumePreservesLayout) {
        throw new Error(report, { cause: error });
      }
    }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toMatchObject({ pausedMaximize: true, pausedRestore: true, lateFramesRejected: true, zoomedResize: true, pageZoom: true, responsiveViewport: true, captureResize: true, userInputAligned: true, resumePreservesLayout: true, errors: [] });
  } finally {
    if (process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY) {
      const destination = resolve(process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY, "resize");
      await mkdir(destination, { recursive: true });
      for (const file of ["result.json", "paused-before.png", "paused-maximized.png", "paused-restored.png", "paused-resize-failed.png"]) {
        await copyFile(join(directory, file), join(destination, file)).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("bettergravity-browser-resize-")) throw new Error("Unexpected browser resize test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}, 85_000);

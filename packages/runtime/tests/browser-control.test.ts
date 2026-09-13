import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.runIf(process.platform === "win32")("reserves AI tabs for model input and fades control out when the response finishes", async () => {
  const require = createRequire(import.meta.url);
  const electron = process.env.BETTERGRAVITY_TEST_ELECTRON ?? require("electron") as string;
  if (basename(electron).toLowerCase() !== "electron.exe") throw new Error("Use standalone test Electron, never Antigravity.");
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-browser-control-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await build({ entryPoints: [resolve("packages/runtime/src/main/browser/index.ts")], outfile: join(directory, "browser.cjs"), bundle: true, minify: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "silent" });
    try {
      await promisify(execFile)(electron, [resolve("packages/runtime/tests/fixtures/browser-electron.cjs"), directory, resolve("community/plugins"), "agent", "--control-only"], { env, windowsHide: true, timeout: 55_000 });
    } catch (error) {
      const report = await readFile(join(directory, "result.json"), "utf8").catch(() => null);
      if (!report) throw new Error("No browser control report was written.", { cause: error });
      const parsed = JSON.parse(report);
      if (parsed.errors?.length > 0 || !parsed.completedUnlock) {
        throw new Error(report, { cause: error });
      }
    }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toMatchObject({ blockedUserInput: true, nativeKeyboardBlocked: true, agentInputWorks: true, inputOnOtherTab: true,
      releasedOnPause: true, smoothEntryExit: true, completedUnlock: true, errors: [] });
  } finally {
    if (process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY) {
      const destination = resolve(process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY, "control");
      await mkdir(destination, { recursive: true });
      for (const file of ["result.json", "control-active.png", "control-pause.png", "control-ending.png"]) {
        await copyFile(join(directory, file), join(destination, file)).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("bettergravity-browser-control-")) throw new Error("Unexpected browser control test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}, 65_000);

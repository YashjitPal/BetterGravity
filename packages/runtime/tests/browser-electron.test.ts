import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.runIf(process.platform === "win32")("runs the extracted browser client and native pane, then revokes every tool and renderer on disable", async () => {
  const require = createRequire(import.meta.url);
  const electron = process.env.BETTERGRAVITY_TEST_ELECTRON ?? require("electron") as string;
  if (basename(electron).toLowerCase() !== "electron.exe") throw new Error("Use standalone test Electron, never Antigravity.");
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-browser-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await build({ entryPoints: [resolve("packages/runtime/src/main/browser/index.ts")], outfile: join(directory, "browser.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "silent" });
    try {
      await promisify(execFile)(electron, [resolve("packages/runtime/tests/fixtures/browser-electron.cjs"), directory, resolve("community/plugins")], { env, windowsHide: true, timeout: 65_000 });
    } catch (error) { throw new Error(await readFile(join(directory, "result.json"), "utf8").catch(() => "No browser test report was written."), { cause: error }); }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toMatchObject({ disabledInitially: true, registered: true, extractedClient: true, trustedClick: true, localhost: true, screenshot: true, buttonPosition: true, nativeViewAttached: true, layoutPreserved: true, toolsRevoked: true, cancelledAction: true, reenabled: true, errors: [] });
    if (process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY) {
      const destination = resolve(process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY);
      await mkdir(destination, { recursive: true });
      for (const file of ["browser-empty.png", "browser-page.png", "browser-chrome.png", "result.json"]) await copyFile(join(directory, file), join(destination, file));
    }
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("bettergravity-browser-")) throw new Error("Unexpected browser test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}, 75_000);

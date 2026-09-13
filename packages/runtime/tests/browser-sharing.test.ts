import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.runIf(process.platform === "win32")("shares live native tabs, restores conversation ownership on opt-out, and revokes all pages on disable", async () => {
  const require = createRequire(import.meta.url);
  const electron = process.env.BETTERGRAVITY_TEST_ELECTRON ?? require("electron") as string;
  if (basename(electron).toLowerCase() !== "electron.exe") throw new Error("Use standalone test Electron, never Antigravity.");
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-browser-sharing-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await build({ entryPoints: [resolve("packages/runtime/src/main/browser/index.ts")], outfile: join(directory, "browser.cjs"), bundle: true,
      platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "silent" });
    try {
      await promisify(execFile)(electron, [resolve("packages/runtime/tests/fixtures/browser-sharing.cjs"), directory, resolve("community/plugins")], { env, windowsHide: true, timeout: 65_000 });
    } catch (error) {
      const report = await readFile(join(directory, "result.json"), "utf8").catch(() => null);
      if (!report) throw new Error("No browser sharing report was written.", { cause: error });
      const parsed = JSON.parse(report);
      if (parsed.errors?.length > 0 || !parsed.revocation) {
        throw new Error(report, { cause: error });
      }
    }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toMatchObject({ defaultOn: true, liveState: true, agentSelection: true, popupOwnership: true, cursorRouting: true, staleReplies: true,
      optOut: true, togglePreservesPages: true, crossWindowUpdates: true, windowClose: true, persistence: true, migration: true, revocation: true, errors: [] });
  } finally {
    if (process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY) {
      const destination = resolve(process.env.BETTERGRAVITY_BROWSER_QA_DIRECTORY);
      await mkdir(destination, { recursive: true });
      await copyFile(join(directory, "result.json"), join(destination, "sharing-result.json")).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("bettergravity-browser-sharing-")) throw new Error("Unexpected browser sharing test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}, 75_000);

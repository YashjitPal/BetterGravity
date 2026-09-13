import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it, vi } from "vitest";

it("Computer Use checks live YOLO state without changing saved application grants", async () => {
  const source = await readFile("community/plugins/computer-use/index.js", "utf8");
  const start = source.indexOf("class AppApprovalManager {");
  const end = source.indexOf("const approvalManager = new AppApprovalManager();", start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const active = new Set<string>();
  const storage = { get: () => ["previous.exe"], set: vi.fn() };
  const manager = new Function("BetterGravity", "plugin", source.slice(start, end) + "return new AppApprovalManager();")(
    { plugins: { isRunning: (id: string) => active.has(id) } }, { storage }
  );
  expect(manager.isAppAllowed("unlisted.exe")).toBe(false);
  active.add("yolo");
  expect(manager.isAppAllowed("unlisted.exe")).toBe(true);
  expect([...manager.sessionAllowed]).toEqual([]);
  expect([...manager.alwaysAllowed]).toEqual(["previous.exe"]);
  expect(storage.set).not.toHaveBeenCalled();
  active.delete("yolo");
  expect(manager.isAppAllowed("unlisted.exe")).toBe(false);
  expect(manager.isAppAllowed("previous.exe")).toBe(true);
});

it.runIf(process.platform === "win32")("uses native browser gates before creating prompts and restores them when YOLO is disabled", async () => {
  const require = createRequire(import.meta.url);
  const electron = process.env.BETTERGRAVITY_TEST_ELECTRON ?? require("electron") as string;
  if (basename(electron).toLowerCase() !== "electron.exe") throw new Error("Use standalone test Electron, never Antigravity.");
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-yolo-browser-"));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  try {
    await build({ entryPoints: [resolve("packages/runtime/src/main/browser/index.ts")], outfile: join(directory, "browser.cjs"), bundle: true,
      platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "silent" });
    try {
      await promisify(execFile)(electron, [resolve("packages/runtime/tests/fixtures/yolo-browser.cjs"), directory, resolve("community/plugins")], {
        env, windowsHide: true, timeout: 30_000
      });
    } catch (error) {
      const report = await readFile(join(directory, "result.json"), "utf8").catch(() => null);
      if (!report) throw new Error("No YOLO browser report was written.", { cause: error });
      const parsed = JSON.parse(report);
      if (parsed.errors?.length > 0 || !parsed.disabled) {
        throw new Error(report, { cause: error });
      }
    }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toMatchObject({ origin: true, devicePermission: true, dialogs: true, restored: true, disabled: true, preferencesUnchanged: true, errors: [] });
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("bettergravity-yolo-browser-")) throw new Error("Unexpected YOLO test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}, 35_000);

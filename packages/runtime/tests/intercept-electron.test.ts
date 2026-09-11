import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

// Mocks cannot reproduce Electron's protocol/stream cancellation boundary.
// Use only a standalone test Electron, never the user's running Antigravity.
it.runIf(process.platform === "win32")("releases chat streams beyond the HTTP/2 limit while preserving bundle loading", async () => {
  const require = createRequire(import.meta.url);
  const electron = process.env.BETTERGRAVITY_TEST_ELECTRON ?? require("electron") as string;
  if (basename(electron).toLowerCase() !== "electron.exe") throw new Error("Use a standalone Electron test runtime.");
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-intercept-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  try {
    await build({
      stdin: {
        contents: 'export { installSourceInterceptor } from "./src/main/intercept.ts"; export { mintAuthority, mintLeaf } from "./src/main/gemini/certificate.ts";',
        resolveDir: resolve("packages/runtime")
      },
      outfile: join(directory, "runtime.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["electron"],
      logLevel: "silent"
    });
    try {
      await promisify(execFile)(electron, [
        resolve("packages/runtime/tests/fixtures/intercept-electron.cjs"), directory
      ], { env, windowsHide: true, timeout: 55_000 });
    } catch (error) {
      const detail = await readFile(join(directory, "result.json"), "utf8").catch(() => "No Electron test result was written.");
      throw new Error(detail, { cause: error });
    }
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toMatchObject({
      opened: 264, closed: 264, active: 0, binaryEcho: true,
      bundlePatched: true, relativeImport: true, navigationCancelled: true,
      delayedHeadersCancelled: true, errors: []
    });
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("bettergravity-intercept-")) {
      throw new Error("Unexpected interceptor test directory");
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 65_000);

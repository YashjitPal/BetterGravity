import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

// jsdom accepts oversized CSS custom properties that Chromium silently drops.
// Exercise the Windows renderer used by the supported Antigravity host.
it.runIf(process.platform === "win32")("renders large custom pets and restores Rocky in both homes", async () => {
  const require = createRequire(import.meta.url);
  const electron = require(require.resolve("electron", { paths: [resolve("apps/installer")] })) as string;
  const directory = await mkdtemp(join(tmpdir(), "bettergravity-pet-rendering-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  try {
    await promisify(execFile)(electron, [
      resolve("packages/runtime/tests/fixtures/pets-rendering.cjs"),
      process.cwd(),
      directory
    ], { env, windowsHide: true, timeout: 60_000 });
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
    expect(result).toEqual({ homes: 2, renderedSheets: 10 });
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error("Unexpected pet test directory");
    await rm(directory, { recursive: true, force: true });
  }
}, 70_000);

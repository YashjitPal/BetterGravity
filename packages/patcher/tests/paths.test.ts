import path from "node:path";
import { describe, expect, it } from "vitest";
import { installationPaths, unpackedPath } from "../src/native/paths.js";

describe("installationPaths", () => {
  const paths = installationPaths(path.join("C:", "Apps", "Antigravity"));

  it("keeps the original bundle beside the live one", () => {
    expect(path.basename(paths.currentAsar)).toBe("app.asar");
    expect(path.basename(paths.originalAsar)).toBe("_app.asar");
    expect(path.dirname(paths.originalAsar)).toBe(path.dirname(paths.currentAsar));
  });

  it("stages replacements outside the live path so a crash cannot half-write it", () => {
    expect(paths.stagedAsar).not.toBe(paths.currentAsar);
    expect(paths.stagedAsar.endsWith(".asar")).toBe(false);
  });

  it("keeps runtime code and backups under one directory", () => {
    expect(paths.runtimeCode.startsWith(paths.runtimeRoot)).toBe(true);
    expect(paths.backups.startsWith(paths.runtimeRoot)).toBe(true);
  });
});

// Regression: the patcher reads through original-fs, which cannot see inside an
// asar archive, so a packaged installer could not find its own runtime files.
describe("unpackedPath", () => {
  it("redirects a packaged path to the unpacked directory", () => {
    const packaged = path.join("C:", "app", "resources", "app.asar", "dist-electron");
    expect(unpackedPath(packaged)).toBe(path.join("C:", "app", "resources", "app.asar.unpacked", "dist-electron"));
  });

  it("leaves a development path untouched", () => {
    const development = path.join("C:", "repo", "apps", "installer", "dist-electron");
    expect(unpackedPath(development)).toBe(development);
  });

  it("does not rewrite a directory that merely ends in app.asar", () => {
    const target = path.join("C:", "somewhere", "app.asar");
    expect(unpackedPath(target)).toBe(target);
  });

  it("is idempotent", () => {
    const packaged = path.join("C:", "app", "resources", "app.asar", "dist-electron");
    expect(unpackedPath(unpackedPath(packaged))).toBe(unpackedPath(packaged));
  });
});

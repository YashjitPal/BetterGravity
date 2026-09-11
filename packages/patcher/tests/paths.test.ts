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

  it("resolves macOS application bundle layouts inside Contents", () => {
    const macPaths = installationPaths(path.join("/", "Applications", "Antigravity.app"));
    expect(macPaths.resources).toBe(path.join("/", "Applications", "Antigravity.app", "Contents", "Resources"));
    expect(macPaths.executable).toBe(path.join("/", "Applications", "Antigravity.app", "Contents", "MacOS", "Antigravity"));
    expect(path.basename(macPaths.currentAsar)).toBe("app.asar");
    expect(macPaths.currentAsar).toBe(path.join(macPaths.resources, "app.asar"));
    expect(macPaths.originalAsar).toBe(path.join(macPaths.resources, "_app.asar"));
    expect(macPaths.runtimeRoot).toBe(path.join(macPaths.resources, ".bettergravity"));
  });

  it("normalizes nested Contents or Resources paths for macOS bundles", () => {
    const bundle = path.join("/", "Applications", "Antigravity.app");
    const fromContents = installationPaths(path.join(bundle, "Contents"));
    const fromResources = installationPaths(path.join(bundle, "Contents", "Resources"));

    expect(fromContents.root).toBe(bundle);
    expect(fromContents.resources).toBe(path.join(bundle, "Contents", "Resources"));
    expect(fromResources.root).toBe(bundle);
    expect(fromResources.resources).toBe(path.join(bundle, "Contents", "Resources"));
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

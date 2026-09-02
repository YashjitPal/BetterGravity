import { describe, expect, it } from "vitest";
import { availableOperations } from "../src/types.js";
import { bootstrapSource } from "../src/native/bootstrap.js";

describe("availableOperations", () => {
  it("offers only an install for a stock Antigravity", () => {
    expect(availableOperations({ kind: "detected" })).toEqual(["install"]);
  });

  it("never offers a plain install once BetterGravity is present", () => {
    for (const kind of ["patched", "needs-repatch", "corrupted"] as const) {
      expect(availableOperations({ kind })).not.toContain("install");
    }
  });

  it("always offers a way out when something is installed", () => {
    for (const kind of ["patched", "needs-repatch", "corrupted"] as const) {
      expect(availableOperations({ kind })).toContain("uninstall");
    }
  });

  it("offers nothing when there is no installation to act on", () => {
    expect(availableOperations({ kind: "not-found" })).toEqual([]);
  });
});

describe("bootstrapSource", () => {
  const source = bootstrapSource("9.9.9");

  it("delegates to the original main", () => {
    expect(source).toContain("require(originalMain)");
  });

  it("wraps the runtime so a failure cannot stop Antigravity from starting", () => {
    const guarded = source.slice(source.indexOf("try {"), source.indexOf("require.main.filename"));
    expect(guarded).toContain("runtime");
    expect(guarded).toContain("catch");
    expect(source.indexOf("catch")).toBeLessThan(source.indexOf("require(originalMain)"));
  });

  it("carries the version it was built with", () => {
    expect(source).toContain('"9.9.9"');
  });

  it("never hard-codes the host identity", () => {
    expect(source).not.toContain("bettergravity-bootstrap");
    expect(source).toContain("originalPackage.productName || originalPackage.name");
  });
});

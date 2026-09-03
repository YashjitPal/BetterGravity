import { describe, expect, it } from "vitest";
import { applySourcePatches, readPatches, type PluginPatches } from "../src/main/source-patch.js";

const bundle = 'var a=1;function q(){return"agent-input-box"}var b=2;function r(){return"send-button"}';

const set = (patches: PluginPatches["patches"], pluginId = "demo"): PluginPatches => ({ pluginId, patches });

describe("applySourcePatches", () => {
  it("leaves the source alone when nothing is declared", () => {
    const outcome = applySourcePatches(bundle, []);
    expect(outcome.source).toBe(bundle);
    expect(outcome.changed).toBe(false);
  });

  it("applies a replacement once its anchor is present", () => {
    const outcome = applySourcePatches(bundle, [
      set([{ find: "agent-input-box", replace: [{ match: "var a=1", with: "var a=42" }] }])
    ]);

    expect(outcome.source).toContain("var a=42");
    expect(outcome.changed).toBe(true);
    expect(outcome.applied).toEqual(["demo"]);
    expect(outcome.failures).toEqual([]);
  });

  // The anchor is a version guard. If Antigravity changes and it disappears, the
  // patch must be skipped rather than applied somewhere unintended.
  it("skips the patch and says so when the anchor is gone", () => {
    const outcome = applySourcePatches(bundle, [set([{ find: "no-longer-present", replace: [{ match: "var a=1", with: "boom" }] }])]);

    expect(outcome.source).toBe(bundle);
    expect(outcome.applied).toEqual([]);
    expect(outcome.failures[0]?.reason).toMatch(/anchor not found/);
  });

  it("reports a replacement that matches nothing", () => {
    const outcome = applySourcePatches(bundle, [set([{ find: "agent-input-box", replace: [{ match: "absent", with: "x" }] }])]);

    expect(outcome.changed).toBe(false);
    expect(outcome.failures[0]?.reason).toMatch(/no match/);
  });

  it("replaces only the first occurrence unless asked otherwise", () => {
    const source = "x;x;x;";
    expect(applySourcePatches(source, [set([{ find: "x", replace: [{ match: "x", with: "y" }] }])]).source).toBe("y;x;x;");
    expect(applySourcePatches(source, [set([{ find: "x", replace: [{ match: "x", with: "y", all: true }] }])]).source).toBe("y;y;y;");
  });

  it("supports capture groups", () => {
    const outcome = applySourcePatches(bundle, [
      set([{ find: "send-button", replace: [{ match: 'return"(send-button)"', with: 'return"patched-$1"' }] }])
    ]);

    expect(outcome.source).toContain('return"patched-send-button"');
  });

  it("applies patches from several plugins in turn", () => {
    const outcome = applySourcePatches(bundle, [
      set([{ find: "var a=1", replace: [{ match: "var a=1", with: "var a=10" }] }], "first"),
      set([{ find: "var b=2", replace: [{ match: "var b=2", with: "var b=20" }] }], "second")
    ]);

    expect(outcome.source).toContain("var a=10");
    expect(outcome.source).toContain("var b=20");
    expect(outcome.applied).toEqual(["first", "second"]);
  });

  it("reports a broken regular expression instead of throwing", () => {
    const outcome = applySourcePatches(bundle, [set([{ find: "var a=1", replace: [{ match: "([unclosed", with: "x" }] }])]);

    expect(outcome.source).toBe(bundle);
    expect(outcome.failures[0]?.reason).toMatch(/invalid match/);
  });

  // A greedy pattern with `all` could rewrite most of an 8.7 MB bundle.
  it("refuses a replacement that matches implausibly often", () => {
    const outcome = applySourcePatches("a".repeat(500), [set([{ find: "a", replace: [{ match: "a", with: "b", all: true }] }])]);

    expect(outcome.changed).toBe(false);
    expect(outcome.failures[0]?.reason).toMatch(/exceeds the/);
  });

  // Several files are served, so a patch aimed at one is offered the others.
  // Callers hold anchor misses back and report only genuine problems.
  it("classifies why each patch failed", () => {
    const outcome = applySourcePatches(bundle, [
      set([{ find: "absent-anchor", replace: [{ match: "a", with: "b" }] }], "wrong-file"),
      set([{ find: "var a=1", replace: [{ match: "nowhere", with: "b" }] }], "stale"),
      set([{ find: "var a=1", replace: [{ match: "([bad", with: "b" }] }], "broken")
    ]);

    expect(outcome.failures.map((failure) => [failure.pluginId, failure.kind])).toEqual([
      ["wrong-file", "anchor"],
      ["stale", "match"],
      ["broken", "invalid"]
    ]);
  });

  it("keeps going after one plugin's patch fails", () => {
    const outcome = applySourcePatches(bundle, [
      set([{ find: "missing", replace: [{ match: "var a=1", with: "x" }] }], "broken"),
      set([{ find: "var b=2", replace: [{ match: "var b=2", with: "var b=20" }] }], "healthy")
    ]);

    expect(outcome.applied).toEqual(["healthy"]);
    expect(outcome.failures.map((failure) => failure.pluginId)).toEqual(["broken"]);
  });
});

describe("readPatches", () => {
  it("returns nothing for a manifest that declares none", () => {
    expect(readPatches("demo", { name: "Demo" })).toBeUndefined();
    expect(readPatches("demo", { patches: [] })).toBeUndefined();
    expect(readPatches("demo", null)).toBeUndefined();
  });

  it("reads a well-formed declaration", () => {
    const result = readPatches("demo", {
      patches: [{ find: "anchor", replace: [{ match: "a", with: "b", all: true }] }]
    });

    expect(result).toEqual({ pluginId: "demo", patches: [{ find: "anchor", replace: [{ match: "a", with: "b", all: true }] }] });
  });

  // A broken patch block should not stop the plugin itself from loading.
  it("ignores malformed entries rather than rejecting the plugin", () => {
    const result = readPatches("demo", {
      patches: [
        "not an object",
        { replace: [{ match: "a", with: "b" }] },
        { find: "anchor" },
        { find: "anchor", replace: [{ match: 1, with: "b" }] },
        { find: "good", replace: [{ match: "a", with: "b" }] }
      ]
    });

    expect(result?.patches).toEqual([{ find: "good", replace: [{ match: "a", with: "b" }] }]);
  });

  it("omits the all flag unless it is exactly true", () => {
    const result = readPatches("demo", { patches: [{ find: "x", replace: [{ match: "a", with: "b", all: "yes" }] }] });
    expect(result?.patches[0]?.replace[0]).toEqual({ match: "a", with: "b" });
  });
});

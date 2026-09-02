import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/protocol.js";
import { applyPatch, normalizeSettings } from "../src/main/settings.js";

describe("normalizeSettings", () => {
  it("falls back to defaults for anything unusable", () => {
    for (const input of [undefined, null, 42, "settings", [], { themes: "nope" }]) {
      expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("keeps developer mode off unless it is exactly true", () => {
    for (const value of ["true", 1, "yes", {}, null]) {
      expect(normalizeSettings({ plugins: { developerMode: value } }).plugins.developerMode).toBe(false);
    }
    expect(normalizeSettings({ plugins: { developerMode: true } }).plugins.developerMode).toBe(true);
  });

  it("drops non-string and duplicate entries", () => {
    const settings = normalizeSettings({ themes: { enabled: ["a.css", "a.css", 7, null, "b.css"] } });
    expect(settings.themes.enabled).toEqual(["a.css", "b.css"]);
  });

  it("always reports the current schema version", () => {
    expect(normalizeSettings({ schemaVersion: 99 }).schemaVersion).toBe(1);
  });
});

describe("applyPatch", () => {
  const current = normalizeSettings({
    themes: { enabled: ["a.css"] },
    plugins: { developerMode: true, enabled: ["one"] }
  });

  it("leaves untouched fields alone", () => {
    expect(applyPatch(current, {})).toEqual(current);
  });

  it("replaces only the field provided", () => {
    expect(applyPatch(current, { themes: { enabled: ["b.css"] } })).toMatchObject({
      themes: { enabled: ["b.css"] },
      plugins: { developerMode: true, enabled: ["one"] }
    });
  });

  it("can turn developer mode back off", () => {
    expect(applyPatch(current, { plugins: { developerMode: false } }).plugins.developerMode).toBe(false);
  });

  it("normalises whatever the patch contains", () => {
    const patched = applyPatch(current, { themes: { enabled: ["x.css", "x.css"] } });
    expect(patched.themes.enabled).toEqual(["x.css"]);
  });
});

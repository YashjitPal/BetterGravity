import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPlugins, readThemes } from "../src/main/catalog.js";
import { normalizeSettings } from "../src/main/settings.js";
import { DEFAULT_SETTINGS } from "../src/protocol.js";

let root: string;

const settingsWith = (overrides: Parameters<typeof normalizeSettings>[0]) => normalizeSettings(overrides);

function writePlugin(id: string, manifest: unknown, source = "// plugin"): void {
  const directory = path.join(root, "plugins", id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "plugin.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, "index.js"), source);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bg-catalog-"));
  fs.mkdirSync(path.join(root, "themes"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugins"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("readThemes", () => {
  it("returns nothing for a missing directory instead of throwing", () => {
    expect(readThemes(path.join(root, "absent"), DEFAULT_SETTINGS).entries).toEqual([]);
  });

  it("loads css files and marks the enabled ones", () => {
    fs.writeFileSync(path.join(root, "themes", "midnight.css"), "body { color: red; }");
    fs.writeFileSync(path.join(root, "themes", "dawn.css"), "body { color: blue; }");

    const { entries } = readThemes(path.join(root, "themes"), settingsWith({ themes: { enabled: ["midnight.css"] } }));

    expect(entries.map((theme) => theme.name)).toEqual(["dawn", "midnight"]);
    expect(entries.find((theme) => theme.id === "midnight.css")).toMatchObject({ enabled: true, css: "body { color: red; }" });
    expect(entries.find((theme) => theme.id === "dawn.css")?.enabled).toBe(false);
  });

  it("ignores files that are not css", () => {
    fs.writeFileSync(path.join(root, "themes", "notes.txt"), "hello");
    fs.writeFileSync(path.join(root, "themes", "theme.CSS"), "body {}");
    expect(readThemes(path.join(root, "themes"), DEFAULT_SETTINGS).entries.map((theme) => theme.id)).toEqual(["theme.CSS"]);
  });

  it("prefers the metadata header over the file name", () => {
    fs.writeFileSync(
      path.join(root, "themes", "file-name.css"),
      "/**\n * @name Pretty Name\n * @author someone\n * @version 2.0.0\n */\nbody {}"
    );

    const [theme] = readThemes(path.join(root, "themes"), DEFAULT_SETTINGS).entries;

    expect(theme).toMatchObject({ id: "file-name.css", name: "Pretty Name", author: "someone", version: "2.0.0" });
  });

  it("falls back to the file name when there is no header", () => {
    fs.writeFileSync(path.join(root, "themes", "bare.css"), "body {}");
    expect(readThemes(path.join(root, "themes"), DEFAULT_SETTINGS).entries[0]).toMatchObject({
      name: "bare",
      author: "Unknown",
      version: "0.0.0"
    });
  });

  it("reports oversized themes as diagnostics rather than dropping them silently", () => {
    fs.writeFileSync(path.join(root, "themes", "huge.css"), "a".repeat(3 * 1024 * 1024));
    const { entries, diagnostics } = readThemes(path.join(root, "themes"), DEFAULT_SETTINGS);
    expect(entries).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ source: "theme huge.css" });
    expect(diagnostics[0]?.message).toMatch(/limit/);
  });
});

describe("readPlugins", () => {
  it("loads nothing while developer mode is off", () => {
    writePlugin("demo", { name: "Demo" });
    expect(readPlugins(path.join(root, "plugins"), DEFAULT_SETTINGS).entries).toEqual([]);
  });

  it("loads plugins once developer mode is on", () => {
    writePlugin("demo", { name: "Demo", description: "A demo.", version: "1.2.3", author: "someone" }, "console.log(1);");

    const { entries } = readPlugins(path.join(root, "plugins"), settingsWith({ plugins: { developerMode: true, enabled: ["demo"] } }));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "demo",
      name: "Demo",
      description: "A demo.",
      version: "1.2.3",
      author: "someone",
      source: "console.log(1);",
      enabled: true
    });
  });

  it("falls back to sensible values for a sparse manifest", () => {
    writePlugin("sparse", {});
    const [plugin] = readPlugins(path.join(root, "plugins"), settingsWith({ plugins: { developerMode: true } })).entries;
    expect(plugin).toMatchObject({ id: "sparse", name: "sparse", version: "0.0.0", author: "Unknown", enabled: false });
  });

  it("refuses a manifest whose entry point escapes the plugin directory", () => {
    const directory = path.join(root, "plugins", "escape");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "plugin.json"), JSON.stringify({ name: "Escape", main: "../../../secrets.js" }));
    fs.writeFileSync(path.join(root, "secrets.js"), "stolen");

    const { entries, diagnostics } = readPlugins(path.join(root, "plugins"), settingsWith({ plugins: { developerMode: true } }));

    expect(entries).toEqual([]);
    expect(diagnostics[0]?.message).toMatch(/escapes the plugin directory/);
  });

  it("reports a broken plugin without losing the healthy ones", () => {
    writePlugin("good", { name: "Good" });
    fs.mkdirSync(path.join(root, "plugins", "broken"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugins", "broken", "plugin.json"), "{ not json");

    const { entries, diagnostics } = readPlugins(path.join(root, "plugins"), settingsWith({ plugins: { developerMode: true } }));

    expect(entries.map((plugin) => plugin.id)).toEqual(["good"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.source).toBe("plugin broken");
  });

  it("ignores loose files that are not plugin directories", () => {
    fs.writeFileSync(path.join(root, "plugins", "stray.js"), "console.log(1);");
    expect(readPlugins(path.join(root, "plugins"), settingsWith({ plugins: { developerMode: true } })).entries).toEqual([]);
  });
});

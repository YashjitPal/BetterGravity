import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyContent, runtimePaths } from "../src/main/paths.js";

let base: string;
let legacy: string;
let paths: ReturnType<typeof runtimePaths>;

const write = (file: string, contents: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "bg-paths-"));
  legacy = path.join(base, "install", ".bettergravity");
  paths = runtimePaths(path.join(base, "userdata"));
  fs.mkdirSync(paths.root, { recursive: true });
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("runtimePaths", () => {
  it("places everything under the user data directory", () => {
    for (const entry of [paths.themes, paths.plugins, paths.settings, paths.storage, paths.log]) {
      expect(entry.startsWith(paths.root)).toBe(true);
    }
  });
});

describe("migrateLegacyContent", () => {
  it("does nothing when there is no old directory", () => {
    expect(migrateLegacyContent(legacy, paths)).toEqual([]);
  });

  it("moves themes, plugins, settings, and storage across", () => {
    write(path.join(legacy, "themes", "midnight.css"), "body {}");
    write(path.join(legacy, "plugins", "timer", "plugin.json"), "{}");
    write(path.join(legacy, "settings.json"), '{"schemaVersion":1}');
    write(path.join(legacy, "storage.json"), '{"timer":{"count":3}}');

    const moved = migrateLegacyContent(legacy, paths);

    expect([...moved].sort()).toEqual(["plugins", "settings.json", "storage.json", "themes"]);
    expect(fs.readFileSync(path.join(paths.themes, "midnight.css"), "utf8")).toBe("body {}");
    expect(fs.existsSync(path.join(paths.plugins, "timer", "plugin.json"))).toBe(true);
    expect(fs.readFileSync(paths.storage, "utf8")).toBe('{"timer":{"count":3}}');
  });

  // Installation backups live alongside the old content and must stay put.
  it("leaves anything it does not own behind", () => {
    write(path.join(legacy, "backups", "app-2026.asar"), "binary");
    write(path.join(legacy, "runtime", "main.cjs"), "code");

    migrateLegacyContent(legacy, paths);

    expect(fs.existsSync(path.join(legacy, "backups", "app-2026.asar"))).toBe(true);
    expect(fs.existsSync(path.join(legacy, "runtime", "main.cjs"))).toBe(true);
  });

  it("never overwrites content already in the new location", () => {
    write(path.join(legacy, "settings.json"), '{"from":"legacy"}');
    write(paths.settings, '{"from":"current"}');

    expect(migrateLegacyContent(legacy, paths)).toEqual([]);
    expect(fs.readFileSync(paths.settings, "utf8")).toBe('{"from":"current"}');
  });

  it("treats an empty new directory as free to fill", () => {
    write(path.join(legacy, "themes", "a.css"), "body {}");
    fs.mkdirSync(paths.themes, { recursive: true });

    expect(migrateLegacyContent(legacy, paths)).toEqual(["themes"]);
    expect(fs.existsSync(path.join(paths.themes, "a.css"))).toBe(true);
  });

  it("discards empty directories left by an earlier install", () => {
    fs.mkdirSync(path.join(legacy, "themes"), { recursive: true });
    expect(migrateLegacyContent(legacy, paths)).toEqual([]);
    expect(fs.existsSync(path.join(legacy, "themes"))).toBe(false);
  });

  it("discards the old log, which the new one supersedes", () => {
    write(path.join(legacy, "runtime.log"), "old entries");
    migrateLegacyContent(legacy, paths);
    expect(fs.existsSync(path.join(legacy, "runtime.log"))).toBe(false);
  });

  it("is safe to run twice", () => {
    write(path.join(legacy, "themes", "a.css"), "body {}");
    migrateLegacyContent(legacy, paths);
    expect(migrateLegacyContent(legacy, paths)).toEqual([]);
    expect(fs.existsSync(path.join(paths.themes, "a.css"))).toBe(true);
  });
});

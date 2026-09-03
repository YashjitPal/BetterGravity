import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  isCatalog,
  isSingleFileTheme,
  validatePlugin,
  validateTheme,
  validateThemeFolder,
  type PluginFiles,
  type ThemeFiles
} from "../src/index.js";

const errors = (result: { findings: readonly { severity: string; message: string }[] }) =>
  result.findings.filter((finding) => finding.severity === "error").map((finding) => finding.message);
const notes = (result: { findings: readonly { severity: string; message: string }[] }) =>
  result.findings.filter((finding) => finding.severity === "note").map((finding) => finding.message);

const header = (overrides: Partial<Record<string, string>> = {}) => {
  const fields = { name: "Midnight", description: "A calm dark theme.", author: "someone", version: "1.0.0", ...overrides };
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` * @${key} ${value}`);
  return `/**\n${lines.join("\n")}\n */\nbody { color: red; }`;
};

describe("validateTheme", () => {
  it("accepts a complete theme and describes it", () => {
    const result = validateTheme("midnight.css", header({ source: "https://example.com/midnight" }));

    expect(errors(result)).toEqual([]);
    expect(result.entry).toMatchObject({
      id: "midnight.css",
      kind: "theme",
      name: "Midnight",
      author: "someone",
      version: "1.0.0",
      source: "https://example.com/midnight",
      path: "community/themes/midnight.css"
    });
    expect(result.entry?.bytes).toBeGreaterThan(0);
  });

  it("requires every field the catalog displays", () => {
    const result = validateTheme("bare.css", "body {}");
    expect(errors(result)).toEqual(["@name is required.", "@description is required.", "@author is required.", "@version is required."]);
    expect(result.entry).toBeUndefined();
  });

  it("insists on a .css file", () => {
    expect(errors(validateTheme("theme.txt", header()))).toContain("A theme must be a .css file.");
  });

  it("insists on a predictable file name", () => {
    for (const name of ["Midnight.css", "my theme.css", "theme_one.css", "--x.css"]) {
      expect(errors(validateTheme(name, header())).join(" ")).toMatch(/lower case with hyphens/);
    }
    expect(errors(validateTheme("midnight-blue-2.css", header()))).toEqual([]);
  });

  // A hosted stylesheet is how BetterDiscord-style themes ship updates. The
  // reviewer sees the stub, so the link is pointed out rather than refused.
  it("allows a remote https @import and tells the reviewer where it points", () => {
    for (const line of ['@import url("https://someone.github.io/x.css");', "@import 'https://someone.github.io/x.css';", "@import url(https://someone.github.io/x.css) screen;"]) {
      const result = validateTheme("t.css", `${header()}\n${line}`);
      expect(errors(result)).toEqual([]);
      expect(notes(result).join(" ")).toMatch(/Imports a hosted stylesheet from https:\/\/someone\.github\.io\/x\.css/);
    }
  });

  it("rejects a remote @import that is not https, which the page would block anyway", () => {
    for (const line of ['@import url("http://someone.example/x.css");', "@import '//someone.example/x.css';"]) {
      expect(errors(validateTheme("t.css", `${header()}\n${line}`)).join(" ")).toMatch(/must use https/);
    }
  });

  it("allows a local @import", () => {
    const result = validateTheme("t.css", `${header()}\n@import "shared.css";`);
    expect(errors(result)).toEqual([]);
    expect(notes(result)).toEqual([]);
  });

  it("flags a remote resource for the reviewer without blocking it", () => {
    const result = validateTheme("t.css", `${header()}\nbody { background: url("https://cdn.example/bg.png"); }`);
    expect(errors(result)).toEqual([]);
    expect(notes(result).join(" ")).toMatch(/remote resource/);
  });

  it("rejects a theme above the size limit", () => {
    const huge = `${header()}\n/* ${"a".repeat(2 * 1024 * 1024)} */`;
    expect(errors(validateTheme("big.css", huge)).join(" ")).toMatch(/above the/);
  });
});

const themeFiles = (overrides: Partial<ThemeFiles> = {}): ThemeFiles => ({
  fileNames: ["theme.css", "parts", "parts/menu.css", "fonts", "fonts/x.woff2"],
  stylesheets: [
    { name: "theme.css", css: `${header()}\n@import "parts/menu.css";` },
    { name: "parts/menu.css", css: "[role=menu] { background: url(../fonts/x.woff2); }" }
  ],
  totalBytes: 3072,
  files: [
    { name: "theme.css", bytes: 1024, sha256: "a".repeat(64) },
    { name: "parts/menu.css", bytes: 1024, sha256: "b".repeat(64) },
    { name: "fonts/x.woff2", bytes: 1024, sha256: "c".repeat(64) }
  ],
  ...overrides
});

describe("validateThemeFolder", () => {
  it("accepts a folder with a theme.css and describes it by its folder", () => {
    const result = validateThemeFolder("midnight", themeFiles());

    expect(errors(result)).toEqual([]);
    expect(notes(result)).toEqual([]);
    expect(result.entry).toMatchObject({
      id: "midnight",
      kind: "theme",
      name: "Midnight",
      path: "community/themes/midnight",
      bytes: 3072
    });
    expect(result.entry?.files.map((file) => file.name)).toEqual(["fonts/x.woff2", "parts/menu.css", "theme.css"]);
    expect(isSingleFileTheme(result.entry!)).toBe(false);
  });

  it("accepts index.css as the entry when there is no theme.css", () => {
    const result = validateThemeFolder("midnight", themeFiles({ stylesheets: [{ name: "index.css", css: header() }] }));
    expect(errors(result)).toEqual([]);
  });

  it("requires an entry stylesheet and stops there", () => {
    const result = validateThemeFolder("midnight", themeFiles({ stylesheets: [{ name: "styles.css", css: header() }] }));
    expect(errors(result)).toEqual(["theme.css or index.css is missing."]);
  });

  it("reads the metadata from the entry file", () => {
    const result = validateThemeFolder("midnight", themeFiles({ stylesheets: [{ name: "theme.css", css: "body {}" }] }));
    expect(errors(result)).toEqual(["@name is required.", "@description is required.", "@author is required.", "@version is required."]);
  });

  it("insists on a predictable folder name", () => {
    expect(errors(validateThemeFolder("My Theme", themeFiles())).join(" ")).toMatch(/lower case with hyphens/);
  });

  it("reviews every stylesheet in the folder for remote references, saying which", () => {
    const stylesheets = [
      { name: "theme.css", css: header() },
      { name: "parts/fonts.css", css: '@import url("https://fonts.googleapis.com/css2?family=Inter");' }
    ];
    const result = validateThemeFolder("midnight", themeFiles({ stylesheets }));

    expect(errors(result)).toEqual([]);
    expect(notes(result).join(" ")).toMatch(/^parts\/fonts\.css: Imports a hosted stylesheet/);
  });

  it("has a larger limit than a single file, since fonts live here", () => {
    expect(errors(validateThemeFolder("midnight", themeFiles({ totalBytes: 6 * 1024 * 1024 })))).toEqual([]);
    expect(errors(validateThemeFolder("midnight", themeFiles({ totalBytes: 9 * 1024 * 1024 }))).join(" ")).toMatch(/above the/);
  });

  it("refuses node_modules and paths that escape the folder", () => {
    const fileNames = [...themeFiles().fileNames, "node_modules/x/index.css"];
    expect(errors(validateThemeFolder("midnight", themeFiles({ fileNames }))).join(" ")).toMatch(/node_modules/);

    const files = [...themeFiles().files, { name: "../outside.css", bytes: 1, sha256: "d".repeat(64) }];
    expect(errors(validateThemeFolder("midnight", themeFiles({ files }))).join(" ")).toMatch(/plain path inside/);
  });
});

describe("isSingleFileTheme", () => {
  it("tells a file listing from a folder listing by its id", () => {
    expect(isSingleFileTheme({ kind: "theme", id: "midnight.css" })).toBe(true);
    expect(isSingleFileTheme({ kind: "theme", id: "midnight" })).toBe(false);
    expect(isSingleFileTheme({ kind: "plugin", id: "word-count" })).toBe(false);
  });
});

const pluginFiles = (overrides: Partial<PluginFiles> = {}): PluginFiles => ({
  manifest: JSON.stringify({ name: "Word Count", description: "Counts words.", version: "1.0.0", author: "someone" }),
  fileNames: ["plugin.json", "index.js"],
  entrySource: "plugin.log.info('hi');",
  totalBytes: 2048,
  files: [
    { name: "plugin.json", bytes: 1024, sha256: "a".repeat(64) },
    { name: "index.js", bytes: 1024, sha256: "b".repeat(64) }
  ],
  ...overrides
});

describe("validatePlugin", () => {
  it("accepts a complete plugin and describes it", () => {
    const result = validatePlugin("word-count", pluginFiles());

    expect(errors(result)).toEqual([]);
    expect(result.entry).toMatchObject({
      id: "word-count",
      kind: "plugin",
      name: "Word Count",
      version: "1.0.0",
      path: "community/plugins/word-count"
    });
  });

  it("reports a missing manifest and stops there", () => {
    const result = validatePlugin("x", pluginFiles({ manifest: undefined }));
    expect(errors(result)).toEqual(["plugin.json is missing."]);
  });

  it("reports unparseable JSON rather than throwing", () => {
    const result = validatePlugin("word-count", pluginFiles({ manifest: "{ not json" }));
    expect(errors(result)).toEqual(["plugin.json is not valid JSON."]);
  });

  it("requires every field the catalog displays", () => {
    const result = validatePlugin("word-count", pluginFiles({ manifest: "{}" }));
    expect(errors(result)).toEqual(["name is required.", "description is required.", "version is required.", "author is required."]);
  });

  it("defaults main to index.js", () => {
    expect(errors(validatePlugin("word-count", pluginFiles()))).toEqual([]);
  });

  it("requires main to exist", () => {
    const manifest = JSON.stringify({ name: "n", description: "d", version: "1", author: "a", main: "missing.js" });
    expect(errors(validatePlugin("word-count", pluginFiles({ manifest }))).join(" ")).toMatch(/does not exist/);
  });

  it("refuses a main that escapes the folder", () => {
    for (const main of ["../outside.js", "/etc/passwd", "..\\outside.js"]) {
      const manifest = JSON.stringify({ name: "n", description: "d", version: "1", author: "a", main });
      expect(errors(validatePlugin("word-count", pluginFiles({ manifest }))).join(" ")).toMatch(/must stay inside/);
    }
  });

  it("refuses committed dependencies, which nobody reviews", () => {
    const fileNames = ["plugin.json", "index.js", "node_modules/left-pad/index.js"];
    expect(errors(validatePlugin("word-count", pluginFiles({ fileNames }))).join(" ")).toMatch(/node_modules/);
  });

  it("rejects a folder above the size limit", () => {
    expect(errors(validatePlugin("word-count", pluginFiles({ totalBytes: 5 * 1024 * 1024 }))).join(" ")).toMatch(/above the/);
  });

  // These are legitimate in plenty of plugins, so they inform review rather
  // than block it.
  it("flags risky calls for the reviewer without blocking them", () => {
    const cases: readonly [string, RegExp][] = [
      ["eval('x')", /uses eval/],
      ["new Function('a')", /new Function/],
      ["fetch('https://x')", /network requests/],
      ["import('./x.js')", /dynamically/],
      ["localStorage.getItem('a')", /browser storage/]
    ];
    for (const [source, expected] of cases) {
      const result = validatePlugin("word-count", pluginFiles({ entrySource: source }));
      expect(errors(result)).toEqual([]);
      expect(notes(result).join(" ")).toMatch(expected);
    }
  });

  it("says nothing about an ordinary plugin", () => {
    expect(notes(validatePlugin("word-count", pluginFiles()))).toEqual([]);
  });
});

describe("buildCatalog", () => {
  const entry = (id: string, kind: "theme" | "plugin") =>
    ({
      id,
      kind,
      name: id,
      description: "",
      version: "1.0.0",
      author: "a",
      path: `community/${kind}s/${id}`,
      bytes: 1,
      files: []
    }) as const;

  it("orders by kind then id, so the file has a stable diff", () => {
    const catalog = buildCatalog([entry("z.css", "theme"), entry("b", "plugin"), entry("a.css", "theme"), entry("a", "plugin")]);
    expect(catalog.entries.map((e) => `${e.kind}:${e.id}`)).toEqual(["plugin:a", "plugin:b", "theme:a.css", "theme:z.css"]);
  });

  it("produces something the guard recognises", () => {
    expect(isCatalog(buildCatalog([]))).toBe(true);
  });

  it("rejects anything that is not a catalog", () => {
    for (const value of [undefined, null, {}, [], { schemaVersion: 2, entries: [] }, { schemaVersion: 1 }]) {
      expect(isCatalog(value)).toBe(false);
    }
  });
});

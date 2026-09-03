import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_THEME_FOLDER_BYTES, bundleThemeFolder, findThemeEntry } from "../src/main/theme-bundle.js";

let folder: string;

function write(relative: string, content: string | Buffer): void {
  const target = path.join(folder, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "bg-bundle-"));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

describe("findThemeEntry", () => {
  it("prefers theme.css, then index.css", () => {
    expect(findThemeEntry(folder)).toBeUndefined();
    write("index.css", "");
    expect(path.basename(findThemeEntry(folder) ?? "")).toBe("index.css");
    write("theme.css", "");
    expect(path.basename(findThemeEntry(folder) ?? "")).toBe("theme.css");
  });
});

describe("bundleThemeFolder", () => {
  it("inlines a local @import where it stood", () => {
    write("theme.css", '/** @name T */\n@import "parts/menus.css";\nbody { color: red; }');
    write("parts/menus.css", "[role=menu] { color: blue; }");

    const { css, warnings } = bundleThemeFolder(folder);

    expect(warnings).toEqual([]);
    expect(css).not.toContain("@import");
    expect(css).toContain("[role=menu] { color: blue; }");
    expect(css.indexOf("[role=menu]")).toBeLessThan(css.indexOf("body { color: red; }"));
  });

  it("resolves nested imports relative to the file that made them", () => {
    write("theme.css", '@import url("parts/a.css");');
    write("parts/a.css", '@import "deeper/b.css";\n.a {}');
    write("parts/deeper/b.css", ".b {}");

    const { css, warnings } = bundleThemeFolder(folder);

    expect(warnings).toEqual([]);
    expect(css).toContain(".b {}");
    expect(css).toContain(".a {}");
  });

  it("wraps a media-conditioned import in the matching @media block", () => {
    write("theme.css", '@import "wide.css" (min-width: 900px);');
    write("wide.css", ".wide {}");

    const { css } = bundleThemeFolder(folder);

    expect(css).toMatch(/@media \(min-width: 900px\) \{[\s\S]*\.wide \{\}[\s\S]*\}/);
  });

  it("turns a local url() into a data URI with the right type", () => {
    write("theme.css", '@font-face { font-family: X; src: url("fonts/x.woff2") format("woff2"); }\n.a { background: url(img/bg.png); }');
    write("fonts/x.woff2", Buffer.from([1, 2, 3]));
    write("img/bg.png", Buffer.from([4, 5, 6]));

    const { css, warnings } = bundleThemeFolder(folder);

    expect(warnings).toEqual([]);
    expect(css).toContain(`url("data:font/woff2;base64,${Buffer.from([1, 2, 3]).toString("base64")}")`);
    expect(css).toContain(`url("data:image/png;base64,${Buffer.from([4, 5, 6]).toString("base64")}")`);
  });

  it("leaves remote, data, and root-relative urls alone", () => {
    const rules = [
      ".a { background: url(https://cdn.example/bg.png); }",
      ".b { background: url(//cdn.example/bg.png); }",
      ".c { background: url(data:image/png;base64,AAAA); }",
      ".d { background: url(/served/by/host.png); }",
      ".e { mask: url(#fragment); }"
    ].join("\n");
    write("theme.css", rules);

    expect(bundleThemeFolder(folder).css).toBe(rules);
  });

  // Where a BetterDiscord-style theme keeps its real stylesheet.
  it("hoists a remote @import to the top so the browser will honour it", () => {
    write("theme.css", '/** @name T */\n@import "local.css";\n@import url("https://example.github.io/theme.css");\nbody {}');
    write("local.css", ".local {}");

    const { css, warnings } = bundleThemeFolder(folder);

    expect(warnings).toEqual([]);
    expect(css.startsWith('@import url("https://example.github.io/theme.css");')).toBe(true);
    expect(css.match(/@import/g)).toHaveLength(1);
    expect(css).toContain(".local {}");
  });

  it("hoists a remote import found in a partial, too", () => {
    write("theme.css", '@import "part.css";\nbody {}');
    write("part.css", '@import url("https://fonts.googleapis.com/css2?family=Inter");\n.part {}');

    const { css } = bundleThemeFolder(folder);

    expect(css.startsWith("@import url(\"https://fonts.googleapis.com/css2?family=Inter\");")).toBe(true);
  });

  it("does not touch references inside comments", () => {
    write("theme.css", '/* @import "nope.css"; url(missing.png) */\nbody {}');

    const { css, warnings } = bundleThemeFolder(folder);

    expect(warnings).toEqual([]);
    expect(css).toContain('/* @import "nope.css"; url(missing.png) */');
  });

  it("warns about a missing file and carries on", () => {
    write("theme.css", '@import "absent.css";\n.a { background: url(absent.png); }');

    const { css, warnings } = bundleThemeFolder(folder);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/absent\.css.*not found/);
    expect(warnings[1]).toMatch(/absent\.png.*not found/);
    expect(css).toContain("url(absent.png)");
  });

  it("refuses to follow a reference out of the folder", () => {
    fs.writeFileSync(path.join(folder, "..", "bg-bundle-outside.css"), ".stolen {}");
    write("theme.css", '@import "../bg-bundle-outside.css";\n.a { background: url(../bg-bundle-outside.css); }');

    try {
      const { css, warnings } = bundleThemeFolder(folder);
      expect(css).not.toContain(".stolen");
      expect(warnings.join(" ")).toMatch(/outside the theme folder/);
    } finally {
      fs.rmSync(path.join(folder, "..", "bg-bundle-outside.css"), { force: true });
    }
  });

  it("breaks an import cycle instead of recursing forever", () => {
    write("theme.css", '@import "a.css";');
    write("a.css", '@import "b.css";\n.a {}');
    write("b.css", '@import "a.css";\n.b {}');

    const { css, warnings } = bundleThemeFolder(folder);

    expect(css).toContain(".a {}");
    expect(css).toContain(".b {}");
    expect(warnings.join(" ")).toMatch(/loop/);
  });

  it("keeps the entry file's own text for the metadata header", () => {
    const entry = "/**\n * @name Folder Theme\n */\n@import \"part.css\";";
    write("theme.css", entry);
    write("part.css", ".part {}");

    expect(bundleThemeFolder(folder).entryCss).toBe(entry);
  });

  it("throws when there is no entry stylesheet", () => {
    write("styles.css", "body {}");
    expect(() => bundleThemeFolder(folder)).toThrow(/theme\.css or index\.css/);
  });

  it("throws when the folder is over the size limit", () => {
    write("theme.css", "body {}");
    write("big.bin", Buffer.alloc(MAX_THEME_FOLDER_BYTES + 1));
    expect(() => bundleThemeFolder(folder)).toThrow(/above the/);
  });
});

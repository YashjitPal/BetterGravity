import { describe, expect, it } from "vitest";
import { parseThemeMetadata, remoteThemeStub, themeMetadataTemplate } from "../src/index.js";

const header = (body: string) => `/**\n${body}\n */\nbody { color: red; }`;

describe("parseThemeMetadata", () => {
  it("reads the documented annotations", () => {
    const css = header(
      [
        " * @name        Midnight",
        " * @description A calm dark theme.",
        " * @author      someone",
        " * @version     1.2.0",
        " * @source      https://example.com/midnight"
      ].join("\n")
    );

    expect(parseThemeMetadata(css)).toEqual({
      name: "Midnight",
      description: "A calm dark theme.",
      author: "someone",
      version: "1.2.0",
      source: "https://example.com/midnight"
    });
  });

  it("treats a theme without a header as perfectly valid", () => {
    expect(parseThemeMetadata("body { color: red; }")).toEqual({});
  });

  it("ignores annotations it does not recognise", () => {
    expect(parseThemeMetadata(header(" * @name Kept\n * @unknown Dropped"))).toEqual({ name: "Kept" });
  });

  it("keeps the first value when a key repeats", () => {
    expect(parseThemeMetadata(header(" * @name First\n * @name Second")).name).toBe("First");
  });

  it("only reads the leading comment", () => {
    const css = `body { color: red; }\n/**\n * @name Sneaky\n */`;
    expect(parseThemeMetadata(css)).toEqual({});
  });

  it("tolerates missing leading asterisks and extra spacing", () => {
    expect(parseThemeMetadata("/*\n@name  Loose   \n*/\nbody{}")).toEqual({ name: "Loose" });
  });

  it("is case-insensitive on the key", () => {
    expect(parseThemeMetadata(header(" * @Name Cased")).name).toBe("Cased");
  });

  it("does not choke on an unterminated comment", () => {
    expect(() => parseThemeMetadata("/** @name Broken")).not.toThrow();
  });
});

describe("themeMetadataTemplate", () => {
  it("produces a header that parses back to the given name", () => {
    expect(parseThemeMetadata(`${themeMetadataTemplate("New Theme")}body {}`).name).toBe("New Theme");
  });
});

describe("remoteThemeStub", () => {
  it("writes a local stub whose only rule imports the hosted stylesheet", () => {
    const stub = remoteThemeStub("https://someone.github.io/ClearVision/ClearVision_v6.theme.css");

    expect(stub?.fileName).toBe("clearvision-v6-theme.css");
    expect(stub?.css).toContain('@import url("https://someone.github.io/ClearVision/ClearVision_v6.theme.css");');
    expect(parseThemeMetadata(stub?.css ?? "")).toMatchObject({
      name: "Clearvision V6 Theme",
      source: "https://someone.github.io/ClearVision/ClearVision_v6.theme.css"
    });
  });

  it("falls back to the host when the URL has no file name", () => {
    expect(remoteThemeStub("https://themes.example.com/")?.fileName).toBe("themes-example-com.css");
  });

  it("only accepts http(s) links", () => {
    for (const input of ["not a url", "file:///C:/theme.css", "javascript:alert(1)", ""]) {
      expect(remoteThemeStub(input)).toBeUndefined();
    }
  });

  it("cannot be broken out of by characters in the URL", () => {
    const stub = remoteThemeStub('https://x.example/a")*/;body{display:none}/*.css');
    expect(stub?.css.match(/\*\//g)).toHaveLength(1);
    expect(stub?.css).not.toContain('a")*/');
  });
});

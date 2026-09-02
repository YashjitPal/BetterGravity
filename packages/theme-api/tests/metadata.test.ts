import { describe, expect, it } from "vitest";
import { parseThemeMetadata, themeMetadataTemplate } from "../src/index.js";

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

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_ATTRIBUTE, applyThemes } from "../src/preload/themes.js";
import { PluginHost } from "../src/preload/plugins.js";
import type { PluginRecord, ThemeRecord } from "../src/protocol.js";

const theme = (id: string, enabled: boolean, css = `/* ${id} */`): ThemeRecord => ({
  id,
  name: id.replace(".css", ""),
  css,
  enabled
});

const plugin = (id: string, enabled: boolean, source = "globalThis.ran = true;"): PluginRecord => ({
  id,
  name: id,
  description: "",
  version: "1.0.0",
  author: "test",
  source,
  enabled
});

/** jsdom runs inline scripts through a resource queue rather than inline. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Captures the wrapper PluginHost builds around a plugin's own source. */
function generatedSource(record: PluginRecord): string {
  let script: HTMLScriptElement | undefined;
  const realCreate = document.createElement.bind(document);
  const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const element = realCreate(tag);
    if (tag === "script") script = element as HTMLScriptElement;
    return element;
  });
  new PluginHost().start([record]);
  spy.mockRestore();
  return script?.textContent ?? "";
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("applyThemes", () => {
  it("injects only the enabled themes", () => {
    const applied = applyThemes([theme("a.css", true), theme("b.css", false), theme("c.css", true)]);

    const injected = [...document.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)];
    expect(applied).toBe(2);
    expect(injected.map((style) => style.getAttribute(STYLE_ATTRIBUTE))).toEqual(["a.css", "c.css"]);
  });

  it("preserves the css verbatim", () => {
    applyThemes([theme("x.css", true, "body::after { content: 'hi'; }")]);
    expect(document.querySelector(`style[${STYLE_ATTRIBUTE}]`)?.textContent).toBe("body::after { content: 'hi'; }");
  });

  it("removes styles for themes that were turned off", () => {
    applyThemes([theme("a.css", true)]);
    applyThemes([theme("a.css", false)]);
    expect(document.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)).toHaveLength(0);
  });

  it("does not accumulate duplicates when re-applied", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) applyThemes([theme("a.css", true)]);
    expect(document.querySelectorAll(`style[${STYLE_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it("leaves styles it does not own alone", () => {
    const foreign = document.createElement("style");
    foreign.textContent = "/* antigravity */";
    document.head.appendChild(foreign);

    applyThemes([theme("a.css", true)]);

    expect(document.head.contains(foreign)).toBe(true);
  });
});

describe("PluginHost", () => {
  it("starts only enabled plugins", () => {
    const host = new PluginHost();
    expect(host.start([plugin("one", true), plugin("two", false)])).toEqual(["one"]);
    expect(host.isRunning("one")).toBe(true);
    expect(host.isRunning("two")).toBe(false);
  });

  it("never starts the same plugin twice in a session", () => {
    const host = new PluginHost();
    host.start([plugin("one", true)]);
    expect(host.start([plugin("one", true)])).toEqual([]);
  });

  // Arbitrary code cannot be reliably unloaded, so a disabled plugin keeps
  // running until the window reloads. Surfacing that is better than pretending.
  it("reports plugins that are disabled but still running", () => {
    const host = new PluginHost();
    host.start([plugin("one", true)]);
    expect(host.pending([plugin("one", false)])).toEqual(["one"]);
  });

  // jsdom really executes the injected script, so this exercises containment
  // rather than the shape of the generated wrapper. The error is constructed in
  // jsdom's realm, which is why it is matched loosely.
  it("contains a throwing plugin instead of letting it escape into the page", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => new PluginHost().start([plugin("boom", true, "throw new Error('nope');")])).not.toThrow();
    await settle();

    expect(reported).toHaveBeenCalledWith(expect.stringContaining("Plugin boom threw during startup."), expect.anything());
    reported.mockRestore();
  });

  it("threads the page's BetterGravity api into the plugin", () => {
    expect(generatedSource(plugin("api", true))).toContain("var api = window.BetterGravity;");
    expect(generatedSource(plugin("api", true))).toContain("})(api, { exports: {} }, {});");
  });

  it("embeds the plugin source verbatim", () => {
    expect(generatedSource(plugin("verbatim", true, "const x = 1 < 2 && 'ok';"))).toContain("const x = 1 < 2 && 'ok';");
  });

  it("removes the script element after injecting it", () => {
    new PluginHost().start([plugin("clean", true)]);
    expect(document.querySelectorAll("script[data-bettergravity-plugin]")).toHaveLength(0);
  });
});

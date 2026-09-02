// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_ATTRIBUTE, applyThemes } from "../src/preload/themes.js";
import { PluginHost } from "../src/world/plugins.js";
import type { PluginRecord, ThemeRecord } from "../src/protocol.js";

const theme = (id: string, enabled: boolean, css = `/* ${id} */`): ThemeRecord => ({
  id,
  name: id.replace(".css", ""),
  css,
  enabled
});

const plugin = (id: string, enabled: boolean, source = ""): PluginRecord => ({
  id,
  name: id,
  description: "",
  version: "1.0.0",
  author: "test",
  source,
  enabled
});

const written: { pluginId: string; key: string; value: unknown }[] = [];
const reported: string[] = [];
const hosts: PluginHost[] = [];

function createHost(): PluginHost {
  const host = new PluginHost({
    persist: (pluginId, key, value) => void written.push({ pluginId, key, value }),
    report: (message) => void reported.push(message),
    api: { marker: "api" }
  });
  hosts.push(host);
  return host;
}

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  written.length = 0;
  reported.length = 0;
});

// Plugins register MutationObservers, which would otherwise outlive the jsdom
// document and fire against a torn-down environment.
afterEach(() => {
  for (const host of hosts.splice(0)) host.sync([]);
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
    document.head.appendChild(foreign);
    applyThemes([theme("a.css", true)]);
    expect(document.head.contains(foreign)).toBe(true);
  });
});

describe("PluginHost lifecycle", () => {
  it("starts only the enabled plugins", () => {
    const outcome = createHost().sync([plugin("one", true), plugin("two", false)]);
    expect(outcome.started).toEqual(["one"]);
    expect(outcome.stopped).toEqual([]);
  });

  it("does not restart a plugin that is already running", () => {
    const host = createHost();
    host.sync([plugin("one", true)]);
    expect(host.sync([plugin("one", true)]).started).toEqual([]);
  });

  it("stops a plugin when it is disabled", () => {
    const host = createHost();
    host.sync([plugin("one", true)]);
    expect(host.sync([plugin("one", false)]).stopped).toEqual(["one"]);
    expect(host.isRunning("one")).toBe(false);
  });

  it("hands the plugin its context and the shared api", () => {
    const host = createHost();
    host.sync([plugin("probe", true, "globalThis.__seen = { api: BetterGravity.marker, id: plugin.manifest.id };")]);

    expect((globalThis as Record<string, unknown>)["__seen"]).toEqual({ api: "api", id: "probe" });
  });

  it("contains a plugin that throws while starting", () => {
    const silenced = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createHost();

    expect(() => host.sync([plugin("boom", true, "throw new Error('nope');")])).not.toThrow();

    expect(host.isRunning("boom")).toBe(false);
    expect(reported.some((line) => line.includes("boom") && line.includes("nope"))).toBe(true);
    silenced.mockRestore();
  });

  it("keeps healthy plugins running when a sibling fails", () => {
    const silenced = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = createHost();

    const outcome = host.sync([plugin("bad", true, "throw new Error('x');"), plugin("good", true)]);

    expect(outcome.started).toEqual(["good"]);
    expect(host.isRunning("good")).toBe(true);
    silenced.mockRestore();
  });
});

describe("plugin capabilities", () => {
  it("removes styles a plugin added when it is disabled", () => {
    const host = createHost();
    host.sync([plugin("styler", true, "plugin.styles.add('body { color: red; }');")]);
    expect(document.querySelectorAll("style[data-bettergravity-plugin-style]")).toHaveLength(1);

    host.sync([plugin("styler", false)]);
    expect(document.querySelectorAll("style[data-bettergravity-plugin-style]")).toHaveLength(0);
  });

  it("runs cleanups registered with onDispose", () => {
    const host = createHost();
    host.sync([plugin("tidy", true, "plugin.onDispose(function(){ globalThis.__disposed = true; });")]);
    expect((globalThis as Record<string, unknown>)["__disposed"]).toBeUndefined();

    host.sync([plugin("tidy", false)]);
    expect((globalThis as Record<string, unknown>)["__disposed"]).toBe(true);
  });

  it("persists storage writes through the bridge", () => {
    createHost().sync([plugin("saver", true, "plugin.storage.set('count', 3);")]);
    expect(written).toEqual([{ pluginId: "saver", key: "count", value: 3 }]);
  });

  it("reads storage that existed before the plugin started", () => {
    const host = createHost();
    host.useStorage({ reader: { greeting: "hello" } });
    host.sync([plugin("reader", true, "globalThis.__read = plugin.storage.get('greeting');")]);
    expect((globalThis as Record<string, unknown>)["__read"]).toBe("hello");
  });

  it("falls back when a storage key is absent", () => {
    createHost().sync([plugin("fallback", true, "globalThis.__fb = plugin.storage.get('missing', 'default');")]);
    expect((globalThis as Record<string, unknown>)["__fb"]).toBe("default");
  });

  it("returns the declared default until a setting is changed", () => {
    const host = createHost();
    host.sync([
      plugin(
        "settings",
        true,
        "plugin.settings.define({ compact: { type: 'boolean', label: 'Compact', default: true } });" +
          "globalThis.__before = plugin.settings.get('compact');"
      )
    ]);

    expect((globalThis as Record<string, unknown>)["__before"]).toBe(true);
    host.get("settings")?.writeSetting("compact", false);
    expect(host.get("settings")?.readSetting("compact")).toBe(false);
  });

  it("notifies the plugin when a setting changes", () => {
    const host = createHost();
    host.sync([plugin("watcher", true, "plugin.settings.onChange(function(k, v){ globalThis.__change = k + '=' + v; });")]);

    host.get("watcher")?.writeSetting("size", 12);

    expect((globalThis as Record<string, unknown>)["__change"]).toBe("size=12");
  });

  it("keeps settings out of the plugin's own storage keys", () => {
    const host = createHost();
    host.sync([plugin("mixed", true, "plugin.storage.set('real', 1);")]);
    host.get("mixed")?.writeSetting("hidden", true);

    const keys = host.get("mixed")?.context.storage.keys() ?? [];
    expect(keys).toEqual(["real"]);
  });
});

describe("plugin dom utilities", () => {
  it("resolves waitFor immediately for an element that already exists", async () => {
    document.body.innerHTML = `<div class="target">here</div>`;
    const host = createHost();
    host.sync([plugin("dom", true, "globalThis.__found = plugin.dom.waitFor('.target');")]);

    await expect((globalThis as Record<string, Promise<Element>>)["__found"]).resolves.toHaveProperty("textContent", "here");
  });

  it("resolves waitFor once a matching element appears", async () => {
    const host = createHost();
    host.sync([plugin("dom", true, "globalThis.__later = plugin.dom.waitFor('.late');")]);

    const element = document.createElement("div");
    element.className = "late";
    document.body.appendChild(element);

    await expect((globalThis as Record<string, Promise<Element>>)["__later"]).resolves.toBe(element);
  });

  it("rejects waitFor after the timeout", async () => {
    const host = createHost();
    host.sync([plugin("dom", true, "globalThis.__never = plugin.dom.waitFor('.absent', { timeout: 20 });")]);

    await expect((globalThis as Record<string, Promise<Element>>)["__never"]).rejects.toThrow(/Timed out/);
  });

  it("delivers current and future matches to observe exactly once", async () => {
    document.body.innerHTML = `<b class="item"></b>`;
    const host = createHost();
    host.sync([plugin("dom", true, "globalThis.__hits = []; plugin.dom.observe('.item', function(el){ globalThis.__hits.push(el); });")]);

    const added = document.createElement("b");
    added.className = "item";
    document.body.appendChild(added);
    await nextFrame();

    const hits = (globalThis as Record<string, Element[]>)["__hits"] ?? [];
    expect(hits).toHaveLength(2);
    expect(hits[1]).toBe(added);
  });

  it("stops observing when the plugin is disabled", async () => {
    const host = createHost();
    host.sync([plugin("dom", true, "globalThis.__count = 0; plugin.dom.observe('.watched', function(){ globalThis.__count += 1; });")]);

    host.sync([plugin("dom", false)]);
    const element = document.createElement("i");
    element.className = "watched";
    document.body.appendChild(element);
    await nextFrame();

    expect((globalThis as Record<string, number>)["__count"]).toBe(0);
  });
});

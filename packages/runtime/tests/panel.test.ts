// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPanel, type Panel } from "../src/world/panel/index.js";
import type { BetterGravityApi, PluginSummary } from "../src/world/api.js";
import type { RuntimeState, SettingsPatch } from "../src/protocol.js";

const settings = (overrides: Partial<RuntimeState["settings"]> = {}): RuntimeState["settings"] => ({
  schemaVersion: 1,
  themes: { enabled: [] },
  plugins: { developerMode: false, enabled: [] },
  reapplyAfterHostUpdate: true,
  ...overrides
});

const developerMode = (enabled: readonly string[] = ["timer"]) => settings({ plugins: { developerMode: true, enabled } });

const baseState = (overrides: Partial<RuntimeState> = {}): RuntimeState => ({
  version: "0.1.3",
  hostVersion: "2.11.0",
  directories: { root: "C:/bg", themes: "C:/bg/themes", plugins: "C:/bg/plugins" },
  settings: settings(),
  themes: [],
  plugins: [],
  diagnostics: [],
  ...overrides
});

const theme = (id: string, enabled = false) => ({
  id,
  name: id.replace(".css", ""),
  description: "A theme.",
  author: "someone",
  version: "1.0.0",
  css: "body {}",
  enabled
});

let state: RuntimeState;
let panel: Panel;
let patches: SettingsPatch[];
let opened: string[];
let summaries: PluginSummary[];
let settingValues: Record<string, unknown>;

function createApi(): BetterGravityApi {
  const api: BetterGravityApi = {
    version: "0.1.3",
    hostVersion: "2.11.0",
    state: () => state,
    getState: () => Promise.resolve(state),
    setSettings: (patch) => {
      patches.push(patch);
      return Promise.resolve(state);
    },
    openDirectory: (key) => {
      opened.push(key);
      return Promise.resolve("");
    },
    onStateChanged: () => () => undefined,
    plugins: {
      list: () => summaries,
      isRunning: (id) => summaries.some((entry) => entry.id === id && entry.running),
      getSetting: (_pluginId, key) => settingValues[key],
      setSetting: (_pluginId, key, value) => {
        settingValues[key] = value;
      }
    },
    panel: {
      open: () => panel.open(),
      close: () => panel.close(),
      toggle: () => panel.toggle()
    }
  };
  return api;
}

const shadow = () => document.getElementById("bettergravity-panel")?.shadowRoot ?? undefined;
const query = <T extends Element>(selector: string) => shadow()?.querySelector<T>(selector) ?? undefined;
const queryAll = (selector: string) => [...(shadow()?.querySelectorAll(selector) ?? [])];
const labelled = (label: string) => query<HTMLButtonElement>(`[aria-label="${label}"]`);
const clickTab = (prefix: string) =>
  queryAll("nav button").find((button) => button.textContent?.startsWith(prefix))?.dispatchEvent(new MouseEvent("click"));

beforeEach(() => {
  state = baseState();
  patches = [];
  opened = [];
  summaries = [];
  settingValues = {};
  panel = createPanel(createApi());
});

afterEach(() => {
  panel.destroy();
  document.documentElement.querySelectorAll("#bettergravity-panel").forEach((node) => node.remove());
});

describe("mounting", () => {
  it("attaches a closed, empty shadow host", () => {
    expect(shadow()).toBeDefined();
    expect(panel.isOpen()).toBe(false);
    expect(query(".panel")).toBeUndefined();
  });

  // Antigravity's single-page app re-renders the body constantly, so the panel
  // is anchored to the document element instead.
  it("survives the body being replaced", () => {
    panel.open();
    document.body.innerHTML = "<div>rebuilt</div>";
    expect(query(".panel")).toBeDefined();
  });

  it("removes itself on destroy", () => {
    panel.destroy();
    expect(shadow()).toBeUndefined();
  });
});

describe("visibility", () => {
  it("opens and closes with the keyboard shortcut", () => {
    const press = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "G", ctrlKey: true, shiftKey: true }));
    press();
    expect(panel.isOpen()).toBe(true);
    press();
    expect(panel.isOpen()).toBe(false);
  });

  it("ignores the shortcut without both modifiers", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true }));
    expect(panel.isOpen()).toBe(false);
  });

  it("closes on Escape", () => {
    panel.open();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel.isOpen()).toBe(false);
  });

  it("closes when the backdrop is clicked but not the panel itself", () => {
    panel.open();
    query(".panel")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.isOpen()).toBe(true);

    query(".scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.isOpen()).toBe(false);
  });
});

describe("themes tab", () => {
  it("explains what to do when there are no themes", () => {
    panel.open();
    expect(query(".empty")?.textContent).toContain("No themes yet");
  });

  it("shows each theme with its metadata", () => {
    state = baseState({ themes: [theme("midnight.css", true)] });
    panel.open();

    expect(query(".row-name")?.textContent).toBe("midnight");
    expect(query(".row-meta")?.textContent).toContain("someone");
    expect(labelled("Enable midnight")?.getAttribute("aria-checked")).toBe("true");
  });

  // Regression: aria-checked="false" was dropped, leaving the control with no
  // accessible state even though it looked correct.
  it("always writes the switch state, including false", () => {
    state = baseState({ themes: [theme("dawn.css", false)] });
    panel.open();
    expect(labelled("Enable dawn")?.getAttribute("aria-checked")).toBe("false");
  });

  it("adds a theme to the enabled list when switched on", () => {
    state = baseState({ themes: [theme("dawn.css", false)] });
    panel.open();
    labelled("Enable dawn")?.click();
    expect(patches).toEqual([{ themes: { enabled: ["dawn.css"] } }]);
  });

  it("removes a theme from the enabled list when switched off", () => {
    state = baseState({
      themes: [theme("dawn.css", true)],
      settings: settings({ themes: { enabled: ["dawn.css"] } })
    });
    panel.open();
    labelled("Enable dawn")?.click();
    expect(patches).toEqual([{ themes: { enabled: [] } }]);
  });
});

describe("plugins tab", () => {
  const summary = (overrides: Partial<PluginSummary> = {}): PluginSummary => ({
    id: "timer",
    name: "Session Timer",
    description: "Counts.",
    version: "1.0.0",
    author: "someone",
    enabled: true,
    running: true,
    schema: {},
    ...overrides
  });

  it("hides plugins behind developer mode and explains why", () => {
    state = baseState({ plugins: [{ ...summary(), source: "" }] });
    panel.open();
    clickTab("Plugins");

    expect(shadow()?.textContent).toContain("Developer mode");
    expect(shadow()?.textContent).toContain("credentials");
    expect(labelled("Enable Session Timer")).toBeUndefined();
  });

  it("lists plugins once developer mode is on", () => {
    state = baseState({
      settings: developerMode()
    });
    summaries = [summary()];
    panel.open();
    clickTab("Plugins");

    expect(labelled("Enable Session Timer")?.getAttribute("aria-checked")).toBe("true");
  });

  it("turns developer mode on through the settings patch", () => {
    panel.open();
    clickTab("Plugins");
    labelled("Enable developer mode")?.click();
    expect(patches).toEqual([{ plugins: { developerMode: true } }]);
  });

  it("renders declared settings only for a running plugin", () => {
    state = baseState({
      settings: developerMode()
    });
    summaries = [
      summary({
        running: false,
        schema: { compact: { type: "boolean", label: "Compact", default: false } }
      })
    ];
    panel.open();
    clickTab("Plugins");
    expect(query(".settings")).toBeUndefined();

    summaries = [summary({ schema: { compact: { type: "boolean", label: "Compact", default: false } } })];
    panel.close();
    panel.open();
    clickTab("Plugins");
    expect(query(".settings")).toBeDefined();
  });

  it("writes a select change straight through to the plugin", () => {
    state = baseState({
      settings: developerMode()
    });
    settingValues["corner"] = "bottom-right";
    summaries = [
      summary({
        schema: {
          corner: {
            type: "select",
            label: "Corner",
            default: "bottom-right",
            options: [
              { value: "bottom-right", label: "Bottom right" },
              { value: "top-right", label: "Top right" }
            ]
          }
        }
      })
    ];
    panel.open();
    clickTab("Plugins");

    const select = query<HTMLSelectElement>("select");
    expect(select?.value).toBe("bottom-right");
    select!.value = "top-right";
    select!.dispatchEvent(new Event("change"));

    expect(settingValues["corner"]).toBe("top-right");
  });

  it("coerces a number field to a number", () => {
    state = baseState({
      settings: developerMode()
    });
    summaries = [summary({ schema: { size: { type: "number", label: "Size", default: 12, min: 8 } } })];
    panel.open();
    clickTab("Plugins");

    const input = query<HTMLInputElement>('input[type="number"]');
    expect(input?.getAttribute("min")).toBe("8");
    input!.value = "20";
    input!.dispatchEvent(new Event("change"));

    expect(settingValues["size"]).toBe(20);
  });
});

describe("general tab", () => {
  it("offers the reapply-after-update switch, on by default", () => {
    panel.open();
    clickTab("General");
    expect(labelled("Reapply after Antigravity updates")?.getAttribute("aria-checked")).toBe("true");
  });

  it("turns reapplying off through the settings patch", () => {
    panel.open();
    clickTab("General");
    labelled("Reapply after Antigravity updates")?.click();
    expect(patches).toEqual([{ reapplyAfterHostUpdate: false }]);
  });

  it("shows where content is stored", () => {
    panel.open();
    clickTab("General");
    expect(shadow()?.textContent).toContain("C:/bg");
  });
});

describe("problems tab", () => {
  it("stays hidden when nothing failed", () => {
    panel.open();
    expect(queryAll("nav button").map((button) => button.textContent)).toEqual(["Themes (0)", "Plugins (0)", "General"]);
  });

  it("surfaces load failures", () => {
    state = baseState({ diagnostics: [{ source: "plugin broken", message: "Unexpected token" }] });
    panel.open();
    clickTab("Problems");
    expect(query(".diagnostic")?.textContent).toBe("plugin broken: Unexpected token");
  });
});

describe("footer", () => {
  it("opens the content folders", () => {
    panel.open();
    const buttons = queryAll("footer button") as HTMLButtonElement[];
    buttons[0]?.click();
    buttons[1]?.click();
    expect(opened).toEqual(["themes", "plugins"]);
  });
});

describe("isolation", () => {
  it("keeps its styles inside the shadow root", () => {
    panel.open();
    expect(shadow()?.querySelector("style")).toBeDefined();
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("does not throw when state is unavailable", () => {
    const spy = vi.spyOn({ state: () => undefined }, "state");
    state = undefined as unknown as RuntimeState;
    expect(() => panel.open()).not.toThrow();
    spy.mockRestore();
  });
});

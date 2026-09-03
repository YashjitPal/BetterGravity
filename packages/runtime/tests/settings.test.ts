// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isNewer } from "../src/world/settings/catalog-store.js";
import { installNativeSettings, type NativeSettings } from "../src/world/settings/host.js";
import { registerSection, requestSectionRefresh, resetSections } from "../src/world/ui/sections-registry.js";
import {
  catalogEntry,
  createFakeApi,
  mountHostSettings,
  pluginSummary,
  runtimeState,
  theme,
  unmountHostSettings,
  type FakeApi
} from "./settings-fixture.js";

let fake: FakeApi;
let settings: NativeSettings;
let reported: string[];

/** MutationObserver callbacks are queued rather than run inline. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const navFor = (id: string) => document.querySelector<HTMLButtonElement>(`[data-bettergravity-nav="${id}"]`);
const screenFor = (id: string) => document.querySelector<HTMLElement>(`[data-bettergravity-screen="${id}"]`);
const hostNav = (name: string) => document.querySelector<HTMLButtonElement>(`[data-testid="settings-nav-item-${name}"]`);
const hostScreen = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("div.grow.w-full > div")].find((div) => div.querySelector("h2")?.textContent === name);

/** Opening Themes or Plugins starts a catalog fetch, so this waits for it. */
const open = async (id: string): Promise<void> => {
  navFor(id)?.click();
  await settle();
};

const textIn = (id: string) => screenFor(id)?.textContent ?? "";
const labelledIn = (id: string, label: string) => screenFor(id)?.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? null;
const buttonIn = (id: string, label: string) =>
  [...(screenFor(id)?.querySelectorAll("button") ?? [])].find((button) => button.textContent === label);

beforeEach(() => {
  document.body.innerHTML = "";
  fake = createFakeApi();
  reported = [];
});

afterEach(() => {
  settings.destroy();
  unmountHostSettings();
  resetSections();
});

function install(): void {
  settings = installNativeSettings(fake.api, (message) => reported.push(message));
}

describe("injection", () => {
  it("does nothing while the dialog is closed", () => {
    install();
    expect(navFor("Settings")).toBeNull();
    expect(screenFor("Settings")).toBeNull();
  });

  it("adds its group once the dialog appears", async () => {
    install();
    mountHostSettings();
    await settle();

    expect(navFor("Settings")).not.toBeNull();
    expect(screenFor("Settings")).not.toBeNull();
  });

  // Antigravity groups its sidebar under small headings, so BetterGravity's
  // entries belong under one of their own rather than loose among the app's.
  it("heads its entries with a BetterGravity heading", async () => {
    install();
    mountHostSettings();
    await settle();

    const group = document.querySelector("[data-bettergravity-nav-group]");
    expect(group?.querySelector("h2")?.textContent).toBe("BetterGravity");
  });

  it("offers Settings, Plugins, and Themes in that order", async () => {
    install();
    mountHostSettings();
    await settle();

    const list = document.querySelector("[data-bettergravity-nav-list]");
    const labels = [...(list?.children ?? [])].map((node) => node.textContent);
    expect(labels).toEqual(["Settings", "Plugins", "Themes"]);
  });

  it("names its entries the way Antigravity names its own", async () => {
    install();
    mountHostSettings();
    await settle();

    expect(navFor("Themes")?.getAttribute("data-testid")).toBe("settings-nav-item-Themes");
  });

  // The group sits directly after the app's own settings entries, so it reads
  // as another settings section rather than as something after the projects.
  it("puts its group after Antigravity's own entries", async () => {
    install();
    mountHostSettings();
    await settle();

    const hostList = hostNav("General")?.parentElement;
    expect(hostList?.nextElementSibling?.hasAttribute("data-bettergravity-nav-group")).toBe(true);
  });

  // The account entry lives in its own footer list; joining that one would put
  // BetterGravity underneath the signed-in user.
  it("measures the main nav list rather than the account footer", async () => {
    install();
    mountHostSettings();
    await settle();

    const siblings = [...(hostNav("General")?.parentElement?.children ?? [])].map((node) => node.getAttribute("data-testid"));
    expect(siblings).toContain("settings-nav-item-General");
    expect(siblings).not.toContain("settings-nav-item-Account");
  });

  it("adds itself again after the dialog is closed and reopened", async () => {
    install();
    mountHostSettings();
    await settle();

    unmountHostSettings();
    await settle();
    expect(navFor("Settings")).toBeNull();

    mountHostSettings();
    await settle();
    expect(navFor("Settings")).not.toBeNull();
  });

  it("never adds itself twice", async () => {
    install();
    mountHostSettings();
    await settle();
    document.body.append(document.createElement("span"));
    await settle();

    expect(document.querySelectorAll("[data-bettergravity-nav-group]")).toHaveLength(1);
    expect(document.querySelectorAll('[data-bettergravity-nav="Settings"]')).toHaveLength(1);
    expect(document.querySelectorAll("#bettergravity-settings")).toHaveLength(1);
  });

  // Regression: an `h-full` here gave the inner pane a definite height, so it
  // scrolled itself instead of letting the dialog's outer container scroll. The
  // scrollbar then sat inset by the width of that container's reserved gutter,
  // visibly out of line with every other settings tab.
  it("leaves the screen wrapper free to size to its content", async () => {
    install();
    mountHostSettings();
    await settle();

    const wrapper = screenFor("Settings");
    expect(wrapper?.className).not.toMatch(/(^|\s)h-full(\s|$)/);
    expect(wrapper?.className).not.toMatch(/(^|\s)(max-)?h-\[/);
    expect(wrapper?.style.height).toBe("");
  });

  it("takes everything with it on destroy", async () => {
    install();
    mountHostSettings();
    await settle();

    settings.destroy();

    expect(navFor("Settings")).toBeNull();
    expect(screenFor("Themes")).toBeNull();
    expect(document.querySelector("[data-bettergravity-nav-group]")).toBeNull();
  });
});

describe("switching screens", () => {
  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  it("shows the screen and hides Antigravity's when selected", async () => {
    await open("Settings");

    expect(screenFor("Settings")?.style.display).toBe("block");
    expect(hostScreen("General")?.style.display).toBe("none");
    expect(navFor("Settings")?.className).toContain("bg-sidebar-secondary");
  });

  it("moves between its own screens", async () => {
    await open("Settings");
    await open("Themes");

    expect(screenFor("Settings")?.style.display).toBe("none");
    expect(screenFor("Themes")?.style.display).toBe("block");
    expect(navFor("Themes")?.className).toContain("bg-sidebar-secondary");
    expect(navFor("Settings")?.className).not.toContain("bg-sidebar-secondary");
  });

  // Regression: hiding Antigravity's screens with inline styles left the one it
  // already considered selected hidden, so returning to it showed a blank pane.
  it("gives back the screen it hid when the user returns to it", async () => {
    await open("Settings");
    expect(hostScreen("General")?.style.display).toBe("none");

    hostNav("General")?.click();

    expect(hostScreen("General")?.style.display).toBe("block");
    expect(screenFor("Settings")?.style.display).toBe("none");
    expect(navFor("Settings")?.className).not.toContain("bg-sidebar-secondary");
  });

  it("steps aside for any of Antigravity's entries", async () => {
    await open("Plugins");
    hostNav("Appearance")?.click();
    expect(screenFor("Plugins")?.style.display).toBe("none");
  });

  it("can be selected again after leaving", async () => {
    await open("Settings");
    hostNav("General")?.click();
    await open("Settings");

    expect(screenFor("Settings")?.style.display).toBe("block");
    expect(hostScreen("General")?.style.display).toBe("none");
  });

  it("stays put when a re-render tries to show a screen underneath it", async () => {
    await open("Settings");

    // Stands in for React restoring its own selection during a re-render.
    const general = hostScreen("General");
    if (general) general.style.display = "block";
    await settle();

    expect(general?.style.display).toBe("none");
    expect(screenFor("Settings")?.style.display).toBe("block");
  });

  it("close leaves Antigravity's own screen showing", async () => {
    await open("Settings");
    settings.close();

    expect(screenFor("Settings")?.style.display).toBe("none");
    expect(hostScreen("General")?.style.display).toBe("block");
  });

  it("open goes to the Settings screen", () => {
    settings.open();

    expect(screenFor("Settings")?.style.display).toBe("block");
    expect(settings.isOpen()).toBe(true);
  });
});

describe("the Settings screen", () => {
  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  it("shows which versions are running", async () => {
    await open("Settings");
    expect(textIn("Settings")).toContain("Version 0.1.3 on Antigravity 2.11.0");
  });

  it("summarises what is installed", async () => {
    fake.state = runtimeState({ themes: [theme("midnight.css", true), theme("dawn.css", false)] });
    await open("Settings");

    expect(textIn("Settings")).toContain("2 installed, 1 on.");
  });

  it("toggles reapplying after a host update", async () => {
    await open("Settings");
    labelledIn("Settings", "Reapply after Antigravity updates")?.click();

    expect(fake.patches).toEqual([{ reapplyAfterHostUpdate: false }]);
  });

  it("opens the content folder", async () => {
    await open("Settings");
    buttonIn("Settings", "Open")?.click();

    expect(fake.opened).toEqual(["root"]);
  });

  it("surfaces anything that failed to load", async () => {
    fake.state = runtimeState({ diagnostics: [{ source: "broken.css", message: "Could not read it." }] });
    await open("Settings");

    expect(textIn("Settings")).toContain("Problems");
    expect(textIn("Settings")).toContain("Could not read it.");
  });
});

describe("the Themes screen", () => {
  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  it("invites the user to add one when there are none", async () => {
    await open("Themes");
    expect(textIn("Themes")).toContain("No themes yet");

    buttonIn("Themes", "Add a theme")?.click();
    expect(fake.calls).toContain("addThemes");
  });

  it("offers Add and Open folder beside the heading", async () => {
    await open("Themes");
    expect(buttonIn("Themes", "Add theme")).toBeDefined();
    expect(buttonIn("Themes", "Open folder")).toBeDefined();
  });

  it("lists each theme with a switch, a reveal, and a delete", async () => {
    fake.state = runtimeState({ themes: [theme("midnight.css", true)] });
    await open("Themes");

    expect(labelledIn("Themes", "Enable midnight")?.getAttribute("aria-checked")).toBe("true");
    labelledIn("Themes", "Show midnight.css in Explorer")?.click();
    labelledIn("Themes", "Delete midnight")?.click();

    expect(fake.calls).toContain("reveal:theme:midnight.css");
    expect(fake.calls).toContain("remove:theme:midnight.css");
  });

  it("turns one on through the settings patch", async () => {
    fake.state = runtimeState({ themes: [theme("dawn.css", false)] });
    await open("Themes");
    labelledIn("Themes", "Enable dawn")?.click();

    expect(fake.patches).toEqual([{ themes: { enabled: ["dawn.css"] } }]);
  });

  it("reports what happened, since the change lands out of view", async () => {
    fake.nextResult = { ok: true, message: "Added 1 theme." };
    await open("Themes");
    buttonIn("Themes", "Add theme")?.click();
    await settle();

    expect(textIn("Themes")).toContain("Added 1 theme.");
  });

  it("says nothing when the user cancels the dialog", async () => {
    fake.nextResult = { ok: false };
    await open("Themes");
    buttonIn("Themes", "Add theme")?.click();
    await settle();

    expect(textIn("Themes")).not.toContain("undefined");
  });

  it("filters the installed list as the user searches", async () => {
    fake.state = runtimeState({ themes: [theme("midnight.css"), theme("dawn.css")] });
    await open("Themes");

    const search = screenFor("Themes")?.querySelector<HTMLInputElement>('input[type="search"]');
    if (search) search.value = "dawn";
    search?.dispatchEvent(new Event("input"));

    expect(textIn("Themes")).toContain("dawn");
    expect(textIn("Themes")).not.toContain("midnight");
  });
});

describe("the Plugins screen", () => {
  const withDeveloperMode = (summaries: readonly ReturnType<typeof pluginSummary>[]) => {
    fake.state = runtimeState({
      settings: {
        schemaVersion: 1,
        themes: { enabled: [] },
        plugins: { developerMode: true, enabled: ["timer"] },
        reapplyAfterHostUpdate: true
      }
    });
    fake.summaries = [...summaries];
  };

  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  it("stays behind developer mode and says why", async () => {
    await open("Plugins");
    expect(textIn("Plugins")).toContain("credentials");
    expect(labelledIn("Plugins", "Enable Session Timer")).toBeNull();
  });

  it("offers no gear for a plugin that declares nothing", async () => {
    withDeveloperMode([pluginSummary()]);
    await open("Plugins");
    expect(labelledIn("Plugins", "Show Session Timer options")).toBeNull();
  });

  // A plugin's options only exist once it has run and registered them.
  it("offers no gear for a plugin that is not running", async () => {
    withDeveloperMode([pluginSummary({ running: false, schema: { compact: { type: "boolean", label: "Compact", default: false } } })]);
    await open("Plugins");
    expect(labelledIn("Plugins", "Show Session Timer options")).toBeNull();
  });

  it("reveals the options under the plugin when the gear is pressed", async () => {
    withDeveloperMode([
      pluginSummary({
        schema: {
          compact: { type: "boolean", label: "Compact", default: false },
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
    ]);
    await open("Plugins");
    expect(screenFor("Plugins")?.querySelectorAll(".pl-6")).toHaveLength(0);

    labelledIn("Plugins", "Show Session Timer options")?.click();

    expect(screenFor("Plugins")?.querySelectorAll(".pl-6")).toHaveLength(2);
    expect(labelledIn("Plugins", "Hide Session Timer options")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("hides them again when the gear is pressed a second time", async () => {
    withDeveloperMode([pluginSummary({ schema: { compact: { type: "boolean", label: "Compact", default: false } } })]);
    await open("Plugins");
    labelledIn("Plugins", "Show Session Timer options")?.click();
    labelledIn("Plugins", "Hide Session Timer options")?.click();

    expect(screenFor("Plugins")?.querySelectorAll(".pl-6")).toHaveLength(0);
  });

  it("writes a changed option straight through to the plugin", async () => {
    withDeveloperMode([
      pluginSummary({
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
    ]);
    await open("Plugins");
    labelledIn("Plugins", "Show Session Timer options")?.click();

    const select = screenFor("Plugins")?.querySelector("select");
    select!.value = "top-right";
    select!.dispatchEvent(new Event("change"));

    expect(fake.settingValues["corner"]).toBe("top-right");
  });

  it("keeps a plugin expanded across a re-render", async () => {
    withDeveloperMode([pluginSummary({ schema: { compact: { type: "boolean", label: "Compact", default: false } } })]);
    await open("Plugins");
    labelledIn("Plugins", "Show Session Timer options")?.click();

    settings.refresh();

    expect(labelledIn("Plugins", "Hide Session Timer options")).not.toBeNull();
  });

  it("reveals and deletes a plugin by folder", async () => {
    withDeveloperMode([pluginSummary()]);
    await open("Plugins");

    labelledIn("Plugins", "Show timer in Explorer")?.click();
    labelledIn("Plugins", "Delete Session Timer")?.click();

    expect(fake.calls).toContain("reveal:plugin:timer");
    expect(fake.calls).toContain("remove:plugin:timer");
  });

  it("turns developer mode on through the settings patch", async () => {
    await open("Plugins");
    labelledIn("Plugins", "Enable developer mode")?.click();

    expect(fake.patches).toEqual([{ plugins: { developerMode: true } }]);
  });
});

describe("version comparison", () => {
  it.each([
    ["1.0.1", "1.0.0", true],
    ["1.1.0", "1.0.9", true],
    ["2.0.0", "1.9.9", true],
    ["1.10.0", "1.9.0", true],
    ["1.0.0", "1.0.0", false],
    ["1.0.0", "1.0.1", false],
    ["1.0", "1.0.0", false],
    ["1.0.0", "1.0", false]
  ])("%s over %s is %s", (candidate, installed, expected) => {
    expect(isNewer(candidate, installed)).toBe(expected);
  });

  // Anything that is not a dotted number is offered rather than withheld, since
  // withholding an update silently is the worse failure.
  it("offers an update when a version cannot be compared", () => {
    expect(isNewer("2024-05-01", "1.0.0")).toBe(true);
    expect(isNewer("beta", "alpha")).toBe(true);
  });
});

/**
 * The catalogue is not a screen of its own: what you could install sits under
 * what you have, on the same screen, so the two read as one list.
 */
describe("the catalogue", () => {
  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  it("asks for nothing until a screen that needs it is opened", async () => {
    await open("Settings");
    expect(fake.calls).toEqual([]);

    await open("Themes");
    expect(fake.calls).toEqual(["catalog"]);
  });

  it("fetches once for both screens rather than once each", async () => {
    await open("Themes");
    await open("Plugins");

    expect(fake.calls.filter((call) => call.startsWith("catalog"))).toEqual(["catalog"]);
  });

  it("lists what you could install under what you have", async () => {
    fake.catalogResult = { ok: true, entries: [catalogEntry({ name: "Midnight" })] };
    await open("Themes");

    expect(textIn("Themes")).toContain("Available");
    expect(textIn("Themes")).toContain("Midnight");
    expect(buttonIn("Themes", "Install")).toBeDefined();
  });

  it("keeps a theme listing off the Plugins screen", async () => {
    fake.catalogResult = { ok: true, entries: [catalogEntry({ name: "Midnight" })] };
    await open("Plugins");

    expect(textIn("Plugins")).not.toContain("Midnight");
  });

  it("installs a listing when asked", async () => {
    fake.catalogResult = { ok: true, entries: [catalogEntry()] };
    await open("Themes");

    buttonIn("Themes", "Install")?.click();
    await settle();

    expect(fake.installed.map((entry) => entry.id)).toEqual(["midnight.css"]);
  });

  it("reports the outcome, since the file lands out of view", async () => {
    fake.catalogResult = { ok: true, entries: [catalogEntry()] };
    fake.nextResult = { ok: true, message: "Added Midnight." };
    await open("Themes");

    buttonIn("Themes", "Install")?.click();
    await settle();

    expect(textIn("Themes")).toContain("Added Midnight.");
  });

  it("will not start a second install while one is running", async () => {
    fake.catalogResult = { ok: true, entries: [catalogEntry()] };
    await open("Themes");

    buttonIn("Themes", "Install")?.click();
    buttonIn("Themes", "Install")?.click();
    await settle();

    expect(fake.installed).toHaveLength(1);
  });

  // Something you already have belongs in Installed, not offered again below.
  it("leaves out what is already installed", async () => {
    fake.state = runtimeState({ themes: [theme("midnight.css")] });
    fake.catalogResult = { ok: true, entries: [catalogEntry({ id: "midnight.css" })] };
    await open("Themes");

    expect(textIn("Themes")).toContain("Nothing else to install yet.");
  });

  // Where you manage a thing is where you should be told a newer one exists.
  it("offers an update on the row of the thing it updates", async () => {
    fake.state = runtimeState({ themes: [theme("midnight.css", false, { version: "1.0.0" })] });
    fake.catalogResult = { ok: true, entries: [catalogEntry({ id: "midnight.css", version: "1.2.0" })] };
    await open("Themes");

    expect(buttonIn("Themes", "Update to 1.2.0")).toBeDefined();
  });

  it("offers no update when what you have is current", async () => {
    fake.state = runtimeState({ themes: [theme("midnight.css", false, { version: "1.0.0" })] });
    fake.catalogResult = { ok: true, entries: [catalogEntry({ id: "midnight.css", version: "1.0.0" })] };
    await open("Themes");

    expect(buttonIn("Themes", "Update to 1.0.0")).toBeUndefined();
  });

  it("offers a way back when the catalogue cannot be read", async () => {
    fake.catalogResult = { ok: false, message: "Could not reach the catalog." };
    await open("Themes");

    expect(textIn("Themes")).toContain("Could not reach the catalog.");
    expect(buttonIn("Themes", "Try again")).toBeDefined();
  });

  it("retries on request", async () => {
    fake.catalogResult = { ok: false, message: "Could not reach the catalog." };
    await open("Themes");

    buttonIn("Themes", "Try again")?.click();
    await settle();

    expect(fake.calls).toEqual(["catalog", "catalog:refresh"]);
  });

  it("refreshes past the cache when asked", async () => {
    await open("Themes");
    buttonIn("Themes", "Refresh")?.click();
    await settle();

    expect(fake.calls).toEqual(["catalog", "catalog:refresh"]);
  });

  // Empty groups would read as "there is nothing here" rather than "this has
  // not arrived yet".
  it("says it is loading rather than showing an empty list", async () => {
    fake.deferCatalog = true;
    await open("Themes");

    expect(textIn("Themes")).toContain("Loading listings…");

    fake.deferCatalog = false;
    fake.releaseCatalog();
    await settle();

    expect(textIn("Themes")).not.toContain("Loading listings…");
  });

  it("still offers plugins to install while developer mode is off", async () => {
    fake.catalogResult = { ok: true, entries: [catalogEntry({ kind: "plugin", name: "Word Count" })] };
    await open("Plugins");

    expect(textIn("Plugins")).toContain("Word Count");
    expect(textIn("Plugins")).toContain("Nothing will run until developer mode is on");
  });

  it("drops the warning once developer mode is on", async () => {
    fake.state = runtimeState({
      settings: {
        schemaVersion: 1,
        themes: { enabled: [] },
        plugins: { developerMode: true, enabled: [] },
        reapplyAfterHostUpdate: true
      }
    });
    fake.catalogResult = { ok: true, entries: [catalogEntry({ kind: "plugin", name: "Word Count" })] };
    await open("Plugins");

    expect(textIn("Plugins")).not.toContain("Nothing will run until developer mode is on");
  });

  it("filters listings as the user searches", async () => {
    fake.catalogResult = {
      ok: true,
      entries: [catalogEntry({ id: "midnight.css", name: "Midnight" }), catalogEntry({ id: "dawn.css", name: "Dawn" })]
    };
    await open("Themes");

    const search = screenFor("Themes")?.querySelector<HTMLInputElement>('input[type="search"]');
    if (search) search.value = "dawn";
    search?.dispatchEvent(new Event("input"));

    expect(textIn("Themes")).toContain("Dawn");
    expect(textIn("Themes")).not.toContain("Midnight");
  });
});

/**
 * A plugin can claim a sidebar entry of its own. The host owns the dialog, so
 * these check that a plugin's screen takes part in the same show-and-restore
 * dance as BetterGravity's own.
 */
describe("plugin sections", () => {
  const pluginNav = () => navFor("demo:Advanced");
  const pluginScreen = () => screenFor("demo:Advanced");

  const addSection = (render: (container: HTMLElement) => void = (container) => (container.textContent = "Plugin content")) =>
    registerSection({ id: "demo:Advanced", pluginId: "demo", label: "Advanced", render });

  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  it("adds a sidebar entry under the same heading", () => {
    addSection();

    expect(pluginNav()?.textContent).toBe("Advanced");
    expect(pluginNav()?.parentElement).toBe(navFor("Settings")?.parentElement);
  });

  it("comes after BetterGravity's own entries", () => {
    addSection();

    const list = document.querySelector("[data-bettergravity-nav-list]");
    expect([...(list?.children ?? [])].map((node) => node.textContent)).toEqual(["Settings", "Plugins", "Themes", "Advanced"]);
  });

  it("names the entry the way Antigravity names its own", () => {
    addSection();

    expect(pluginNav()?.getAttribute("data-testid")).toBe("settings-nav-item-Advanced");
  });

  it("appears without the user reopening the dialog", async () => {
    expect(pluginNav()).toBeNull();

    addSection();
    await settle();

    expect(pluginNav()).not.toBeNull();
  });

  it("renders the plugin's content when selected", async () => {
    addSection();
    await open("demo:Advanced");

    expect(pluginScreen()?.style.display).toBe("block");
    expect(pluginScreen()?.textContent).toBe("Plugin content");
  });

  it("hides Antigravity's screens while it is showing", async () => {
    addSection();
    await open("demo:Advanced");

    expect(hostScreen("General")?.style.display).toBe("none");
  });

  it("hides BetterGravity's screens when the user switches to it", async () => {
    addSection();
    await open("Settings");
    await open("demo:Advanced");

    expect(screenFor("Settings")?.style.display).toBe("none");
    expect(pluginScreen()?.style.display).toBe("block");
  });

  it("hands back to BetterGravity when the user switches away", async () => {
    addSection();
    await open("demo:Advanced");
    await open("Settings");

    expect(pluginScreen()?.style.display).toBe("none");
    expect(screenFor("Settings")?.style.display).toBe("block");
  });

  it("gives Antigravity its screens back when the user leaves", async () => {
    addSection();
    await open("demo:Advanced");
    hostNav("General")?.click();

    expect(pluginScreen()?.style.display).toBe("none");
    expect(hostScreen("General")?.style.display).toBe("block");
  });

  it("stays put when a re-render tries to show a screen underneath it", async () => {
    addSection();
    await open("demo:Advanced");

    const general = hostScreen("General");
    if (general) general.style.display = "block";
    await settle();

    expect(general?.style.display).toBe("none");
    expect(pluginScreen()?.style.display).toBe("block");
  });

  it("re-renders on request while it is showing", async () => {
    let count = 0;
    addSection((container) => (container.textContent = `Rendered ${(count += 1)}`));
    await open("demo:Advanced");

    requestSectionRefresh("demo:Advanced");

    expect(pluginScreen()?.textContent).toBe("Rendered 2");
  });

  it("does no work refreshing a section the user cannot see", () => {
    let count = 0;
    addSection((container) => (container.textContent = `Rendered ${(count += 1)}`));

    requestSectionRefresh("demo:Advanced");

    expect(count).toBe(0);
  });

  it("takes its entry and screen away when the plugin is disabled", async () => {
    const remove = addSection();
    await settle();

    remove();
    await settle();

    expect(pluginNav()).toBeNull();
    expect(pluginScreen()).toBeNull();
  });

  it("gives Antigravity its screens back if it is disabled while showing", async () => {
    const remove = addSection();
    await open("demo:Advanced");
    expect(hostScreen("General")?.style.display).toBe("none");

    remove();
    await settle();

    expect(hostScreen("General")?.style.display).toBe("block");
  });

  it("reports a section whose render throws instead of breaking the dialog", async () => {
    addSection(() => {
      throw new Error("plugin bug");
    });
    await open("demo:Advanced");

    expect(reported.join()).toContain("demo:Advanced");
    expect(navFor("Settings")).not.toBeNull();
  });

  it("keeps two plugins' sections apart", async () => {
    addSection();
    registerSection({
      id: "other:Advanced",
      pluginId: "other",
      label: "Advanced",
      render: (container) => (container.textContent = "Other content")
    });

    // Settings, Plugins, and Themes, plus one for each plugin.
    expect(document.querySelectorAll("[data-bettergravity-nav]")).toHaveLength(5);
    await open("other:Advanced");

    expect(screenFor("other:Advanced")?.textContent).toBe("Other content");
    expect(pluginScreen()?.style.display).toBe("none");
  });

  it("takes plugin sections with it on destroy", () => {
    addSection();

    settings.destroy();

    expect(pluginNav()).toBeNull();
    expect(pluginScreen()).toBeNull();
  });
});

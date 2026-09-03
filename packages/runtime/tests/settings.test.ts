// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installNativeSettings, type NativeSettings } from "../src/world/settings/host.js";
import { registerSection, requestSectionRefresh, resetSections } from "../src/world/ui/sections-registry.js";
import {
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

const ours = () => document.getElementById("bettergravity-settings");
const ourNav = () => document.querySelector<HTMLButtonElement>('[data-testid="settings-nav-item-BetterGravity"]');
const hostNav = (name: string) => document.querySelector<HTMLButtonElement>(`[data-testid="settings-nav-item-${name}"]`);
const hostScreen = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("div.grow.w-full > div")].find((div) => div.querySelector("h2")?.textContent === name);

/** MutationObserver callbacks are queued rather than run inline. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const labelled = (label: string) => document.querySelector<HTMLElement>(`#bettergravity-settings [aria-label="${label}"]`);
const sectionText = () => ours()?.textContent ?? "";
const buttonLabelled = (label: string) =>
  [...(ours()?.querySelectorAll("button") ?? [])].find((button) => button.textContent === label);

beforeEach(() => {
  document.body.innerHTML = "";
  fake = createFakeApi();
  reported = [];
});

afterEach(() => {
  settings.destroy();
  unmountHostSettings();
});

function install(): void {
  settings = installNativeSettings(fake.api, (message) => reported.push(message));
}

describe("injection", () => {
  it("does nothing while the dialog is closed", () => {
    install();
    expect(ourNav()).toBeNull();
    expect(ours()).toBeNull();
  });

  it("adds itself once the dialog appears", async () => {
    install();
    mountHostSettings();
    await settle();

    expect(ourNav()).not.toBeNull();
    expect(ours()).not.toBeNull();
  });

  // The account entry lives in its own footer list; joining that one would put
  // BetterGravity underneath the signed-in user.
  it("joins the main nav list rather than the account footer", async () => {
    install();
    mountHostSettings();
    await settle();

    const siblings = [...(ourNav()?.parentElement?.children ?? [])].map((node) => node.getAttribute("data-testid"));
    expect(siblings).toContain("settings-nav-item-General");
    expect(siblings).not.toContain("settings-nav-item-Account");
  });

  it("adds itself again after the dialog is closed and reopened", async () => {
    install();
    mountHostSettings();
    await settle();

    unmountHostSettings();
    await settle();
    expect(ourNav()).toBeNull();

    mountHostSettings();
    await settle();
    expect(ourNav()).not.toBeNull();
  });

  it("never adds itself twice", async () => {
    install();
    mountHostSettings();
    await settle();
    document.body.append(document.createElement("span"));
    await settle();

    expect(document.querySelectorAll('[data-testid="settings-nav-item-BetterGravity"]')).toHaveLength(1);
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

    const wrapper = ours();
    expect(wrapper?.className).not.toMatch(/(^|\s)h-full(\s|$)/);
    expect(wrapper?.className).not.toMatch(/(^|\s)(max-)?h-\[/);
    expect(wrapper?.style.height).toBe("");
  });

  it("takes everything with it on destroy", async () => {
    install();
    mountHostSettings();
    await settle();

    settings.destroy();

    expect(ourNav()).toBeNull();
    expect(ours()).toBeNull();
  });
});

describe("switching screens", () => {
  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  it("shows the section and hides Antigravity's when selected", () => {
    ourNav()?.click();

    expect(ours()?.style.display).toBe("block");
    expect(hostScreen("General")?.style.display).toBe("none");
    expect(ourNav()?.className).toContain("bg-sidebar-secondary");
  });

  // Regression: hiding Antigravity's screens with inline styles left the one it
  // already considered selected hidden, so returning to it showed a blank pane.
  it("gives back the screen it hid when the user returns to it", () => {
    ourNav()?.click();
    expect(hostScreen("General")?.style.display).toBe("none");

    hostNav("General")?.click();

    expect(hostScreen("General")?.style.display).toBe("block");
    expect(ours()?.style.display).toBe("none");
    expect(ourNav()?.className).not.toContain("bg-sidebar-secondary");
  });

  it("steps aside for any of Antigravity's entries", () => {
    ourNav()?.click();
    hostNav("Appearance")?.click();
    expect(ours()?.style.display).toBe("none");
  });

  it("can be selected again after leaving", () => {
    ourNav()?.click();
    hostNav("General")?.click();
    ourNav()?.click();

    expect(ours()?.style.display).toBe("block");
    expect(hostScreen("General")?.style.display).toBe("none");
  });

  it("stays put when a re-render tries to show a screen underneath it", async () => {
    ourNav()?.click();

    // Stands in for React restoring its own selection during a re-render.
    const general = hostScreen("General");
    if (general) general.style.display = "block";
    await settle();

    expect(general?.style.display).toBe("none");
    expect(ours()?.style.display).toBe("block");
  });

  it("close leaves Antigravity's own screen showing", () => {
    ourNav()?.click();
    settings.close();

    expect(ours()?.style.display).toBe("none");
    expect(hostScreen("General")?.style.display).toBe("block");
  });
});

describe("themes", () => {
  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  it("invites the user to add one when there are none", () => {
    ourNav()?.click();
    expect(sectionText()).toContain("No themes yet");

    buttonLabelled("Add a theme")?.click();
    expect(fake.calls).toContain("addThemes");
  });

  it("offers Add and Open folder beside the heading", () => {
    ourNav()?.click();
    expect(buttonLabelled("Add theme")).toBeDefined();
    expect(buttonLabelled("Open folder")).toBeDefined();
  });

  it("lists each theme with a switch, a reveal, and a delete", () => {
    fake.state = runtimeState({ themes: [theme("midnight.css", true)] });
    ourNav()?.click();

    expect(labelled("Enable midnight")?.getAttribute("aria-checked")).toBe("true");
    labelled("Show midnight.css in Explorer")?.click();
    labelled("Delete midnight")?.click();

    expect(fake.calls).toEqual(["reveal:theme:midnight.css", "remove:theme:midnight.css"]);
  });

  it("turns one on through the settings patch", () => {
    fake.state = runtimeState({ themes: [theme("dawn.css", false)] });
    ourNav()?.click();
    labelled("Enable dawn")?.click();
    expect(fake.patches).toEqual([{ themes: { enabled: ["dawn.css"] } }]);
  });

  it("reports what happened, since the change lands out of view", async () => {
    fake.nextResult = { ok: true, message: "Added 1 theme." };
    ourNav()?.click();
    buttonLabelled("Add theme")?.click();
    await settle();

    expect(sectionText()).toContain("Added 1 theme.");
  });

  it("says nothing when the user cancels the dialog", async () => {
    fake.nextResult = { ok: false };
    ourNav()?.click();
    buttonLabelled("Add theme")?.click();
    await settle();

    expect(sectionText()).not.toContain("undefined");
  });
});

describe("plugins", () => {
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

  it("stays behind developer mode and says why", () => {
    ourNav()?.click();
    expect(sectionText()).toContain("credentials");
    expect(labelled("Enable Session Timer")).toBeNull();
  });

  it("offers no gear for a plugin that declares nothing", () => {
    withDeveloperMode([pluginSummary()]);
    ourNav()?.click();
    expect(labelled("Show Session Timer options")).toBeNull();
  });

  // A plugin's options only exist once it has run and registered them.
  it("offers no gear for a plugin that is not running", () => {
    withDeveloperMode([pluginSummary({ running: false, schema: { compact: { type: "boolean", label: "Compact", default: false } } })]);
    ourNav()?.click();
    expect(labelled("Show Session Timer options")).toBeNull();
  });

  it("reveals the options under the plugin when the gear is pressed", () => {
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
    ourNav()?.click();
    expect(ours()?.querySelectorAll(".pl-6")).toHaveLength(0);

    labelled("Show Session Timer options")?.click();

    expect(ours()?.querySelectorAll(".pl-6")).toHaveLength(2);
    expect(labelled("Hide Session Timer options")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("hides them again when the gear is pressed a second time", () => {
    withDeveloperMode([pluginSummary({ schema: { compact: { type: "boolean", label: "Compact", default: false } } })]);
    ourNav()?.click();
    labelled("Show Session Timer options")?.click();
    labelled("Hide Session Timer options")?.click();

    expect(ours()?.querySelectorAll(".pl-6")).toHaveLength(0);
  });

  it("writes a changed option straight through to the plugin", () => {
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
    ourNav()?.click();
    labelled("Show Session Timer options")?.click();

    const select = ours()?.querySelector("select");
    select!.value = "top-right";
    select!.dispatchEvent(new Event("change"));

    expect(fake.settingValues["corner"]).toBe("top-right");
  });

  it("keeps a plugin expanded across a re-render", () => {
    withDeveloperMode([pluginSummary({ schema: { compact: { type: "boolean", label: "Compact", default: false } } })]);
    ourNav()?.click();
    labelled("Show Session Timer options")?.click();

    settings.refresh();

    expect(labelled("Hide Session Timer options")).not.toBeNull();
  });

  it("reveals and deletes a plugin by folder", () => {
    withDeveloperMode([pluginSummary()]);
    ourNav()?.click();

    labelled("Show timer in Explorer")?.click();
    labelled("Delete Session Timer")?.click();

    expect(fake.calls).toEqual(["reveal:plugin:timer", "remove:plugin:timer"]);
  });
});

/**
 * A plugin can claim a sidebar entry of its own. The host owns the dialog, so
 * these check that a plugin's screen takes part in the same show-and-restore
 * dance as BetterGravity's own.
 */
describe("plugin sections", () => {
  const pluginNav = () => document.querySelector<HTMLButtonElement>('[data-bettergravity-nav="demo:Advanced"]');
  const pluginScreen = () => document.querySelector<HTMLElement>('[data-bettergravity-screen="demo:Advanced"]');

  const addSection = (render: (container: HTMLElement) => void = (container) => (container.textContent = "Plugin content")) =>
    registerSection({ id: "demo:Advanced", pluginId: "demo", label: "Advanced", render });

  beforeEach(async () => {
    install();
    mountHostSettings();
    await settle();
  });

  afterEach(() => resetSections());

  it("adds a sidebar entry beside BetterGravity's own", () => {
    addSection();

    expect(pluginNav()?.textContent).toBe("Advanced");
    expect(pluginNav()?.parentElement).toBe(ourNav()?.parentElement);
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

  it("renders the plugin's content when selected", () => {
    addSection();
    pluginNav()?.click();

    expect(pluginScreen()?.style.display).toBe("block");
    expect(pluginScreen()?.textContent).toBe("Plugin content");
  });

  it("hides Antigravity's screens while it is showing", () => {
    addSection();
    pluginNav()?.click();

    expect(hostScreen("General")?.style.display).toBe("none");
  });

  it("hides BetterGravity's screen when the user switches to it", () => {
    addSection();
    ourNav()?.click();
    pluginNav()?.click();

    expect(ours()?.style.display).toBe("none");
    expect(pluginScreen()?.style.display).toBe("block");
  });

  it("hands back to BetterGravity when the user switches away", () => {
    addSection();
    pluginNav()?.click();
    ourNav()?.click();

    expect(pluginScreen()?.style.display).toBe("none");
    expect(ours()?.style.display).toBe("block");
  });

  it("gives Antigravity its screens back when the user leaves", () => {
    addSection();
    pluginNav()?.click();
    hostNav("General")?.click();

    expect(pluginScreen()?.style.display).toBe("none");
    expect(hostScreen("General")?.style.display).toBe("block");
  });

  it("marks only the selected entry as active", () => {
    addSection();
    pluginNav()?.click();

    expect(pluginNav()?.className).toContain("bg-sidebar-secondary");
    expect(ourNav()?.className).not.toContain("bg-sidebar-secondary");
  });

  it("stays put when a re-render tries to show a screen underneath it", async () => {
    addSection();
    pluginNav()?.click();

    const general = hostScreen("General");
    if (general) general.style.display = "block";
    await settle();

    expect(general?.style.display).toBe("none");
    expect(pluginScreen()?.style.display).toBe("block");
  });

  it("re-renders on request while it is showing", () => {
    let count = 0;
    addSection((container) => (container.textContent = `Rendered ${(count += 1)}`));
    pluginNav()?.click();

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
    pluginNav()?.click();
    expect(hostScreen("General")?.style.display).toBe("none");

    remove();
    await settle();

    expect(hostScreen("General")?.style.display).toBe("block");
  });

  it("reports a section whose render throws instead of breaking the dialog", () => {
    addSection(() => {
      throw new Error("plugin bug");
    });
    pluginNav()?.click();

    expect(reported.join()).toContain("demo:Advanced");
    expect(ourNav()).not.toBeNull();
  });

  it("keeps two plugins' sections apart", () => {
    addSection();
    registerSection({
      id: "other:Advanced",
      pluginId: "other",
      label: "Advanced",
      render: (container) => (container.textContent = "Other content")
    });

    expect(document.querySelectorAll("[data-bettergravity-nav]")).toHaveLength(3);
    document.querySelector<HTMLButtonElement>('[data-bettergravity-nav="other:Advanced"]')?.click();

    expect(document.querySelector<HTMLElement>('[data-bettergravity-screen="other:Advanced"]')?.textContent).toBe("Other content");
    expect(pluginScreen()?.style.display).toBe("none");
  });

  it("takes plugin sections with it on destroy", () => {
    addSection();

    settings.destroy();

    expect(pluginNav()).toBeNull();
    expect(pluginScreen()).toBeNull();
  });
});

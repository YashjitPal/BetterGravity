// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addToolbarButton, resetToolbarButtons } from "../src/world/ui/button.js";
import { CHROME } from "../src/world/ui/chrome.js";
import { addMenuContributor, resetMenuContributors } from "../src/world/ui/menu.js";
import { openModal } from "../src/world/ui/modal.js";
import {
  listSections,
  onSectionRefresh,
  onSectionsChanged,
  registerSection,
  requestSectionRefresh,
  resetSections
} from "../src/world/ui/sections-registry.js";
import { showToast } from "../src/world/ui/toast.js";

let disposers: (() => void)[] = [];
const track = (dispose: () => void) => void disposers.push(dispose);

/** MutationObserver callbacks land on the microtask queue, not synchronously. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  disposers = [];
  document.body.innerHTML = "";
});

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  resetMenuContributors();
  resetToolbarButtons();
  resetSections();
  vi.useRealTimers();
});

describe("toasts", () => {
  it("renders into Antigravity's own toast viewport when it exists", () => {
    const host = document.createElement("div");
    host.className = CHROME.toastViewport;
    document.body.append(host);

    showToast({ title: "Saved" }, track);

    expect(host.textContent).toContain("Saved");
  });

  it("creates a viewport of its own when the host has not made one", () => {
    showToast({ title: "Saved" }, track);

    const viewport = document.querySelector("[data-bettergravity-toasts]");
    expect(viewport?.textContent).toContain("Saved");
  });

  it("reuses the viewport it created rather than stacking new ones", () => {
    showToast({ title: "First" }, track);
    showToast({ title: "Second" }, track);

    expect(document.querySelectorAll("[data-bettergravity-toasts]")).toHaveLength(1);
  });

  // Plugins run before the document is parsed, so the first toast of a session
  // often has no host viewport to go into. The stand-in should not outlive it.
  it("clears away the stand-in viewport once it empties", () => {
    vi.useFakeTimers();
    const toast = showToast({ title: "Early", duration: 0 }, track);

    toast.dismiss();
    vi.advanceTimersByTime(200);

    expect(document.querySelector("[data-bettergravity-toasts]")).toBeNull();
  });

  it("prefers the host's viewport once the app has mounted", () => {
    vi.useFakeTimers();
    const early = showToast({ title: "Early", duration: 0 }, track);
    early.dismiss();
    vi.advanceTimersByTime(200);

    const host = document.createElement("div");
    host.className = CHROME.toastViewport;
    document.body.append(host);
    showToast({ title: "Later", duration: 0 }, track);

    expect(host.textContent).toContain("Later");
    expect(document.querySelector("[data-bettergravity-toasts]")).toBeNull();
  });

  it("shows the body under the title", () => {
    showToast({ title: "Update ready", body: "Restart to apply." }, track);

    expect(document.body.textContent).toContain("Restart to apply.");
  });

  it("dismisses itself after the requested delay", async () => {
    vi.useFakeTimers();
    showToast({ title: "Briefly", duration: 1000 }, track);

    vi.advanceTimersByTime(1000);
    // The exit transition removes the node a beat later.
    vi.advanceTimersByTime(200);

    expect(document.body.textContent).not.toContain("Briefly");
  });

  it("stays until dismissed when the duration is zero", () => {
    vi.useFakeTimers();
    const toast = showToast({ title: "Sticky", duration: 0 }, track);

    vi.advanceTimersByTime(60_000);
    expect(document.body.textContent).toContain("Sticky");

    toast.dismiss();
    vi.advanceTimersByTime(200);
    expect(document.body.textContent).not.toContain("Sticky");
  });

  it("runs an action and then dismisses", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    showToast({ title: "Theme added", duration: 0, actions: [{ label: "Show folder", onSelect }] }, track);

    const button = [...document.querySelectorAll("button")].find((node) => node.textContent === "Show folder");
    button?.click();

    expect(onSelect).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(200);
    expect(document.body.textContent).not.toContain("Theme added");
  });

  it("goes away when the plugin is disabled", () => {
    vi.useFakeTimers();
    showToast({ title: "Left over", duration: 0 }, track);

    while (disposers.length > 0) disposers.pop()?.();
    vi.advanceTimersByTime(200);

    expect(document.body.textContent).not.toContain("Left over");
  });
});

describe("context menus", () => {
  /** The shape Base UI renders: a popup with the entries in an inner box. */
  const openMenu = (entries: readonly { testid: string; label: string }[], id = "popup-1"): HTMLElement => {
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-controls", id);
    trigger.setAttribute("aria-expanded", "true");
    trigger.setAttribute("data-popup-open", "");
    trigger.dataset.testid = "conversation-kebab";
    document.body.append(trigger);

    const portal = document.createElement("div");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.id = id;
    const box = document.createElement("div");
    box.className = CHROME.menu;
    for (const entry of entries) {
      const item = document.createElement("div");
      item.setAttribute("role", "menuitem");
      item.dataset.testid = entry.testid;
      item.textContent = entry.label;
      box.append(item);
    }
    menu.append(box);
    portal.append(menu);
    document.body.append(portal);
    return menu;
  };

  const entries = [
    { testid: "conversation-rename-menu-item", label: "Rename" },
    { testid: "conversation-delete-menu-item", label: "Delete" }
  ];

  it("adds an entry to a menu the host has already opened", () => {
    openMenu(entries);
    addMenuContributor(() => [{ label: "Copy id", onSelect: () => undefined }]);

    expect(document.body.textContent).toContain("Copy id");
  });

  it("adds an entry to a menu opened after registration", async () => {
    addMenuContributor(() => [{ label: "Copy id", onSelect: () => undefined }]);
    openMenu(entries);
    await settle();

    expect(document.body.textContent).toContain("Copy id");
  });

  it("identifies a menu by the test ids of the host's own entries", () => {
    openMenu(entries);
    const seen: string[][] = [];
    addMenuContributor((menu) => {
      seen.push([...menu.testids]);
      return menu.has("conversation-rename-menu-item") ? [{ label: "Pin", onSelect: () => undefined }] : [];
    });

    expect(seen).toEqual([["conversation-rename-menu-item", "conversation-delete-menu-item"]]);
    expect(document.body.textContent).toContain("Pin");
  });

  it("leaves menus a contributor declines alone", () => {
    openMenu([{ testid: "other-menu-item", label: "Other" }]);
    addMenuContributor((menu) => (menu.has("conversation-rename-menu-item") ? [{ label: "Pin", onSelect: () => undefined }] : undefined));

    expect(document.body.textContent).not.toContain("Pin");
    expect(document.querySelector("[data-bettergravity-menu-group]")).toBeNull();
  });

  it("reports the control the menu was opened from", () => {
    openMenu(entries);
    let trigger: HTMLElement | undefined;
    addMenuContributor((menu) => {
      trigger = menu.trigger;
      return [];
    });

    expect(trigger?.dataset.testid).toBe("conversation-kebab");
  });

  it("separates its entries from the host's", () => {
    openMenu(entries);
    addMenuContributor(() => [{ label: "Copy id", onSelect: () => undefined }]);

    const group = document.querySelector("[data-bettergravity-menu-group]");
    expect(group?.firstElementChild?.getAttribute("role")).toBe("separator");
  });

  it("adds no separator when the host's menu was empty", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const box = document.createElement("div");
    const placeholder = document.createElement("div");
    placeholder.setAttribute("role", "menuitem");
    box.append(placeholder);
    menu.append(box);
    document.body.append(menu);
    // Remove the placeholder now that the container has been established.
    placeholder.remove();

    addMenuContributor(() => [{ label: "Only entry", onSelect: () => undefined }]);
    expect(document.querySelector('[role="separator"]')).toBeNull();
  });

  it("runs the entry's handler when clicked", () => {
    const menu = openMenu(entries);
    const onSelect = vi.fn();
    addMenuContributor(() => [{ label: "Copy id", onSelect }]);

    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === "Copy id");
    item?.click();

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("closes the menu after the entry runs, the way the host does", () => {
    const menu = openMenu(entries);
    const keys: string[] = [];
    menu.addEventListener("keydown", (event) => keys.push(event.key));
    addMenuContributor(() => [{ label: "Copy id", onSelect: () => undefined }]);

    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === "Copy id");
    item?.click();

    expect(keys).toEqual(["Escape"]);
  });

  it("ignores clicks on a disabled entry", () => {
    const menu = openMenu(entries);
    const onSelect = vi.fn();
    addMenuContributor(() => [{ label: "Unavailable", disabled: true, onSelect }]);

    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === "Unavailable");
    item?.click();

    expect(onSelect).not.toHaveBeenCalled();
    expect(item?.getAttribute("aria-disabled")).toBe("true");
  });

  it("draws a destructive entry in the host's destructive colour", () => {
    const menu = openMenu(entries);
    addMenuContributor(() => [{ label: "Delete for good", danger: true, onSelect: () => undefined }]);

    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (node) => node.textContent === "Delete for good"
    );
    expect(item?.className).toContain("text-destructive");
  });

  it("keeps the host's menu working when a contributor throws", () => {
    openMenu(entries);
    addMenuContributor(() => {
      throw new Error("plugin bug");
    });
    addMenuContributor(() => [{ label: "Still here", onSelect: () => undefined }]);

    expect(document.body.textContent).toContain("Rename");
    expect(document.body.textContent).toContain("Still here");
  });

  it("collects entries from every contributor", () => {
    openMenu(entries);
    addMenuContributor(() => [{ label: "From one", onSelect: () => undefined }]);
    addMenuContributor(() => [{ label: "From two", onSelect: () => undefined }]);

    expect(document.body.textContent).toContain("From one");
    expect(document.body.textContent).toContain("From two");
  });

  it("takes its entries back when the plugin is disabled", () => {
    openMenu(entries);
    const remove = addMenuContributor(() => [{ label: "Copy id", onSelect: () => undefined }]);

    remove();

    expect(document.body.textContent).not.toContain("Copy id");
    expect(document.body.textContent).toContain("Rename");
  });

  it("re-adds its entries if the host re-renders the menu", async () => {
    const menu = openMenu(entries);
    addMenuContributor(() => [{ label: "Copy id", onSelect: () => undefined }]);

    document.querySelector("[data-bettergravity-menu-group]")?.remove();
    expect(menu.textContent).not.toContain("Copy id");

    // A re-render touches the menu, which is what brings the entries back.
    menu.querySelector("div")?.append(document.createElement("span"));
    await settle();

    expect(menu.textContent).toContain("Copy id");
  });

  it("asks a contributor once per menu rather than once per mutation", async () => {
    const menu = openMenu(entries);
    const contributor = vi.fn(() => [{ label: "Copy id", onSelect: () => undefined }]);
    addMenuContributor(contributor);

    menu.append(document.createElement("span"));
    await settle();
    menu.append(document.createElement("span"));
    await settle();

    expect(contributor).toHaveBeenCalledOnce();
  });
});

describe("toolbar buttons", () => {
  const titleBar = (): HTMLElement => {
    const bar = document.createElement("div");
    bar.dataset.testid = "title-menu-bar";
    document.body.append(bar);
    return bar;
  };

  const sidebar = (): HTMLElement => {
    const column = document.createElement("div");
    const newConversation = document.createElement("button");
    newConversation.dataset.testid = "new-conversation-button";
    column.append(newConversation);
    document.body.append(column);
    return column;
  };

  it("puts a button in the title bar", () => {
    const bar = titleBar();
    addToolbarButton({ area: "titleBar", label: "Plugins", onClick: () => undefined });

    expect(bar.querySelector("[data-bettergravity-button]")).not.toBeNull();
  });

  it("puts a sidebar button beside the host's own actions", () => {
    const column = sidebar();
    addToolbarButton({ area: "sidebar", label: "Plugins", onClick: () => undefined });

    expect(column.querySelector("[data-bettergravity-button]")?.textContent).toBe("Plugins");
  });

  it("waits for the toolbar to exist", async () => {
    addToolbarButton({ area: "titleBar", label: "Plugins", onClick: () => undefined });
    expect(document.querySelector("[data-bettergravity-button]")).toBeNull();

    titleBar();
    await settle();

    expect(document.querySelector("[data-bettergravity-button]")).not.toBeNull();
  });

  it("comes back when the host rebuilds its toolbar", async () => {
    const bar = titleBar();
    addToolbarButton({ area: "titleBar", label: "Plugins", onClick: () => undefined });

    bar.remove();
    const rebuilt = titleBar();
    await settle();

    expect(rebuilt.querySelector("[data-bettergravity-button]")).not.toBeNull();
  });

  it("adds itself once, not once per mutation", async () => {
    const bar = titleBar();
    addToolbarButton({ area: "titleBar", label: "Plugins", onClick: () => undefined });

    bar.append(document.createElement("span"));
    await settle();

    expect(bar.querySelectorAll("[data-bettergravity-button]")).toHaveLength(1);
  });

  it("runs the handler when clicked", () => {
    titleBar();
    const onClick = vi.fn();
    const handle = addToolbarButton({ area: "titleBar", label: "Plugins", onClick });

    handle.element?.click();

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("survives a handler that throws", () => {
    titleBar();
    const handle = addToolbarButton({
      area: "titleBar",
      label: "Plugins",
      onClick: () => {
        throw new Error("plugin bug");
      }
    });

    expect(() => handle.element?.click()).not.toThrow();
  });

  it("does not drag the window when the title bar is a drag region", () => {
    titleBar();
    const handle = addToolbarButton({ area: "titleBar", label: "Plugins", onClick: () => undefined });

    expect(handle.element?.hasAttribute("data-no-drag")).toBe(true);
  });

  it("relabels and marks itself active", () => {
    sidebar();
    const handle = addToolbarButton({ area: "sidebar", label: "Plugins", onClick: () => undefined });

    handle.setLabel("Plugins (3)");
    handle.setActive(true);

    expect(handle.element?.textContent).toBe("Plugins (3)");
    expect(handle.element?.getAttribute("aria-pressed")).toBe("true");
  });

  it("goes away when removed and stays away", async () => {
    const bar = titleBar();
    const handle = addToolbarButton({ area: "titleBar", label: "Plugins", onClick: () => undefined });

    handle.remove();
    bar.append(document.createElement("span"));
    await settle();

    expect(document.querySelector("[data-bettergravity-button]")).toBeNull();
  });
});

describe("modals", () => {
  it("fills the body through the render callback", () => {
    openModal({ title: "Pick a theme", render: (body) => body.append(document.createTextNode("Contents")) }, track);

    expect(document.body.textContent).toContain("Pick a theme");
    expect(document.body.textContent).toContain("Contents");
  });

  it("closes on Escape", () => {
    openModal({ title: "Pick a theme", render: () => undefined }, track);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.body.textContent).not.toContain("Pick a theme");
  });

  it("closes when the backdrop is clicked", () => {
    openModal({ title: "Pick a theme", render: () => undefined }, track);

    document.querySelector<HTMLElement>('[role="dialog"]')?.parentElement?.click();

    expect(document.body.textContent).not.toContain("Pick a theme");
  });

  it("stays open when the dialog itself is clicked", () => {
    openModal({ title: "Pick a theme", render: () => undefined }, track);

    document.querySelector<HTMLElement>('[role="dialog"]')?.click();

    expect(document.body.textContent).toContain("Pick a theme");
  });

  it("closes from inside through the supplied callback", () => {
    let close = () => undefined as void;
    openModal({ title: "Pick a theme", render: (_body, dismiss) => (close = dismiss) }, track);

    close();

    expect(document.body.textContent).not.toContain("Pick a theme");
  });

  it("reports closing once, however it was closed", () => {
    const onClose = vi.fn();
    const handle = openModal({ title: "Pick a theme", render: () => undefined, onClose }, track);

    handle.close();
    handle.close();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not leave a half-built dialog on screen", () => {
    openModal(
      {
        title: "Pick a theme",
        render: () => {
          throw new Error("plugin bug");
        }
      },
      track
    );

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes when the plugin is disabled", () => {
    openModal({ title: "Pick a theme", render: () => undefined }, track);

    while (disposers.length > 0) disposers.pop()?.();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("settings sections", () => {
  const section = (id: string, label: string) => ({ id, pluginId: "demo", label, render: () => undefined });

  it("lists what plugins have registered", () => {
    registerSection(section("demo:Advanced", "Advanced"));

    expect(listSections().map((entry) => entry.label)).toEqual(["Advanced"]);
  });

  it("replaces a section registered twice under one id", () => {
    registerSection(section("demo:Advanced", "Advanced"));
    registerSection(section("demo:Advanced", "Advanced options"));

    expect(listSections()).toHaveLength(1);
    expect(listSections()[0]?.label).toBe("Advanced options");
  });

  it("tells the host when the set changes", () => {
    const onChange = vi.fn();
    const stop = onSectionsChanged(onChange);

    const remove = registerSection(section("demo:Advanced", "Advanced"));
    remove();
    stop();

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when removing something that was never there", () => {
    const onChange = vi.fn();
    const stop = onSectionsChanged(onChange);

    const remove = registerSection(section("demo:Advanced", "Advanced"));
    remove();
    remove();
    stop();

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("passes a refresh request through to the host", () => {
    const onRefresh = vi.fn();
    const stop = onSectionRefresh(onRefresh);

    requestSectionRefresh("demo:Advanced");
    stop();

    expect(onRefresh).toHaveBeenCalledWith("demo:Advanced");
  });

  it("keeps telling the other listeners when one throws", () => {
    const good = vi.fn();
    const stopBad = onSectionRefresh(() => {
      throw new Error("plugin bug");
    });
    const stopGood = onSectionRefresh(good);

    requestSectionRefresh("demo:Advanced");
    stopBad();
    stopGood();

    expect(good).toHaveBeenCalledOnce();
  });
});

import type { BetterGravityApi } from "../api.js";
import { el } from "../el.js";
import { listSections, onSectionRefresh, onSectionsChanged } from "../ui/sections-registry.js";
import { createCatalogStore } from "./catalog-store.js";
import { NATIVE, NAV_ATTRIBUTE, navButton, navGroup } from "./native.js";
import { buildPluginsScreen, buildSettingsScreen, buildThemesScreen, type SectionCallbacks } from "./sections.js";

const SELECTOR = {
  modal: ".settings-modal-container",
  navItem: "[data-testid^='settings-nav-item-']",
  screens: "div.grow.w-full"
} as const;

const SCREEN_ATTRIBUTE = "data-bettergravity-screen";
const GROUP_ATTRIBUTE = "data-bettergravity-nav-group";
const GROUP_LIST_ATTRIBUTE = "data-bettergravity-nav-list";

/** The heading these sit under, and the ids of the three built-in screens. */
const HEADING = "BetterGravity";
const PANEL = { settings: "Settings", plugins: "Plugins", themes: "Themes" } as const;
const BUILT_IN_SCREEN_ID = "bettergravity-settings";

export interface NativeSettings {
  /** Rebuilds the screen in place if one of ours is showing. */
  refresh(): void;
  /** Opens Antigravity's settings on BetterGravity's own screen. */
  open(): void;
  /** Leaves our screen without closing Antigravity's settings. */
  close(): void;
  isOpen(): boolean;
  /** Rebuilds a plugin's section if it is the one on screen. */
  refreshSection(id: string): void;
  destroy(): void;
}

/**
 * One entry in the settings sidebar that BetterGravity owns, whether that is
 * one of its own screens or one contributed by a plugin.
 */
interface Panel {
  readonly id: string;
  label: string;
  render: (container: HTMLElement) => void;
  navEntry: HTMLElement | undefined;
  screen: HTMLElement | undefined;
}

/**
 * The list holding the most nav items is Antigravity's main one, rather than
 * the account footer or one of the smaller project groups. Our own group is
 * skipped so it cannot be mistaken for the host's once it grows.
 */
function findNavList(modal: Element): Element | undefined {
  const byParent = new Map<Element, number>();
  for (const item of modal.querySelectorAll(SELECTOR.navItem)) {
    const parent = item.parentElement;
    if (!parent || parent.closest(`[${GROUP_ATTRIBUTE}]`)) continue;
    byParent.set(parent, (byParent.get(parent) ?? 0) + 1);
  }
  let best: Element | undefined;
  let bestCount = 0;
  for (const [parent, count] of byParent) {
    if (count > bestCount) {
      best = parent;
      bestCount = count;
    }
  }
  return best;
}

function nativeScreens(container: Element): readonly HTMLElement[] {
  return [...container.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !child.hasAttribute(SCREEN_ATTRIBUTE)
  );
}

/**
 * Puts BetterGravity into Antigravity's own settings dialog, as a group in its
 * sidebar rather than a separate window.
 *
 * Antigravity groups its sidebar under small headings — Settings, Projects, Not
 * in Project — so BetterGravity adds one of its own with Settings, Plugins, and
 * Themes under it. Its settings are React-rendered, so the group and the screens
 * are re-added whenever the dialog is rebuilt, and the active screen re-asserts
 * itself if a re-render tries to show a native one underneath it.
 *
 * Plugins can add entries of their own. They go through this host too, because
 * hiding the app's screens and putting them back is a single-owner job: two
 * independent injectors would each restore what the other hid.
 */
export function installNativeSettings(api: BetterGravityApi, report: (message: string) => void): NativeSettings {
  /** Which of our panels is showing, if any. */
  let activeId: string | undefined;

  /**
   * Antigravity toggles its screens with inline `display`, and React will not
   * rewrite a value it believes is already correct. Hiding its screens without
   * remembering them means the screen we hid stays hidden when the user selects
   * it again, leaving the dialog blank. So the originals are restored on the way
   * out rather than left for React to fix.
   */
  const hiddenScreens = new Map<HTMLElement, string>();

  const hideNative = (element: HTMLElement): void => {
    if (!hiddenScreens.has(element)) hiddenScreens.set(element, element.style.display);
    element.style.display = "none";
  };

  const restoreNative = (): void => {
    for (const [element, display] of hiddenScreens) element.style.display = display;
    hiddenScreens.clear();
  };

  let notice: string | undefined;
  let noticeTimer: number | undefined;
  /** Which plugins have their options revealed. Survives a re-render. */
  const expanded = new Set<string>();
  /** Search text per screen, so switching screens does not carry a filter over. */
  const queries = new Map<string, string>();

  const notify = (message: string): void => {
    notice = message;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      notice = undefined;
      renderActive();
    }, 6000);
    renderActive();
  };

  const catalog = createCatalogStore(api, { changed: () => renderActive(), notify });

  const callbacksFor = (panelId: string): SectionCallbacks => ({
    refresh: () => renderActive(),
    notify,
    isExpanded: (pluginId) => expanded.has(pluginId),
    toggleExpanded: (pluginId) => {
      if (!expanded.delete(pluginId)) expanded.add(pluginId);
      renderActive();
    },
    query: queries.get(panelId) ?? "",
    setQuery: (value) => {
      queries.set(panelId, value);
      renderActive();
      // Redrawing replaces the field, so the caret has to be put back.
      const replacement = find(panelId)?.screen?.querySelector<HTMLInputElement>('input[type="search"]');
      replacement?.focus();
      replacement?.setSelectionRange(replacement.value.length, replacement.value.length);
    },
    catalog
  });

  const panel = (id: string, build: (api: BetterGravityApi, callbacks: SectionCallbacks, notice?: string) => HTMLElement): Panel => ({
    id,
    label: id,
    render: (container) => container.replaceChildren(build(api, callbacksFor(id), notice)),
    navEntry: undefined,
    screen: undefined
  });

  const own: readonly Panel[] = [
    panel(PANEL.settings, buildSettingsScreen),
    panel(PANEL.plugins, buildPluginsScreen),
    panel(PANEL.themes, buildThemesScreen)
  ];

  /** Keeps each contributed panel's DOM across re-registrations. */
  const extra = new Map<string, Panel>();

  /**
   * Our own screens first, then whatever plugins have registered. Reconciles
   * against the registry on the way, so a section that has been unregistered
   * takes its sidebar entry and screen with it.
   */
  const panels = (): readonly Panel[] => {
    const contributed: Panel[] = [];
    const live = new Set<string>();

    for (const section of listSections()) {
      live.add(section.id);
      const existing = extra.get(section.id);
      if (existing) {
        existing.label = section.label;
        existing.render = section.render;
        contributed.push(existing);
        continue;
      }
      const added: Panel = {
        id: section.id,
        label: section.label,
        render: section.render,
        navEntry: undefined,
        screen: undefined
      };
      extra.set(section.id, added);
      contributed.push(added);
    }

    for (const [id, entry] of extra) {
      if (live.has(id)) continue;
      entry.navEntry?.remove();
      entry.screen?.remove();
      extra.delete(id);
      if (activeId === id) {
        activeId = undefined;
        restoreNative();
      }
    }

    return [...own, ...contributed];
  };

  const find = (id: string): Panel | undefined => panels().find((entry) => entry.id === id);

  const renderActive = (): void => {
    const active = activeId === undefined ? undefined : find(activeId);
    if (!active?.screen) return;
    try {
      active.render(active.screen);
    } catch (error) {
      report(`${active.id}: rendering its settings section threw: ${String(error)}`);
    }
  };

  /**
   * Dropping a theme is the shortest path from "I found a theme online" to
   * "it is applied". Only the file's text crosses, never a path, so this works
   * without any of Electron's file-path plumbing.
   */
  const acceptDrop = (element: HTMLElement): void => {
    const stop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    element.addEventListener("dragover", (event) => {
      stop(event);
      element.classList.add("ring-2", "ring-primary");
    });
    element.addEventListener("dragleave", () => element.classList.remove("ring-2", "ring-primary"));
    element.addEventListener("drop", (event) => {
      stop(event);
      element.classList.remove("ring-2", "ring-primary");

      const files = [...(event.dataTransfer?.files ?? [])];
      const stylesheets = files.filter((file) => file.name.toLowerCase().endsWith(".css"));
      if (stylesheets.length === 0) {
        notify(files.length > 0 ? "Only .css files can be dropped here." : "Nothing to add.");
        return;
      }

      void Promise.all(stylesheets.map(async (file) => api.content.addThemeText(file.name, await file.text()))).then(
        (results) => {
          const failure = results.find((result) => !result.ok);
          notify(failure?.message ?? `Added ${results.length} theme${results.length === 1 ? "" : "s"}.`);
        }
      );
    });
  };

  const setNavState = (entry: Panel, isActive: boolean): void => {
    const button = entry.navEntry;
    if (!button) return;
    button.className = `${NATIVE.navItem} ${isActive ? NATIVE.navItemActive : NATIVE.navItemIdle}`;
    const label = button.firstElementChild;
    if (label) label.className = `${NATIVE.navLabel} ${isActive ? NATIVE.navLabelActive : NATIVE.navLabelIdle}`;
  };

  const activate = (id: string): void => {
    const all = panels();
    const target = all.find((entry) => entry.id === id);
    const modal = document.querySelector(SELECTOR.modal);
    const container = modal?.querySelector(SELECTOR.screens);
    if (!target?.screen || !container) return;

    for (const native of nativeScreens(container)) hideNative(native);
    for (const entry of all) {
      const isTarget = entry.id === id;
      if (entry.screen) entry.screen.style.display = isTarget ? "block" : "none";
      setNavState(entry, isTarget);
    }

    activeId = id;
    renderActive();
  };

  const deactivate = (): void => {
    if (activeId === undefined) return;
    activeId = undefined;
    for (const entry of panels()) {
      if (entry.screen) entry.screen.style.display = "none";
      setNavState(entry, false);
    }
    restoreNative();
  };

  /** The heading and list our entries live in, created once per dialog. */
  const ensureGroup = (modal: Element): HTMLElement | undefined => {
    const existing = modal.querySelector<HTMLElement>(`[${GROUP_LIST_ATTRIBUTE}]`);
    if (existing) return existing;

    const hostList = findNavList(modal);
    if (!hostList) return undefined;

    const group = navGroup(HEADING);
    group.element.setAttribute(GROUP_ATTRIBUTE, "");
    group.list.setAttribute(GROUP_LIST_ATTRIBUTE, "");
    // Directly after Antigravity's own settings entries, before its projects.
    hostList.after(group.element);
    return group.list;
  };

  const inject = (): void => {
    const modal = document.querySelector(SELECTOR.modal);
    if (!modal) {
      // The dialog is closed; anything we added went with it.
      for (const entry of [...own, ...extra.values()]) {
        entry.navEntry = undefined;
        entry.screen = undefined;
      }
      activeId = undefined;
      hiddenScreens.clear();
      return;
    }

    const list = ensureGroup(modal);
    const container = modal.querySelector(SELECTOR.screens);
    if (!list || !container) return;

    for (const entry of panels()) {
      if (!list.querySelector(`[${NAV_ATTRIBUTE}="${CSS.escape(entry.id)}"]`)) {
        entry.navEntry = navButton(entry.id, entry.label, activeId === entry.id, () => activate(entry.id));
        list.append(entry.navEntry);
      }

      if (!container.querySelector(`[${SCREEN_ATTRIBUTE}="${CSS.escape(entry.id)}"]`)) {
        // Deliberately imposes no height. Antigravity's own screen wrappers
        // carry no classes at all, and letting this one size to its content is
        // what keeps scrolling on the dialog's outer container, where the
        // scrollbar has a reserved gutter. Constraining it here makes the inner
        // pane scroll instead, which insets the scrollbar by that gutter's width.
        const screen = el("div", {
          [SCREEN_ATTRIBUTE]: entry.id,
          // A stable handle for themes that want to restyle the section.
          id: entry.id === PANEL.settings ? BUILT_IN_SCREEN_ID : undefined,
          class: "rounded-lg transition-shadow"
        });
        screen.style.display = activeId === entry.id ? "block" : "none";
        if (entry.id === PANEL.themes) acceptDrop(screen);
        entry.screen = screen;
        container.append(screen);
        if (activeId === entry.id) renderActive();
      }
    }
  };

  // Clicking one of Antigravity's own entries hands the dialog back to it.
  // Handled on capture so it runs before React shows the native screen, which
  // keeps the re-assert below from fighting the user. Our own entries carry
  // their own handler, so they are left alone here.
  const onClick = (event: Event): void => {
    const target = event.target as Element | null;
    const item = target?.closest?.(SELECTOR.navItem);
    if (item && !item.hasAttribute(NAV_ATTRIBUTE)) deactivate();
  };

  const observer = new MutationObserver(() => {
    inject();
    if (activeId === undefined) return;
    const active = find(activeId);
    const container = active?.screen?.parentElement;
    if (!active?.screen || !container) return;

    // A re-render can restore a native screen underneath ours; put it back.
    for (const native of nativeScreens(container)) {
      if (native.style.display !== "none") hideNative(native);
    }
    if (active.screen.style.display !== "block") active.screen.style.display = "block";
  });

  // Registering or removing a plugin section while the dialog is open should
  // show up without the user having to close and reopen it.
  const stopWatchingSections = onSectionsChanged(() => inject());
  const stopWatchingRefreshes = onSectionRefresh((id) => {
    if (activeId === id) renderActive();
  });

  // The runtime is injected before the document is parsed, so there may be no
  // body to observe yet.
  const startObserving = () => {
    observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"]
    });
    inject();
  };

  document.addEventListener("click", onClick, true);
  if (document.body) startObserving();
  else document.addEventListener("DOMContentLoaded", startObserving, { once: true });

  const openHostSettings = (): boolean => {
    const entry = [...document.querySelectorAll<HTMLElement>("button, a, [role=button]")]
      .filter((candidate) => (candidate.textContent ?? "").trim() === "Settings")
      .pop();
    if (!entry) return false;
    entry.click();
    return true;
  };

  return {
    refresh: () => renderActive(),
    refreshSection: (id) => {
      if (activeId === id) renderActive();
    },
    open: () => {
      if (document.querySelector(SELECTOR.modal)) {
        inject();
        activate(PANEL.settings);
        return;
      }
      if (!openHostSettings()) {
        report("could not find Antigravity's Settings entry to open");
        return;
      }
      // The dialog mounts asynchronously.
      window.setTimeout(() => {
        inject();
        activate(PANEL.settings);
      }, 400);
    },
    // Hands the dialog back to whichever screen Antigravity had selected.
    close: deactivate,
    isOpen: () => activeId !== undefined,
    destroy: () => {
      document.removeEventListener("click", onClick, true);
      stopWatchingSections();
      stopWatchingRefreshes();
      observer.disconnect();
      for (const entry of [...own, ...extra.values()]) {
        entry.screen?.remove();
        entry.navEntry?.remove();
        entry.screen = undefined;
        entry.navEntry = undefined;
      }
      document.querySelector(`[${GROUP_ATTRIBUTE}]`)?.remove();
      extra.clear();
      activeId = undefined;
    }
  };
}

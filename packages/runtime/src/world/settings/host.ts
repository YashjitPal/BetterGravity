import type { BetterGravityApi } from "../api.js";
import { el } from "../el.js";
import { listSections, onSectionRefresh, onSectionsChanged } from "../ui/sections-registry.js";
import { NATIVE, NAV_ATTRIBUTE, navButton } from "./native.js";
import { buildSettingsScreen } from "./sections.js";

const SELECTOR = {
  modal: ".settings-modal-container",
  navItem: "[data-testid^='settings-nav-item-']",
  screens: "div.grow.w-full"
} as const;

const SCREEN_ATTRIBUTE = "data-bettergravity-screen";
const BUILT_IN = "BetterGravity";
const BUILT_IN_SCREEN_ID = "bettergravity-settings";

export interface NativeSettings {
  /** Rebuilds the section in place if it is currently showing. */
  refresh(): void;
  /** Opens Antigravity's settings with the BetterGravity section selected. */
  open(): void;
  /** Leaves the BetterGravity section without closing Antigravity's settings. */
  close(): void;
  isOpen(): boolean;
  /** Rebuilds a plugin's section if it is the one on screen. */
  refreshSection(id: string): void;
  destroy(): void;
}

/**
 * One entry in the settings sidebar that BetterGravity owns, whether that is
 * BetterGravity's own screen or one contributed by a plugin.
 */
interface Panel {
  readonly id: string;
  label: string;
  render: (container: HTMLElement) => void;
  navEntry: HTMLElement | undefined;
  screen: HTMLElement | undefined;
}

/** The list holding the most nav items is the main one, not the account footer. */
function findNavList(modal: Element): Element | undefined {
  const byParent = new Map<Element, number>();
  for (const item of modal.querySelectorAll(SELECTOR.navItem)) {
    const parent = item.parentElement;
    if (!parent) continue;
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
 * Puts BetterGravity into Antigravity's own settings dialog, as another entry in
 * its sidebar rather than a separate window.
 *
 * Antigravity's settings are React-rendered, so both the nav entry and the
 * screen are re-added whenever the dialog is rebuilt, and the section re-asserts
 * itself if a re-render tries to show a native screen underneath it.
 *
 * Plugins can add sidebar entries of their own. They go through this host too,
 * because hiding the app's screens and putting them back is a single-owner job:
 * two independent injectors would each restore what the other hid.
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

  const callbacks = {
    refresh: () => renderActive(),
    notify: (message: string) => {
      notice = message;
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => {
        notice = undefined;
        renderActive();
      }, 6000);
      renderActive();
    },
    isExpanded: (pluginId: string) => expanded.has(pluginId),
    toggleExpanded: (pluginId: string) => {
      if (!expanded.delete(pluginId)) expanded.add(pluginId);
      renderActive();
    }
  };

  const builtIn: Panel = {
    id: BUILT_IN,
    label: BUILT_IN,
    render: (container) => container.replaceChildren(buildSettingsScreen(api, callbacks, notice)),
    navEntry: undefined,
    screen: undefined
  };

  /** Keeps each contributed panel's DOM across re-registrations. */
  const extra = new Map<string, Panel>();

  /**
   * BetterGravity's own screen first, then whatever plugins have registered.
   * Reconciles against the registry on the way, so a section that has been
   * unregistered takes its sidebar entry and screen with it.
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
      const panel: Panel = {
        id: section.id,
        label: section.label,
        render: section.render,
        navEntry: undefined,
        screen: undefined
      };
      extra.set(section.id, panel);
      contributed.push(panel);
    }

    for (const [id, panel] of extra) {
      if (live.has(id)) continue;
      panel.navEntry?.remove();
      panel.screen?.remove();
      extra.delete(id);
      if (activeId === id) {
        activeId = undefined;
        restoreNative();
      }
    }

    return [builtIn, ...contributed];
  };

  const find = (id: string): Panel | undefined => panels().find((panel) => panel.id === id);

  const renderActive = (): void => {
    const panel = activeId === undefined ? undefined : find(activeId);
    if (!panel?.screen) return;
    try {
      panel.render(panel.screen);
    } catch (error) {
      report(`${panel.id}: rendering its settings section threw: ${String(error)}`);
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
        callbacks.notify(files.length > 0 ? "Only .css files can be dropped here." : "Nothing to add.");
        return;
      }

      void Promise.all(stylesheets.map(async (file) => api.content.addThemeText(file.name, await file.text()))).then(
        (results) => {
          const failure = results.find((result) => !result.ok);
          callbacks.notify(failure?.message ?? `Added ${results.length} theme${results.length === 1 ? "" : "s"}.`);
        }
      );
    });
  };

  const setNavState = (panel: Panel, isActive: boolean): void => {
    const entry = panel.navEntry;
    if (!entry) return;
    entry.className = `${NATIVE.navItem} ${isActive ? NATIVE.navItemActive : NATIVE.navItemIdle}`;
    const label = entry.firstElementChild;
    if (label) label.className = `${NATIVE.navLabel} ${isActive ? NATIVE.navLabelActive : NATIVE.navLabelIdle}`;
  };

  const activate = (id: string): void => {
    const all = panels();
    const target = all.find((panel) => panel.id === id);
    const modal = document.querySelector(SELECTOR.modal);
    const container = modal?.querySelector(SELECTOR.screens);
    if (!target?.screen || !container) return;

    for (const native of nativeScreens(container)) hideNative(native);
    for (const panel of all) {
      const isTarget = panel.id === id;
      if (panel.screen) panel.screen.style.display = isTarget ? "block" : "none";
      setNavState(panel, isTarget);
    }

    activeId = id;
    renderActive();
  };

  const deactivate = (): void => {
    if (activeId === undefined) return;
    activeId = undefined;
    for (const panel of panels()) {
      if (panel.screen) panel.screen.style.display = "none";
      setNavState(panel, false);
    }
    restoreNative();
  };

  const inject = (): void => {
    const modal = document.querySelector(SELECTOR.modal);
    if (!modal) {
      // The dialog is closed; anything we added went with it.
      builtIn.navEntry = undefined;
      builtIn.screen = undefined;
      for (const panel of extra.values()) {
        panel.navEntry = undefined;
        panel.screen = undefined;
      }
      activeId = undefined;
      hiddenScreens.clear();
      return;
    }

    const navList = findNavList(modal);
    const container = modal.querySelector(SELECTOR.screens);
    if (!navList || !container) return;

    for (const panel of panels()) {
      if (!navList.querySelector(`[${NAV_ATTRIBUTE}="${CSS.escape(panel.id)}"]`)) {
        panel.navEntry = navButton(panel.id, panel.label, activeId === panel.id, () => activate(panel.id));
        navList.append(panel.navEntry);
      }

      if (!container.querySelector(`[${SCREEN_ATTRIBUTE}="${CSS.escape(panel.id)}"]`)) {
        // Deliberately imposes no height. Antigravity's own screen wrappers
        // carry no classes at all, and letting this one size to its content is
        // what keeps scrolling on the dialog's outer container, where the
        // scrollbar has a reserved gutter. Constraining it here makes the inner
        // pane scroll instead, which insets the scrollbar by that gutter's width.
        const screen = el("div", {
          [SCREEN_ATTRIBUTE]: panel.id,
          // A stable handle for themes that want to restyle the section.
          id: panel.id === BUILT_IN ? BUILT_IN_SCREEN_ID : undefined,
          class: "rounded-lg transition-shadow"
        });
        screen.style.display = activeId === panel.id ? "block" : "none";
        if (panel.id === BUILT_IN) acceptDrop(screen);
        panel.screen = screen;
        container.append(screen);
        if (activeId === panel.id) renderActive();
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
    const panel = find(activeId);
    const container = panel?.screen?.parentElement;
    if (!panel?.screen || !container) return;

    // A re-render can restore a native screen underneath ours; put it back.
    for (const native of nativeScreens(container)) {
      if (native.style.display !== "none") hideNative(native);
    }
    if (panel.screen.style.display !== "block") panel.screen.style.display = "block";
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
    refresh: () => {
      if (activeId === BUILT_IN) renderActive();
    },
    refreshSection: (id) => {
      if (activeId === id) renderActive();
    },
    open: () => {
      if (document.querySelector(SELECTOR.modal)) {
        inject();
        activate(BUILT_IN);
        return;
      }
      if (!openHostSettings()) {
        report("could not find Antigravity's Settings entry to open");
        return;
      }
      // The dialog mounts asynchronously.
      window.setTimeout(() => {
        inject();
        activate(BUILT_IN);
      }, 400);
    },
    // Hands the dialog back to whichever screen Antigravity had selected.
    close: deactivate,
    isOpen: () => activeId === BUILT_IN,
    destroy: () => {
      document.removeEventListener("click", onClick, true);
      stopWatchingSections();
      stopWatchingRefreshes();
      observer.disconnect();
      for (const panel of [builtIn, ...extra.values()]) {
        panel.screen?.remove();
        panel.navEntry?.remove();
        panel.screen = undefined;
        panel.navEntry = undefined;
      }
      extra.clear();
      activeId = undefined;
    }
  };
}

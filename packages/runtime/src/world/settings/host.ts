import type { BetterGravityApi } from "../api.js";
import { el } from "../el.js";
import { NATIVE, navButton } from "./native.js";
import { buildSettingsScreen } from "./sections.js";

const SELECTOR = {
  modal: ".settings-modal-container",
  navItem: "[data-testid^='settings-nav-item-']",
  screens: "div.grow.w-full"
} as const;

const OURS = "bettergravity-settings";
const OUR_NAV = "settings-nav-item-BetterGravity";

export interface NativeSettings {
  /** Rebuilds the section in place if it is currently showing. */
  refresh(): void;
  /** Opens Antigravity's settings with the BetterGravity section selected. */
  open(): void;
  /** Leaves the BetterGravity section without closing Antigravity's settings. */
  close(): void;
  isOpen(): boolean;
  destroy(): void;
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
  return [...container.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.id !== OURS);
}

/**
 * Puts BetterGravity into Antigravity's own settings dialog, as another entry in
 * its sidebar rather than a separate window.
 *
 * Antigravity's settings are React-rendered, so both the nav entry and the
 * screen are re-added whenever the dialog is rebuilt, and the section re-asserts
 * itself if a re-render tries to show a native screen underneath it.
 */
export function installNativeSettings(api: BetterGravityApi, report: (message: string) => void): NativeSettings {
  let active = false;
  let screen: HTMLElement | undefined;
  let navEntry: HTMLElement | undefined;

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
    refresh: () => render(),
    notify: (message: string) => {
      notice = message;
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => {
        notice = undefined;
        render();
      }, 6000);
      render();
    },
    isExpanded: (pluginId: string) => expanded.has(pluginId),
    toggleExpanded: (pluginId: string) => {
      if (!expanded.delete(pluginId)) expanded.add(pluginId);
      render();
    }
  };

  const render = (): void => {
    if (!screen) return;
    screen.replaceChildren(buildSettingsScreen(api, callbacks, notice));
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

  const setNavState = (isActive: boolean): void => {
    if (!navEntry) return;
    navEntry.className = `${NATIVE.navItem} ${isActive ? NATIVE.navItemActive : NATIVE.navItemIdle}`;
    const label = navEntry.firstElementChild;
    if (label) label.className = `${NATIVE.navLabel} ${isActive ? NATIVE.navLabelActive : NATIVE.navLabelIdle}`;
  };

  const activate = (): void => {
    const modal = document.querySelector(SELECTOR.modal);
    const container = modal?.querySelector(SELECTOR.screens);
    if (!container || !screen) return;

    for (const native of nativeScreens(container)) hideNative(native);
    screen.style.display = "block";
    active = true;
    setNavState(true);
    render();
  };

  const deactivate = (): void => {
    if (!active) return;
    active = false;
    if (screen) screen.style.display = "none";
    restoreNative();
    setNavState(false);
  };

  const inject = (): void => {
    const modal = document.querySelector(SELECTOR.modal);
    if (!modal) {
      // The dialog is closed; anything we added went with it.
      screen = undefined;
      navEntry = undefined;
      active = false;
      return;
    }

    const navList = findNavList(modal);
    const container = modal.querySelector(SELECTOR.screens);
    if (!navList || !container) return;

    if (!navList.querySelector(`[data-testid="${OUR_NAV}"]`)) {
      navEntry = navButton("BetterGravity", active, () => activate());
      navList.append(navEntry);
    }

    if (!container.querySelector(`#${OURS}`)) {
      // Deliberately imposes no height. Antigravity's own screen wrappers carry
      // no classes at all, and letting this one size to its content is what
      // keeps scrolling on the dialog's outer container, where the scrollbar has
      // a reserved gutter. Constraining it here makes the inner pane scroll
      // instead, which insets the scrollbar by the width of that gutter.
      screen = el("div", { id: OURS, class: "rounded-lg transition-shadow" });
      screen.style.display = active ? "block" : "none";
      acceptDrop(screen);
      container.append(screen);
      if (active) render();
    }
  };

  // Clicking one of Antigravity's own entries hands the dialog back to it.
  // Handled on capture so it runs before React shows the native screen, which
  // keeps the re-assert below from fighting the user.
  const onClick = (event: Event): void => {
    const target = event.target as Element | null;
    const item = target?.closest?.(SELECTOR.navItem);
    if (item && item.getAttribute("data-testid") !== OUR_NAV) deactivate();
  };

  const observer = new MutationObserver(() => {
    inject();
    if (!active || !screen) return;

    // A re-render can restore a native screen underneath ours; put it back.
    const container = screen.parentElement;
    if (!container) return;
    for (const native of nativeScreens(container)) {
      if (native.style.display !== "none") hideNative(native);
    }
    if (screen.style.display !== "block") screen.style.display = "block";
  });

  document.addEventListener("click", onClick, true);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  inject();

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
      if (active) render();
    },
    open: () => {
      if (document.querySelector(SELECTOR.modal)) {
        inject();
        activate();
        return;
      }
      if (!openHostSettings()) {
        report("could not find Antigravity's Settings entry to open");
        return;
      }
      // The dialog mounts asynchronously.
      window.setTimeout(() => {
        inject();
        activate();
      }, 400);
    },
    // Hands the dialog back to whichever screen Antigravity had selected.
    close: deactivate,
    isOpen: () => active,
    destroy: () => {
      document.removeEventListener("click", onClick, true);
      observer.disconnect();
      screen?.remove();
      navEntry?.remove();
      screen = undefined;
      navEntry = undefined;
      active = false;
    }
  };
}

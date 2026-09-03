import { contextBridge, ipcRenderer } from "electron";
import {
  CHANNEL,
  type ContentKind,
  type DirectoryKey,
  type PresenceActivity,
  type PresenceStatus,
  type RuntimeState,
  type SettingsPatch
} from "../protocol.js";
import { BRIDGE_GLOBAL, type RuntimeBridge } from "../world/bridge.js";
import { applyThemes } from "./themes.js";

/** The bundled page-world runtime, inlined at build time by build.mjs. */
declare const __WORLD_SOURCE__: string;

// Antigravity's own iframes are left alone; only the top document is modified.
const isTopFrame = (() => {
  try {
    return window.top === window;
  } catch {
    return false;
  }
})();

/** The renderer console is unreachable in a packaged build. */
function report(message: string): void {
  try {
    ipcRenderer.send(CHANNEL.log, message);
  } catch {
    // Diagnostics must never break injection.
  }
}

function whenDocumentReady(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
}

/**
 * Injects the page-world runtime as early as the document allows.
 *
 * Timing is the whole point: plugins can wrap fetch, WebSocket, and other page
 * globals, and anything the application does before this runs is missed. The
 * preload is evaluated before the application's own scripts, so injecting here
 * rather than on DOMContentLoaded is what makes those hooks worth having.
 */
function injectWorldRuntime(): void {
  const inject = (): boolean => {
    const parent = document.documentElement ?? document.head;
    if (!parent) return false;
    const script = document.createElement("script");
    script.setAttribute("data-bettergravity", "runtime");
    script.textContent = __WORLD_SOURCE__;
    parent.appendChild(script);
    script.remove();
    return true;
  };

  if (inject()) return;

  // No document element yet; take the first chance the parser gives us.
  const observer = new MutationObserver(() => {
    if (inject()) observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener("readystatechange", () => void inject(), { once: true });
}

const stateListeners = new Set<(state: RuntimeState) => void>();
const presenceListeners = new Set<(status: PresenceStatus) => void>();

const bridge: RuntimeBridge = {
  getState: () => ipcRenderer.invoke(CHANNEL.getState),
  setSettings: (patch: SettingsPatch) => ipcRenderer.invoke(CHANNEL.setSettings, patch),
  openDirectory: (key: DirectoryKey) => ipcRenderer.invoke(CHANNEL.openDirectory, key),
  readStorage: () => ipcRenderer.invoke(CHANNEL.readStorage),
  writeStorage: (pluginId, key, value) => ipcRenderer.send(CHANNEL.writeStorage, pluginId, key, value),
  importThemes: () => ipcRenderer.invoke(CHANNEL.importThemes),
  importThemeFolder: () => ipcRenderer.invoke(CHANNEL.importThemeFolder),
  importPlugin: () => ipcRenderer.invoke(CHANNEL.importPlugin),
  installThemeText: (fileName, css) => ipcRenderer.invoke(CHANNEL.installThemeText, fileName, css),
  removeItem: (kind: ContentKind, id, label) => ipcRenderer.invoke(CHANNEL.removeItem, kind, id, label),
  revealItem: (kind: ContentKind, id) => ipcRenderer.invoke(CHANNEL.revealItem, kind, id),
  fetchCatalog: (force) => ipcRenderer.invoke(CHANNEL.fetchCatalog, force),
  installFromCatalog: (entry) => ipcRenderer.invoke(CHANNEL.installFromCatalog, entry),
  presenceOpen: (clientId) => ipcRenderer.invoke(CHANNEL.presenceOpen, clientId),
  presenceUpdate: (activity: PresenceActivity | undefined) => ipcRenderer.invoke(CHANNEL.presenceUpdate, activity),
  presenceClose: () => ipcRenderer.invoke(CHANNEL.presenceClose),
  onPresenceStatus: (listener) => {
    presenceListeners.add(listener);
  },
  log: (message) => report(message),
  onStateChanged: (listener) => {
    stateListeners.add(listener);
  }
};

/**
 * Themes are applied from the preload rather than the page world: they are
 * plain CSS, so they keep working even if the plugin runtime fails to boot.
 */
async function applyThemesWhenReady(): Promise<void> {
  await whenDocumentReady();
  const state = (await ipcRenderer.invoke(CHANNEL.getState).catch(() => undefined)) as RuntimeState | undefined;
  if (!state) return;

  document.documentElement.setAttribute("data-bettergravity", state.version);
  applyThemes(state.themes);
  for (const diagnostic of state.diagnostics) report(`diagnostic — ${diagnostic.source}: ${diagnostic.message}`);
}

if (isTopFrame) {
  try {
    contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, bridge);
  } catch (error) {
    report(`could not expose the runtime bridge: ${error instanceof Error ? error.message : String(error)}`);
  }

  ipcRenderer.on(CHANNEL.stateChanged, (_event, state: RuntimeState) => {
    applyThemes(state.themes);
    for (const listener of stateListeners) {
      try {
        listener(state);
      } catch (error) {
        report(`a bridge listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  ipcRenderer.on(CHANNEL.presenceStatus, (_event, status: PresenceStatus) => {
    for (const listener of presenceListeners) {
      try {
        listener(status);
      } catch (error) {
        report(`a presence listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  injectWorldRuntime();
  void applyThemesWhenReady().catch((error: unknown) =>
    report(`could not apply themes: ${error instanceof Error ? error.message : String(error)}`)
  );
}

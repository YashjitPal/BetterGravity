import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL, type DirectoryKey, type RuntimeState, type SettingsPatch } from "../protocol.js";
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
 * Plugins need Antigravity's own globals and live DOM objects, neither of which
 * survive the context bridge, so the plugin runtime is injected into the page's
 * world and talks back through the JSON-only bridge below.
 */
function injectWorldRuntime(): void {
  const script = document.createElement("script");
  script.setAttribute("data-bettergravity", "runtime");
  script.textContent = __WORLD_SOURCE__;
  (document.head ?? document.documentElement).appendChild(script);
  script.remove();
}

const stateListeners = new Set<(state: RuntimeState) => void>();

const bridge: RuntimeBridge = {
  getState: () => ipcRenderer.invoke(CHANNEL.getState),
  setSettings: (patch: SettingsPatch) => ipcRenderer.invoke(CHANNEL.setSettings, patch),
  openDirectory: (key: DirectoryKey) => ipcRenderer.invoke(CHANNEL.openDirectory, key),
  readStorage: () => ipcRenderer.invoke(CHANNEL.readStorage),
  writeStorage: (pluginId, key, value) => ipcRenderer.send(CHANNEL.writeStorage, pluginId, key, value),
  log: (message) => report(message),
  onStateChanged: (listener) => {
    stateListeners.add(listener);
  }
};

async function start(): Promise<void> {
  await whenDocumentReady();

  const state = await ipcRenderer.invoke(CHANNEL.getState).catch(() => undefined);
  document.documentElement.setAttribute("data-bettergravity", (state as RuntimeState | undefined)?.version ?? "unknown");

  // Themes are applied from here rather than from the page world: they are plain
  // CSS, so they keep working even if the plugin runtime fails to boot.
  if (state) {
    applyThemes((state as RuntimeState).themes);
    for (const diagnostic of (state as RuntimeState).diagnostics) {
      report(`diagnostic — ${diagnostic.source}: ${diagnostic.message}`);
    }
  }

  injectWorldRuntime();
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

  void start().catch((error: unknown) => report(`startup failed: ${error instanceof Error ? error.message : String(error)}`));
}

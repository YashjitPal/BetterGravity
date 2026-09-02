import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL, type DirectoryKey, type RuntimeState, type SettingsPatch } from "../protocol.js";
import { PluginHost } from "./plugins.js";
import { applyThemes } from "./themes.js";

const pluginHost = new PluginHost();
const listeners = new Set<(state: RuntimeState) => void>();
let latest: RuntimeState | undefined;

/** The renderer console is unreachable in a packaged build. */
function report(message: string): void {
  try {
    ipcRenderer.send(CHANNEL.log, message);
  } catch {
    // Diagnostics must never break injection.
  }
}

// Antigravity's own iframes are left alone; only the top document is modified.
const isTopFrame = (() => {
  try {
    return window.top === window;
  } catch {
    return false;
  }
})();

function whenDocumentReady(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
}

async function render(state: RuntimeState): Promise<void> {
  await whenDocumentReady();
  latest = state;
  document.documentElement.setAttribute("data-bettergravity", state.version);

  const applied = applyThemes(state.themes);
  const launched = pluginHost.start(state.plugins);

  report(`applied ${applied}/${state.themes.length} theme(s); started ${launched.length} plugin(s)`);
  for (const diagnostic of state.diagnostics) report(`diagnostic — ${diagnostic.source}: ${diagnostic.message}`);

  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      report(`a state listener threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const api = {
  getState: (): Promise<RuntimeState> => ipcRenderer.invoke(CHANNEL.getState),
  /** Last state delivered to this window, for synchronous reads by plugins. */
  currentState: (): RuntimeState | undefined => latest,
  setSettings: (patch: SettingsPatch): Promise<RuntimeState> => ipcRenderer.invoke(CHANNEL.setSettings, patch),
  openDirectory: (key: DirectoryKey): Promise<string> => ipcRenderer.invoke(CHANNEL.openDirectory, key),
  onStateChanged: (listener: (state: RuntimeState) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isPluginRunning: (id: string): boolean => pluginHost.isRunning(id),
  reportPluginError: (id: string, message: string): void => report(`plugin ${id} error: ${message}`)
};

export type BetterGravityRendererApi = typeof api;

if (isTopFrame) {
  try {
    contextBridge.exposeInMainWorld("BetterGravity", api);
  } catch (error) {
    report(`exposeInMainWorld failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  ipcRenderer.on(CHANNEL.stateChanged, (_event, state: RuntimeState) => void render(state));

  ipcRenderer
    .invoke(CHANNEL.getState)
    .then((state: RuntimeState) => render(state))
    .catch((error: unknown) => report(`could not load runtime state: ${error instanceof Error ? error.message : String(error)}`));
}

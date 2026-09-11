import type { BrowserPanelState, PluginBrowser } from "@bettergravity/plugin-api";
import { resolveBridge } from "./bridge.js";

const listeners = new Set<(state: BrowserPanelState) => void>();
let subscribed = false;

export function createBrowserTools(owner: string, track: (cleanup: () => void) => void): PluginBrowser {
  return {
    get available() { return typeof resolveBridge()?.browserRequest === "function"; },
    request: async (action, args = {}) => {
      const request = resolveBridge()?.browserRequest;
      if (!request) throw new Error("The browser runtime update is ready. Restart Antigravity to load it.");
      return request(owner, action, args);
    },
    setBounds: bounds => resolveBridge()?.browserBounds?.(owner, bounds),
    onStateChanged: listener => {
      if (!subscribed && resolveBridge()?.onBrowserState) {
        resolveBridge()!.onBrowserState!(state => { for (const callback of [...listeners]) callback(state); });
        subscribed = true;
      }
      listeners.add(listener);
      const remove = () => { listeners.delete(listener); };
      track(remove);
      return remove;
    }
  };
}

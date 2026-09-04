import type { PluginPresence, PresenceActivity, PresenceStatus } from "@bettergravity/plugin-api";
import { resolveBridge } from "./bridge.js";

const OFF: PresenceStatus = { phase: "off" };

/**
 * Discord's socket is a single shared resource owned by the main process, so
 * the page keeps one subscription and fans it out. The preload's listener set
 * has no removal, which is another reason to subscribe exactly once.
 */
const listeners = new Set<(status: PresenceStatus) => void>();
let latest: PresenceStatus = OFF;
let subscribed = false;

function subscribeOnce(): void {
  if (subscribed) return;
  subscribed = true;
  resolveBridge()?.onPresenceStatus((status) => {
    latest = status;
    for (const listener of [...listeners]) {
      try {
        listener(status);
      } catch {
        // A plugin's listener throwing must not stop the others being told.
      }
    }
  });
}

/**
 * Builds `plugin.presence`. Disposal disconnects, but only if this plugin was
 * the one that connected — otherwise disabling one plugin would silently take
 * down another's presence.
 */
export function createPresenceTools(track: (cleanup: () => void) => void): PluginPresence {
  subscribeOnce();
  let opened = false;

  const unavailable = (message: string): PresenceStatus => ({ phase: "unavailable", message });

  const tools: PluginPresence = {
    open: async (clientId) => {
      const bridge = resolveBridge();
      if (!bridge) return unavailable("The BetterGravity bridge is not available.");
      opened = true;
      latest = await bridge.presenceOpen(String(clientId ?? ""));
      return latest;
    },
    update: async (activity?: PresenceActivity) => {
      const bridge = resolveBridge();
      if (!bridge) return unavailable("The BetterGravity bridge is not available.");
      latest = await bridge.presenceUpdate(activity);
      return latest;
    },
    close: async () => {
      const bridge = resolveBridge();
      if (!bridge) return OFF;
      opened = false;
      latest = await bridge.presenceClose();
      return latest;
    },
    status: () => latest,
    onStatusChanged: (listener) => {
      listeners.add(listener);
      const remove = () => void listeners.delete(listener);
      track(remove);
      return remove;
    }
  };

  track(() => {
    if (!opened) return;
    opened = false;
    void resolveBridge()?.presenceClose();
  });

  return tools;
}

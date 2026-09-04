/**
 * `plugin.gemini`, which is a thin thing on purpose: the translator lives in the
 * main process because it has to be running before the page exists, so the page
 * only relays settings and reads the status back.
 *
 * Three consequences shape this file. The status is cached, because the plugin
 * API promises a synchronous `status()` and IPC cannot be synchronous. Disposal
 * removes listeners but stops nothing: the language server's endpoint was fixed
 * when it started, so tearing the translator down when a plugin is disabled
 * would take chat away until the next launch rather than restore it — the main
 * process follows the plugin list itself and forwards untranslated instead. And
 * there is nothing here about the certificate, because it is not a plugin's
 * business: the runtime installs its authority while a plugin asks for the
 * translator and removes it when none does.
 */

import type { GeminiConfig, GeminiStatus, PluginGemini } from "@bettergravity/plugin-api";
import { resolveBridge } from "./bridge.js";

const UNAVAILABLE: GeminiStatus = {
  phase: "off",
  keyed: false,
  trusted: false,
  restartRequired: false,
  counts: { translated: 0, passedThrough: 0, failed: 0 }
};

const listeners = new Set<(status: GeminiStatus) => void>();
let latest: GeminiStatus = UNAVAILABLE;
let subscribed = false;

/**
 * One subscription for the page, fanned out here. The preload's listener set has
 * no removal, so subscribing per plugin would leak a listener for every reload.
 */
function subscribeOnce(): void {
  if (subscribed) return;
  subscribed = true;

  const bridge = resolveBridge();
  if (!bridge) return;

  bridge.onGeminiStatus((status) => {
    latest = status;
    for (const listener of [...listeners]) {
      try {
        listener(status);
      } catch {
        // A plugin's listener throwing must not stop the others being told.
      }
    }
  });

  // The translator was armed before this window existed, so its current state
  // has to be asked for rather than waited for.
  void bridge
    .geminiRead()
    .then((status) => {
      latest = status;
    })
    .catch(() => {
      // Leaving `latest` as it is says "off", which is the honest answer when
      // the main process cannot be reached.
    });
}

export function createGeminiTools(track: (cleanup: () => void) => void): PluginGemini {
  subscribeOnce();

  const remember = async (request: Promise<GeminiStatus>): Promise<GeminiStatus> => {
    latest = await request;
    return latest;
  };

  return {
    configure: async (config: GeminiConfig) => {
      const bridge = resolveBridge();
      if (!bridge) return latest;
      return remember(bridge.geminiConfigure(config ?? {}));
    },
    status: () => latest,
    test: async () => {
      const bridge = resolveBridge();
      if (!bridge) return { ok: false, message: "The BetterGravity bridge is not available." };
      return bridge.geminiTest();
    },
    onStatusChanged: (listener) => {
      listeners.add(listener);
      const remove = () => void listeners.delete(listener);
      track(remove);
      return remove;
    }
  };
}

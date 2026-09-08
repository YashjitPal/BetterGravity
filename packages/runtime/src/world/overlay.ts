import type {
  OverlayBounds,
  OverlayHandle,
  OverlayScript,
  OverlayStatus,
  OverlaySurface,
  PluginOverlay
} from "@bettergravity/plugin-api";
import { resolveBridge } from "./bridge.js";

/**
 * Builds `plugin.overlay`.
 *
 * The overlay is one window shared by the whole runtime, so this file's job is
 * mostly bookkeeping around that: a single subscription to the main process fanned
 * out to every plugin, and enough ownership tracking that disabling one plugin
 * cannot close another's overlay.
 *
 * The interesting part is {@link sourceFor}. What crosses to the overlay window is
 * source rather than a function, because the two live in different renderers and
 * nothing but JSON survives the trip. A plugin therefore hands over a function
 * that is stringified here and re-evaluated there, which is why an overlay script
 * cannot close over anything: the text is all that arrives.
 */

const CLOSED: OverlayStatus = { open: false };

const statusListeners = new Set<(status: OverlayStatus) => void>();
const messageListeners = new Set<(message: unknown) => void>();
let latest: OverlayStatus = CLOSED;
let subscribed = false;

function subscribeOnce(): void {
  if (subscribed) return;
  subscribed = true;
  const bridge = resolveBridge();
  if (!bridge) return;
  bridge.onOverlayStatus((status) => {
    latest = status ?? CLOSED;
    for (const listener of [...statusListeners]) {
      try {
        listener(latest);
      } catch {
        // A plugin's listener throwing must not stop the others being told.
      }
    }
  });
  bridge.onOverlayMessage((message) => {
    for (const listener of [...messageListeners]) {
      try {
        listener(message);
      } catch {
        // As above.
      }
    }
  });
}

/**
 * The text to evaluate inside the overlay window.
 *
 * A string is taken as-is: it is already source, and rewriting it would be
 * guessing at what the author meant. A function is called with the overlay's own
 * globals, which is the form worth using — the same function can drive a pet in
 * the page and a pet on the desktop, with only `data` telling them apart.
 */
function sourceFor(script: OverlayScript, data: unknown): string {
  if (typeof script === "string") return script;
  if (typeof script !== "function") return "";
  let payload = "undefined";
  try {
    const encoded = JSON.stringify(data);
    if (encoded !== undefined) payload = encoded;
  } catch {
    // Something in `data` is not JSON. The surface is worth more than the
    // configuration, so it opens without it rather than not at all.
  }
  // Wrapped in a call rather than assigned: the overlay's document is built by
  // running this, and a bare function expression would do nothing. The trailing
  // semicolon guards against a script whose last line has none.
  return `;(${String(script)})(Overlay, ${payload});`;
}

/** A handle for a surface that never opened; `ok` is what a caller checks. */
function refused(message: string): OverlayHandle {
  return {
    ok: false,
    message,
    bounds: undefined,
    send: () => undefined,
    onMessage: () => () => undefined,
    onResize: () => () => undefined,
    close: async () => undefined
  };
}

export function createOverlayTools(pluginId: string, track: (cleanup: () => void) => void): PluginOverlay {
  subscribeOnce();
  /** Whether this plugin is the one whose surface is on screen. */
  let owning = false;

  const closeIfOwned = async (): Promise<void> => {
    if (!owning) return;
    owning = false;
    const bridge = resolveBridge();
    if (!bridge) return;
    latest = (await bridge.overlayClose(pluginId).catch(() => CLOSED)) ?? CLOSED;
  };

  const tools: PluginOverlay = {
    open: async (surface: OverlaySurface) => {
      const bridge = resolveBridge();
      if (!bridge) return refused("The BetterGravity bridge is not available.");

      const script = sourceFor(surface?.script, surface?.data);
      if (script.length === 0) return refused("An overlay needs a script or a function to run.");

      const status = await bridge
        .overlayOpen(pluginId, {
          script,
          ...(typeof surface.styles === "string" ? { styles: surface.styles } : {}),
          ...(surface.display === "primary" || surface.display === "cursor" ? { display: surface.display } : {}),
          ...(surface.interactive === true ? { interactive: true } : {})
        })
        .catch((error: unknown) => ({
          open: false,
          message: error instanceof Error ? error.message : String(error)
        }) satisfies OverlayStatus);

      latest = status ?? CLOSED;
      if (!latest.open) return refused(latest.message ?? "The overlay window could not be opened.");
      owning = true;

      const handle: OverlayHandle = {
        ok: true,
        get bounds() {
          return latest.bounds;
        },
        send: (message: unknown) => {
          // Only while this plugin owns the window: a stale handle must not be
          // able to talk to whatever replaced its surface.
          if (owning) resolveBridge()?.overlaySend(message);
        },
        onMessage: (listener: (message: unknown) => void) => {
          const wrapped = (message: unknown) => {
            if (owning) listener(message);
          };
          messageListeners.add(wrapped);
          const remove = () => void messageListeners.delete(wrapped);
          track(remove);
          return remove;
        },
        onResize: (listener: (bounds: OverlayBounds) => void) => {
          const wrapped = (status: OverlayStatus) => {
            if (owning && status.open && status.bounds) listener(status.bounds);
          };
          statusListeners.add(wrapped);
          const remove = () => void statusListeners.delete(wrapped);
          track(remove);
          return remove;
        },
        close: closeIfOwned
      };
      return handle;
    },
    status: () => latest,
    onStatusChanged: (listener) => {
      statusListeners.add(listener);
      const remove = () => void statusListeners.delete(listener);
      track(remove);
      return remove;
    }
  };

  // A plugin that is switched off should not leave a window over the desktop
  // with nothing left running to control it.
  track(() => void closeIfOwned());

  return tools;
}

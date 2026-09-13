import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL, type OverlayBounds, type OverlayStatus, type OverlaySurface } from "../protocol.js";

/**
 * The overlay window's half of the preload.
 *
 * The same preload file is registered for the whole session, so this runs in the
 * overlay exactly as it runs in an Antigravity window; `attachOverlaySurface` is
 * the branch taken when the window's argv carries the overlay marker. None of
 * the rest applies there — there is no host application to theme and no plugin
 * catalogue to host, only a blank transparent document and one script to run in
 * it.
 *
 * What that script gets is `Overlay`: the size of the screen it is covering, a
 * way to ask for pointer input while the cursor is over something it drew, and a
 * message channel back to the page that opened it.
 */

const OVERLAY_GLOBAL = "Overlay";

/** Keeps a blank document from painting the white it would otherwise default to. */
const RESET = [
  "html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent;",
  "-webkit-user-select:none;user-select:none;cursor:default}",
  "*{box-sizing:border-box}"
].join("");

interface OverlayApi {
  readonly bounds: OverlayBounds | undefined;
  setInteractive(interactive: boolean): void;
  setFocusable(focusable: boolean): void;
  focusOwner(): void;
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onResize(listener: (bounds: OverlayBounds) => void): () => void;
  close(): void;
}

export function attachOverlaySurface(): void {
  const messageListeners = new Set<(message: unknown) => void>();
  const resizeListeners = new Set<(bounds: OverlayBounds) => void>();
  let bounds: OverlayBounds | undefined;
  let interactive: boolean | undefined;
  let focusable = false;
  let started = false;

  const api: OverlayApi = {
    get bounds() {
      return bounds;
    },
    setInteractive: (next: boolean) => {
      const wanted = next === true;
      // The renderer sees far more pointer movement than the window needs to
      // change state for, so repeats are dropped here rather than in the main
      // process: an IPC message per mouse move would cost more than the work.
      if (interactive === wanted) return;
      interactive = wanted;
      ipcRenderer.send(CHANNEL.overlayInteractive, wanted);
    },
    setFocusable: (next: boolean) => {
      const wanted = next === true;
      if (focusable === wanted) return;
      focusable = wanted;
      ipcRenderer.send(CHANNEL.overlayFocusable, wanted);
    },
    focusOwner: () => {
      api.setFocusable(false);
      ipcRenderer.send(CHANNEL.overlaySend, { type: "bettergravity:overlay-focus-owner" });
    },
    send: (message: unknown) => ipcRenderer.send(CHANNEL.overlaySend, message),
    onMessage: (listener) => {
      messageListeners.add(listener);
      return () => void messageListeners.delete(listener);
    },
    onResize: (listener) => {
      resizeListeners.add(listener);
      return () => void resizeListeners.delete(listener);
    },
    close: () => ipcRenderer.send(CHANNEL.overlaySend, { type: "bettergravity:overlay-closed-itself" })
  };

  try {
    contextBridge.exposeInMainWorld(OVERLAY_GLOBAL, api);
  } catch {
    // Without the global the surface has no way to talk back, so there is
    // nothing useful left to start.
    return;
  }

  ipcRenderer.on(CHANNEL.overlayMessage, (_event, message: unknown) => {
    for (const listener of [...messageListeners]) {
      try {
        listener(message);
      } catch {
        // One surface listener throwing must not stop the others.
      }
    }
  });

  ipcRenderer.on(CHANNEL.overlayStatus, (_event, status: OverlayStatus) => {
    if (!status?.bounds) return;
    bounds = status.bounds;
    for (const listener of [...resizeListeners]) {
      try {
        listener(status.bounds);
      } catch {
        // As above.
      }
    }
  });

  ipcRenderer.on(CHANNEL.overlaySurface, (_event, surface: OverlaySurface) => {
    // The window is reused across display changes, so the surface is only ever
    // built once; later sends carry no script.
    if (started || typeof surface?.script !== "string" || surface.script.length === 0) return;
    started = true;
    bounds = {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
      scaleFactor: window.devicePixelRatio
    };

    const style = document.createElement("style");
    style.textContent = surface.styles ? `${RESET}\n${surface.styles}` : RESET;
    (document.head ?? document.documentElement).appendChild(style);

    // Appended as a script element rather than evaluated here: the surface has to
    // run in the page's own world to reach the document it is drawing into, the
    // same reason plugins do.
    const script = document.createElement("script");
    script.setAttribute("data-bettergravity", "overlay");
    script.textContent = surface.script;
    (document.body ?? document.documentElement).appendChild(script);
    script.remove();

    ipcRenderer.send(CHANNEL.overlayAttached);
  });
}

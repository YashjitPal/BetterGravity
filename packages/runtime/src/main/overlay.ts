import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, Menu, screen, type Rectangle } from "electron";
import { CHANNEL, OVERLAY_ARGUMENT, type OverlayBounds, type OverlayStatus, type OverlaySurface } from "../protocol.js";
import { windowFor } from "./host-contents.js";
import { logger } from "./logger.js";

const TRANSPARENT_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(
  "<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent!important;}</style></head><body></body></html>"
)}`;

/**
 * A window on the desktop rather than in the page.
 *
 * Everything else a plugin can reach lives inside Antigravity's own window, so
 * anything a plugin draws stops at its edges. This owns the one thing the page
 * cannot have: a transparent, frameless, always-on-top window over the whole
 * screen, which is what makes a plugin's own interface visible while the user is
 * in another application.
 *
 * The window options are deliberately the ones a desktop companion needs and
 * nothing more. It starts non-focusable; Windows also needs click focus while
 * the pointer is over an interactive surface. Only an explicit text-entry
 * request actively takes keyboard focus. `skipTaskbar` keeps it off the taskbar.
 * `setIgnoreMouseEvents(true, { forward: true })` is the important one:
 * clicks pass through to whatever is underneath, while the overlay still hears
 * `mousemove`, which is how its contents can know the pointer is over them and
 * ask for input back.
 */

/** Nothing is drawn until a plugin asks, so there is one window at most. */
interface Live {
  readonly window: BrowserWindow;
  readonly owner: string;
  readonly surface: OverlaySurface;
  attached: boolean;
  interactive: boolean;
  focusable: boolean;
  displayId?: number;
  dragging?: boolean;
}

function boundsOf(display: Electron.Display): OverlayBounds {
  const area = display.workArea;
  return { x: area.x, y: area.y, width: area.width, height: area.height, scaleFactor: display.scaleFactor };
}

function displayFor(which: OverlaySurface["display"]): Electron.Display {
  if (which !== "cursor") return screen.getPrimaryDisplay();
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    return screen.getPrimaryDisplay();
  }
}

export class OverlayWindow {
  private live: Live | undefined;

  private pointerTimer: NodeJS.Timeout | undefined;
  private attachTimer: NodeJS.Timeout | undefined;
  private contextMenu: { menu: Menu; live: Live; finish(id: string | null): void } | undefined;

  private listeners = new Set<(status: OverlayStatus) => void>();

  /** Where messages from the overlay are delivered: the page that opened it. */
  private page: Electron.WebContents | undefined;

  private metricsBound = false;

  onStatusChanged(listener: (status: OverlayStatus) => void): void {
    this.listeners.add(listener);
  }

  status(): OverlayStatus {
    const live = this.live;
    if (!live || live.window.isDestroyed()) return { open: false };
    const current = live.displayId !== undefined && typeof screen.getAllDisplays === "function"
      ? screen.getAllDisplays().find(d => d.id === live.displayId)
      : undefined;
    return { open: true, bounds: boundsOf(current ?? displayFor(live.surface.display)) };
  }

  /**
   * Opens the overlay for a plugin, replacing any window a previous call left
   * behind. One overlay at a time is a deliberate limit: several transparent
   * always-on-top windows stacked over the desktop is not a state a user can
   * reason about, and the first plugin to ask would be the one they cannot see.
   */
  open(page: Electron.WebContents, owner: string, surface: OverlaySurface): OverlayStatus {
    if (typeof surface?.script !== "string" || surface.script.length === 0) {
      return { open: false, message: "An overlay needs a script to run." };
    }

    this.close();
    this.page = page;

    const display = displayFor(surface.display);
    const area = display.workArea;

    let window: BrowserWindow;
    try {
      window = new BrowserWindow({
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        // Deliberately not Antigravity's child: a parent window drags the
        // overlay behind it when the editor is minimised, which is the one
        // moment a desktop pet should still be on screen.
        acceptFirstMouse: true,
        backgroundColor: "#00000000",
        focusable: false,
        frame: false,
        fullscreenable: false,
        hasShadow: false,
        maximizable: false,
        minimizable: false,
        movable: false,
        resizable: false,
        show: false,
        skipTaskbar: true,
        title: "BetterGravity Overlay",
        transparent: true,
        webPreferences: {
          // A throttled overlay animates at a crawl the moment Antigravity is
          // not the focused window, which is most of the time for this window.
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          preload: path.join(__dirname, "preload.cjs"),
          additionalArguments: [OVERLAY_ARGUMENT]
        }
      });
    } catch (error) {
      logger.error("The overlay window could not be created.", error);
      return { open: false, message: "This Electron build refused a transparent window." };
    }

    const live: Live = {
      window, owner, surface, attached: false,
      interactive: surface.interactive === true, focusable: false,
      displayId: display.id
    };
    this.live = live;

    if (this.attachTimer !== undefined) {
      clearTimeout(this.attachTimer);
      this.attachTimer = undefined;
    }
    const timer = setTimeout(() => {
      if (this.live === live && !live.attached) {
        logger.info(`Overlay surface script timed out before attaching for ${owner}. Closing window.`);
        this.close();
      }
    }, 3000);
    timer.unref?.();
    this.attachTimer = timer;

    // "floating" rather than "screen-saver": high enough to sit over ordinary
    // windows, low enough that a screen lock or a system dialog still wins.
    window.setAlwaysOnTop(true, "floating");
    try {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      // Not every platform has workspaces; the window is simply per-desktop.
    }
    this.applyInteractive(live);

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== "about:blank" && !url.startsWith("data:text/html") && !url.includes("overlay.html")) event.preventDefault();
    });

    window.webContents.once("dom-ready", () => {
      if (window.isDestroyed() || this.live !== live) return;
      window.webContents.send(CHANNEL.overlaySurface, surface);
      this.startPointerTracking(live);
    });

    const gone = () => {
      if (this.live === live) {
        if (this.attachTimer !== undefined) {
          clearTimeout(this.attachTimer);
          this.attachTimer = undefined;
        }
        this.stopPointerTracking();
        this.live = undefined;
        if (!live.window.isDestroyed()) live.window.destroy();
        this.announce();
      }
    };
    window.webContents.on("render-process-gone", gone);
    window.on("closed", gone);

    // Load an intrinsically transparent HTML document so Chromium never paints
    // a default opaque or dark background before the surface script executes.
    const overlayHtml = path.join(__dirname, "overlay.html");
    const loadPromise = fs.existsSync(overlayHtml)
      ? window.loadFile(overlayHtml)
      : window.loadURL(TRANSPARENT_PAGE);

    loadPromise.catch((error: unknown) => {
      logger.error("The overlay window could not load.", error);
      gone();
    });

    this.followDisplays();
    logger.info(`Overlay opened for ${owner} on ${area.width}x${area.height} at ${area.x},${area.y}.`);
    return { open: true, bounds: boundsOf(display) };
  }

  close(): OverlayStatus {
    if (this.attachTimer !== undefined) {
      clearTimeout(this.attachTimer);
      this.attachTimer = undefined;
    }
    this.closeContextMenu();
    this.stopPointerTracking();
    const live = this.live;
    this.live = undefined;
    if (live && !live.window.isDestroyed()) live.window.destroy();
    if (live) this.announce();
    return { open: false };
  }

  /** Called when the renderer acknowledges the surface script has attached. */
  attached(contents: Electron.WebContents): void {
    const live = this.live;
    if (!live || live.window.isDestroyed() || live.window.webContents.id !== contents.id) return;
    if (live.attached) return;
    live.attached = true;
    if (this.attachTimer !== undefined) {
      clearTimeout(this.attachTimer);
      this.attachTimer = undefined;
    }
    live.window.showInactive();
    this.announce();
  }

  /** True when a message came from the overlay window rather than a page. */
  isOverlay(contents: Electron.WebContents): boolean {
    const live = this.live;
    return live !== undefined && !live.window.isDestroyed() && live.window.webContents.id === contents.id;
  }

  /** True while the given plugin is the one whose overlay is on screen. */
  ownedBy(owner: string): boolean {
    return this.live?.owner === owner;
  }

  /**
   * Hands pointer input to the overlay, or gives it back to the desktop. The
   * contents call this as the pointer crosses whatever they have drawn, which is
   * the only way a window covering the whole screen can be clickable in one
   * small place and invisible to the pointer everywhere else.
   */
  setInteractive(interactive: boolean): void {
    const live = this.live;
    if (!live || live.window.isDestroyed() || live.interactive === interactive) return;
    live.interactive = interactive;
    this.applyInteractive(live);
  }

  /** Text fields need native keyboard focus as well as a focused DOM element. */
  setFocusable(focusable: boolean): void {
    const live = this.live;
    if (!live || live.window.isDestroyed() || live.focusable === focusable) return;
    live.focusable = focusable;
    this.applyFocusable(live);
    if (focusable) live.window.focus();
  }

  private applyInteractive(live: Live): void {
    if (live.interactive || this.contextMenu?.live === live) {
      live.window.setIgnoreMouseEvents(false);
    } else if (process.platform === "win32") {
      // On Windows, Electron's { forward: true } installs a low-level hook that
      // fights with underlying applications for WM_SETCURSOR, causing the cursor
      // to rapidly flicker between the default arrow and the text/pointer cursor
      // on every mouse movement (Electron issue #48035).
      // Calling setIgnoreMouseEvents(true) without forwarding completely avoids
      // the hook on Windows, while startPointerTracking() feeds cursor positions
      // via native screen.getCursorScreenPoint().
      live.window.setIgnoreMouseEvents(true);
    } else {
      live.window.setIgnoreMouseEvents(true, { forward: true });
    }
    this.applyFocusable(live);
  }

  private applyFocusable(live: Live): void {
    // A non-focusable transparent window can lose native clicks on Windows
    // while another application is foreground. Permit click focus over the
    // surface without activating it on hover. Text entry keeps focusability
    // when the pointer leaves, until the editor itself gives focus back.
    const focusable = live.focusable || this.contextMenu?.live === live || (process.platform === "win32" && live.interactive);
    if (live.window.isFocusable() !== focusable) live.window.setFocusable(focusable);
  }

  /** Recover input if Windows stops forwarding movement to a click-through window. */
  private startPointerTracking(live: Live): void {
    this.stopPointerTracking();
    let previous: { x: number; y: number; sentAt: number } | undefined;
    const sample = () => {
      if (this.live !== live || live.window.isDestroyed() || live.window.webContents.isDestroyed()) {
        clearInterval(timer);
        if (this.pointerTimer === timer) this.pointerTimer = undefined;
        return;
      }
      try {
        const cursor = screen.getCursorScreenPoint();

        // While dragging across multiple displays, hop the overlay window to the active display
        if (live.dragging && typeof screen.getDisplayNearestPoint === "function") {
          const targetDisplay = screen.getDisplayNearestPoint(cursor);
          if (targetDisplay && live.displayId !== undefined && targetDisplay.id !== live.displayId) {
            live.displayId = targetDisplay.id;
            if (typeof live.window.setBounds === "function") {
              live.window.setBounds(targetDisplay.workArea);
            }
            const bounds = boundsOf(targetDisplay);
            if (live.attached) {
              live.window.webContents.send(CHANNEL.overlayStatus, { open: true, bounds });
              live.window.webContents.send(CHANNEL.overlayMessage, {
                type: "bettergravity:overlay-display-switched",
                bounds,
                cursorX: cursor.x,
                cursorY: cursor.y
              });
            }
            this.announce();
          }
        }

        const bounds = live.window.getContentBounds();
        const zoom = live.window.webContents.getZoomFactor();
        if (!Number.isFinite(zoom) || zoom <= 0) return;
        const x = (cursor.x - bounds.x) / zoom;
        const y = (cursor.y - bounds.y) / zoom;
        const now = Date.now();
        // Normal movement is still handled by DOM events. An occasional repeat
        // also repairs lost state after focus changes with a stationary cursor.
        if (previous?.x === x && previous.y === y && now - previous.sentAt < 250) return;
        previous = { x, y, sentAt: now };
        live.window.webContents.send(CHANNEL.overlayMessage, { type: "bettergravity:overlay-pointer", x, y });
      } catch {
        // Display reconfiguration can temporarily make a native cursor read fail.
      }
    };
    const timer = setInterval(sample, 25);
    timer.unref();
    this.pointerTimer = timer;
    sample();
  }

  private stopPointerTracking(): void {
    if (this.pointerTimer !== undefined) clearInterval(this.pointerTimer);
    this.pointerTimer = undefined;
  }

  /** Page to overlay. */
  toOverlay(message: unknown): void {
    const live = this.live;
    if (!live || live.window.isDestroyed() || !live.attached) return;
    live.window.webContents.send(CHANNEL.overlayMessage, message);
  }

  /** Overlay to the page that opened it. */
  toPage(message: unknown): void {
    const page = this.page;
    if (!page || page.isDestroyed()) return;
    if (message !== null && typeof message === "object" &&
      "type" in message && message.type === "bettergravity:overlay-drag-state") {
      const live = this.live;
      if (live) {
        live.dragging = (message as { dragging?: boolean }).dragging === true;
      }
      return;
    }
    if (message !== null && typeof message === "object" &&
      "type" in message && message.type === "bettergravity:overlay-context-menu") {
      this.showContextMenu(message);
      return;
    }
    if (message !== null && typeof message === "object" &&
      "type" in message && message.type === "bettergravity:overlay-focus-owner") {
      const live = this.live;
      if (!live || live.window.isDestroyed()) return;
      const owner = windowFor(page);
      if (!owner || owner.isDestroyed() || owner === live.window) return;
      if (owner.isMinimized()) owner.restore();
      if (!owner.isVisible()) owner.show();
      owner.focus();
      page.focus();
      return;
    }
    page.send(CHANNEL.overlayMessage, message);
  }

  /** A surface can offer plain actions using the same native popup as the host. */
  private showContextMenu(request: object): void {
    const live = this.live;
    if (!live || live.window.isDestroyed() || !live.attached ||
      !("requestId" in request) || typeof request.requestId !== "string" ||
      request.requestId.length > 128 || !("items" in request) || !Array.isArray(request.items)) return;
    const requestId = request.requestId;
    const items = request.items.slice(0, 32).filter((item): item is { id: string; label: string } =>
      item !== null && typeof item === "object" && typeof item.id === "string" &&
      item.id.length > 0 && item.id.length <= 128 && typeof item.label === "string" &&
      item.label.length > 0 && item.label.length <= 200
    );
    if (items.length === 0) return;
    this.closeContextMenu();
    let settled = false;
    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      this.contextMenu = undefined;
      if (this.live !== live || live.window.isDestroyed()) return;
      this.applyInteractive(live);
      this.toOverlay({ type: "bettergravity:overlay-context-menu-result", requestId, id });
    };
    try {
      const menu = Menu.buildFromTemplate(items.map(item => ({ label: item.label, click: () => finish(item.id) })));
      this.contextMenu = { menu, live, finish };
      this.applyInteractive(live);
      menu.popup({ window: live.window, callback: () => finish(null) });
    } catch {
      finish(null);
    }
  }

  private closeContextMenu(): void {
    const popup = this.contextMenu;
    if (!popup) return;
    popup.finish(null);
    popup.menu.closePopup();
  }

  dispose(): void {
    this.close();
    this.listeners.clear();
  }

  /**
   * Screens are unplugged, resolutions change, and taskbars move. Any of those
   * leaves the overlay covering a rectangle that no longer exists, so it is
   * resized to the work area again and its contents are told the new size.
   */
  private followDisplays(): void {
    if (this.metricsBound) return;
    this.metricsBound = true;
    const resize = () => {
      const live = this.live;
      if (!live || live.window.isDestroyed()) return;
      const current = live.displayId !== undefined && typeof screen.getAllDisplays === "function"
        ? screen.getAllDisplays().find(d => d.id === live.displayId)
        : undefined;
      const display = current ?? displayFor(live.surface.display);
      const area: Rectangle = display.workArea;
      if (typeof live.window.setBounds === "function") {
        live.window.setBounds(area);
      }
      if (live.attached) live.window.webContents.send(CHANNEL.overlayStatus, this.status());
      this.announce();
    };
    screen.on("display-metrics-changed", resize);
    screen.on("display-added", resize);
    screen.on("display-removed", resize);
  }

  private announce(): void {
    const status = this.status();
    for (const listener of [...this.listeners]) {
      try {
        listener(status);
      } catch (error) {
        logger.error("An overlay status listener threw.", error);
      }
    }
  }
}

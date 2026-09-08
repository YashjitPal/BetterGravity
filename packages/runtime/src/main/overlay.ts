import { BrowserWindow, screen, type Rectangle } from "electron";
import { CHANNEL, OVERLAY_ARGUMENT, type OverlayBounds, type OverlayStatus, type OverlaySurface } from "../protocol.js";
import { logger } from "./logger.js";

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
 * nothing more. `focusable: false` keeps it out of the window cycle until the
 * surface explicitly asks for keyboard input. `skipTaskbar` keeps it off the
 * taskbar. `setIgnoreMouseEvents(true, { forward: true })` is the important one:
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
    return { open: true, bounds: boundsOf(displayFor(live.surface.display)) };
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
          additionalArguments: [OVERLAY_ARGUMENT]
        }
      });
    } catch (error) {
      logger.error("The overlay window could not be created.", error);
      return { open: false, message: "This Electron build refused a transparent window." };
    }

    const live: Live = {
      window, owner, surface, attached: false,
      interactive: surface.interactive === true, focusable: false
    };
    this.live = live;

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
    window.webContents.on("will-navigate", (event) => event.preventDefault());

    window.webContents.once("dom-ready", () => {
      if (window.isDestroyed()) return;
      live.attached = true;
      window.webContents.send(CHANNEL.overlaySurface, surface);
      window.showInactive();
      this.announce();
    });

    const gone = () => {
      if (this.live === live) {
        this.live = undefined;
        this.announce();
      }
    };
    window.webContents.on("render-process-gone", gone);
    window.on("closed", gone);

    // about:blank rather than a file: the document is the plugin's to build, and
    // a blank page carries no CSP to fight and no asset to keep in step with the
    // rest of the runtime.
    window.loadURL("about:blank").catch((error: unknown) => {
      logger.error("The overlay window could not load.", error);
      gone();
    });

    this.followDisplays();
    logger.info(`Overlay opened for ${owner} on ${area.width}x${area.height} at ${area.x},${area.y}.`);
    return { open: true, bounds: boundsOf(display) };
  }

  close(): OverlayStatus {
    const live = this.live;
    this.live = undefined;
    if (live && !live.window.isDestroyed()) live.window.destroy();
    if (live) this.announce();
    return { open: false };
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
    live.window.setFocusable(focusable);
    if (focusable) live.window.focus();
  }

  private applyInteractive(live: Live): void {
    if (live.interactive) live.window.setIgnoreMouseEvents(false);
    else live.window.setIgnoreMouseEvents(true, { forward: true });
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
    page.send(CHANNEL.overlayMessage, message);
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
      const display = displayFor(live.surface.display);
      const area: Rectangle = display.workArea;
      live.window.setBounds(area);
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

import { BaseWindow, BrowserWindow, type View, type WebContents } from "electron";

/**
 * Every open top-level window, whether a `BrowserWindow` or a bare `BaseWindow`.
 *
 * Since Antigravity 2.31, when its built-in browser is enabled, the main window
 * is a `BaseWindow` with the interface loaded into a `WebContentsView` inside
 * it. `BrowserWindow.getAllWindows()` never returns such a window, so it is
 * enumerated the way Antigravity enumerates its own: both lists, deduplicated.
 */
export function allWindows(): BaseWindow[] {
  const found: BaseWindow[] = [];
  const base = typeof BaseWindow?.getAllWindows === "function" ? BaseWindow.getAllWindows() : [];
  for (const window of [...base, ...BrowserWindow.getAllWindows()]) {
    if (window && !window.isDestroyed() && !found.includes(window)) found.push(window);
  }
  return found;
}

/**
 * The web contents a window displays: a `BrowserWindow`'s own, plus every
 * `WebContentsView` nested anywhere in the window's content view.
 */
export function windowContents(window: BaseWindow): WebContents[] {
  const found: WebContents[] = [];
  const add = (contents: WebContents | undefined): void => {
    if (contents && !contents.isDestroyed() && !found.includes(contents)) found.push(contents);
  };

  add((window as BaseWindow & { webContents?: WebContents }).webContents);
  const visit = (view: View): void => {
    add((view as View & { webContents?: WebContents }).webContents);
    for (const child of view.children ?? []) visit(child);
  };
  // `contentView` arrived with Electron 30; older hosts only have the window's own contents.
  const root = (window as BaseWindow & { contentView?: View }).contentView;
  if (root) visit(root);
  return found;
}

/** Every live web contents shown by any open window. */
export function allWindowContents(): WebContents[] {
  const found: WebContents[] = [];
  for (const window of allWindows()) {
    for (const contents of windowContents(window)) if (!found.includes(contents)) found.push(contents);
  }
  return found;
}

/** Sends a message to every page any window shows, wherever it sits in the view tree. */
export function sendToAllWindows(channel: string, ...args: unknown[]): void {
  for (const contents of allWindowContents()) contents.send(channel, ...args);
}

/**
 * The window showing `contents`. `BrowserWindow.fromWebContents` only knows a
 * `BrowserWindow`'s own contents, so a page inside a nested `WebContentsView`
 * is matched by walking each window's view tree instead.
 */
export function windowFor(contents: WebContents): BaseWindow | null {
  const direct = BrowserWindow.fromWebContents(contents);
  if (direct) return direct;
  return allWindows().find((window) => windowContents(window).includes(contents)) ?? null;
}

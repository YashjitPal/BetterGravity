import type { Session } from "electron";
import { logger } from "./logger.js";

/** Antigravity serves its UI from a language server bound to loopback. */
const HOST_ORIGIN_PREFIX = "https://127.0.0.1:";

/**
 * Antigravity 2.11 sends no CSP on its own pages, but that is an implementation
 * detail rather than a promise. Stripping the header keeps injected styles and
 * plugin scripts working if it ever starts to, scoped strictly to loopback.
 */
export function relaxContentSecurityPolicy(session: Session): void {
  let reported = false;
  session.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(HOST_ORIGIN_PREFIX)) return callback({});
    const headers = details.responseHeaders ?? {};
    const present = Object.keys(headers).filter((key) => key.toLowerCase().startsWith("content-security-policy"));
    for (const key of present) delete headers[key];
    if (!reported) {
      reported = true;
      logger.info(`First host response from ${details.url} (removed ${present.length} CSP header(s)).`);
    }
    callback({ responseHeaders: headers });
  });
}

/**
 * Antigravity ships its own Electron build, which may be older or newer than the
 * one this package is typed against, so both preload registration APIs are
 * probed at runtime rather than assumed.
 */
interface PreloadCapableSession {
  registerPreloadScript?: (script: { id: string; type: "frame"; filePath: string }) => void;
  setPreloads?: (paths: string[]) => void;
  getPreloads?: () => string[];
}

/**
 * Registers an additional preload rather than replacing the window's own, so
 * Antigravity's contextBridge APIs (electronUpdater, nativeStorage, and the
 * rest) keep working untouched.
 */
export function attachPreload(session: Session, preloadPath: string): string {
  const capable = session as unknown as PreloadCapableSession;
  if (typeof capable.registerPreloadScript === "function") {
    capable.registerPreloadScript({ id: "bettergravity", type: "frame", filePath: preloadPath });
    return "registerPreloadScript";
  }
  if (typeof capable.setPreloads === "function" && typeof capable.getPreloads === "function") {
    capable.setPreloads([...capable.getPreloads(), preloadPath]);
    return "setPreloads";
  }
  throw new Error("This Electron build exposes no way to register an additional preload.");
}

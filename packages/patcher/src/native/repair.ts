import { fs } from "./fs.js";
import type { InstallationKind } from "../types.js";
import { inspectInstallation, runOperation, type HostController } from "./index.js";
import { antigravityProcessIds } from "./process.js";
import { installationPaths } from "./paths.js";

/**
 * Standalone guardian that reapplies the patch after Antigravity updates itself.
 *
 * Antigravity uses electron-updater, which replaces app.asar during the install
 * that runs once the application has quit. Nothing of BetterGravity is loaded at
 * that point, because the bootstrap it lived in was the file that got replaced.
 * So the runtime spawns this detached before quitting: it waits for Antigravity
 * to exit, watches for the bundle to come back unpatched, and repatches it.
 *
 * Doing nothing is always an acceptable outcome. If no update arrives, this
 * exits quietly and the installation is untouched.
 */

export interface GuardianOptions {
  readonly installationPath: string;
  /** How long to wait for Antigravity to close before giving up. */
  readonly exitTimeoutMs?: number;
  /** How long to watch for an update to land once Antigravity has closed. */
  readonly watchTimeoutMs?: number;
  /**
   * How long to keep waiting for a quiet moment once the patch is known to be
   * gone. Much longer than the watch above, because by then there is something
   * definite to put back and the only thing in the way is a running editor.
   */
  readonly repatchTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  /** Used once waiting on the user rather than on an update. */
  readonly idlePollIntervalMs?: number;
  readonly log?: (message: string) => void;
  /** Overridden in tests, which have no real Antigravity to watch. */
  readonly isHostRunning?: (installationPath: string) => boolean;
  readonly closeHost?: HostController;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type GuardianOutcome =
  | { readonly kind: "already-patched" }
  | { readonly kind: "repatched"; readonly version: string | undefined }
  | { readonly kind: "host-still-running" }
  | { readonly kind: "no-update"; }
  | { readonly kind: "failed"; readonly reason: string };

const defaults = {
  exitTimeoutMs: 5 * 60_000,
  watchTimeoutMs: 10 * 60_000,
  // Long enough to cover an ordinary working session, since the alternative is
  // leaving the user unpatched until they think to run the installer.
  repatchTimeoutMs: 4 * 60 * 60_000,
  pollIntervalMs: 3_000,
  idlePollIntervalMs: 15_000
};

export async function guard(options: GuardianOptions): Promise<GuardianOutcome> {
  const {
    installationPath,
    exitTimeoutMs = defaults.exitTimeoutMs,
    watchTimeoutMs = defaults.watchTimeoutMs,
    repatchTimeoutMs = defaults.repatchTimeoutMs,
    pollIntervalMs = defaults.pollIntervalMs,
    idlePollIntervalMs = defaults.idlePollIntervalMs,
    log = () => undefined,
    // The guardian is itself an Antigravity.exe process, so it must not count
    // itself as the application it is waiting on.
    isHostRunning = (target: string) => antigravityProcessIds(target, [process.pid]).length > 0,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  } = options;

  const exitDeadline = now() + exitTimeoutMs;
  while (isHostRunning(installationPath)) {
    if (now() >= exitDeadline) {
      log("Antigravity is still running; leaving the installation alone.");
      return { kind: "host-still-running" };
    }
    await sleep(pollIntervalMs);
  }

  const watchDeadline = now() + watchTimeoutMs;
  /** Set the moment the patch is confirmed gone, which buys the longer wait. */
  let repatchDeadline: number | undefined;
  let waitingAnnounced = false;

  const settled = (kind: InstallationKind): GuardianOutcome =>
    kind === "patched" ? { kind: "already-patched" } : { kind: "no-update" };

  for (;;) {
    const state = inspectInstallation(installationPath);
    const needsRepatch = state.kind === "needs-repatch" && state.nativePatchAvailable;

    if (needsRepatch && repatchDeadline === undefined) {
      repatchDeadline = now() + repatchTimeoutMs;
      log(`Antigravity ${state.antigravityVersion} replaced the patch.`);
    }

    const running = isHostRunning(installationPath);

    if (needsRepatch && !running) {
      log("Reapplying.");
      try {
        const runtimeSource = installationPaths(installationPath).runtimeCode;
        await runOperation("update", installationPath, {
          runtimeSource,
          ...(options.closeHost ? { closeHost: options.closeHost } : {})
        });
        log("Reapplied successfully.");
        return { kind: "repatched", version: state.antigravityVersion };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(`Could not reapply: ${reason}`);
        if (error instanceof Error && error.stack) log(error.stack);
        return { kind: "failed", reason };
      }
    }

    // Nothing to put back, and Antigravity is up again: whatever this was
    // watching for is not going to happen now.
    if (!needsRepatch && running) {
      log("Antigravity started again; stopping.");
      return settled(state.kind);
    }

    if (needsRepatch) {
      // Antigravity's updater relaunches the application once it has replaced
      // the bundle, so finding it running again is the normal end of an update
      // rather than a reason to stop. Closing it would fight the user, so this
      // waits for them to close it themselves.
      if (now() >= (repatchDeadline ?? 0)) {
        log("Antigravity is still running; leaving the installation alone.");
        return { kind: "host-still-running" };
      }
      if (!waitingAnnounced) {
        log("Antigravity is running again; waiting for it to close before reapplying.");
        waitingAnnounced = true;
      }
      await sleep(Math.max(pollIntervalMs, idlePollIntervalMs));
      continue;
    }

    if (now() >= watchDeadline) return settled(state.kind);

    await sleep(pollIntervalMs);
  }
}

/** Entry point used when this file is run as a script by the runtime. */
export async function main(argv: readonly string[]): Promise<number> {
  const installationPath = argv[0];
  const logFile = argv[1];
  if (!installationPath) {
    console.error("Usage: repair.cjs <installationPath> [logFile]");
    return 2;
  }

  const log = (message: string) => {
    const line = `[${new Date().toISOString()}] guardian: ${message}\n`;
    if (!logFile) return;
    try {
      fs.appendFileSync(logFile, line);
    } catch {
      // A guardian that cannot log is still a useful guardian.
    }
  };

  try {
    const outcome = await guard({ installationPath, log });
    return outcome.kind === "failed" ? 1 : 0;
  } catch (error) {
    log(`unexpected failure: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}


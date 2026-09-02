import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.js";

/**
 * Antigravity updates itself with electron-updater, which replaces app.asar
 * during an install that runs only after the application has quit. By then
 * BetterGravity is gone, because the bootstrap it lived in was the file that
 * got replaced, so nothing inside Antigravity can put it back.
 *
 * The answer is to hand the job to a process that outlives the application:
 * before quitting, spawn a detached guardian that waits for Antigravity to
 * exit, watches for the bundle to come back unpatched, and reapplies the patch.
 */
export function spawnGuardian(runtimeCodeDirectory: string, logFile: string): boolean {
  const script = path.join(runtimeCodeDirectory, "repair.cjs");
  if (!fs.existsSync(script)) {
    logger.error(`The update guardian is missing at ${script}.`);
    return false;
  }

  // resources/.bettergravity/runtime -> the installation root.
  const installationPath = path.resolve(runtimeCodeDirectory, "..", "..", "..");

  try {
    const child = spawn(process.execPath, [script, installationPath, logFile], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // Runs the Electron binary as a plain Node process, which is how the
      // guardian gets a runtime without Antigravity needing to be installed.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    });
    child.unref();
    logger.info(`Update guardian started for ${installationPath}.`);
    return true;
  } catch (error) {
    logger.error("Could not start the update guardian.", error);
    return false;
  }
}

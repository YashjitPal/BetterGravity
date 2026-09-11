import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ProgressReporter } from "../types.js";

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 250;

/**
 * Process IDs for Antigravity instances running out of a specific install, so a
 * second installation elsewhere on the machine is never touched.
 *
 * `exclude` matters more than it looks: the update guardian runs the Antigravity
 * binary as a plain Node process, so without excluding itself it would wait
 * forever for a process that is never going to exit.
 */
export function antigravityProcessIds(installationPath: string, exclude: readonly number[] = []): readonly number[] {
  if (process.platform === "win32") {
    const escaped = installationPath.replaceAll("'", "''");
    const script = `Get-CimInstance Win32_Process -Filter "Name='Antigravity.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${escaped}', [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty ProcessId`;
    try {
      const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true });
      return parseProcessIds(output, exclude);
    } catch {
      return [];
    }
  }

  if (process.platform === "darwin") {
    try {
      const output = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
      return parseDarwinProcessIds(output, installationPath, exclude);
    } catch {
      return [];
    }
  }

  return [];
}

/** Split out from the lookup above so the parsing and exclusion are testable. */
export function parseProcessIds(output: string, exclude: readonly number[] = []): readonly number[] {
  return output
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((id) => Number.isInteger(id) && id > 0 && !exclude.includes(id));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parses `ps -eo pid=,args=` output on macOS, matching processes belonging to the target installation. */
export function parseDarwinProcessIds(output: string, installationPath: string, exclude: readonly number[] = []): readonly number[] {
  const target = installationPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const targetRegex = new RegExp(`(?:^|[\\s"'])${escapeRegex(target)}(?:[\\s/"']|$)`);
  const results: number[] = [];

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, rawPid, commandLine] = match;
    if (!rawPid || !commandLine) continue;

    const pid = Number(rawPid);
    if (!Number.isInteger(pid) || pid <= 0 || exclude.includes(pid)) continue;

    const commandLower = commandLine.replace(/\\/g, "/").toLowerCase();
    if (targetRegex.test(commandLower) && commandLower.includes("antigravity")) {
      results.push(pid);
    }
  }

  return results;
}

function terminate(processId: number, force: boolean): void {
  if (process.platform === "win32") {
    const args = ["/PID", String(processId), "/T"];
    if (force) args.push("/F");
    try {
      execFileSync("taskkill.exe", args, { windowsHide: true, stdio: "ignore" });
    } catch {
      // The process may have already exited between listing and termination.
    }
    return;
  }

  try {
    process.kill(processId, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // The process may have already exited between listing and termination.
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks Antigravity to close, escalating to a forced kill only if it refuses.
 * Never terminates the calling process, which matters when the caller is the
 * update guardian running under the Antigravity binary.
 */
export async function closeAntigravity(installationPath: string, onProgress: ProgressReporter): Promise<void> {
  const running = () => antigravityProcessIds(installationPath, [process.pid]);
  if (running().length === 0) return;
  onProgress({ percent: 8, stage: "inspect", message: "Closing Antigravity safely…" });

  for (const processId of running()) terminate(processId, false);

  const deadline = Date.now() + GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (running().length === 0) return;
    await delay(POLL_INTERVAL_MS);
  }
  for (const processId of running()) terminate(processId, true);
  if (running().length > 0) {
    const manager = process.platform === "darwin" ? "Activity Monitor" : "Task Manager";
    throw new Error(`Antigravity could not be closed automatically. Close it from ${manager} and try again.`);
  }
}

import { execFileSync } from "node:child_process";
import type { ProgressReporter } from "../types.js";

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 250;

/**
 * Process IDs for Antigravity instances running out of a specific install, so a
 * second installation elsewhere on the machine is never touched.
 */
export function antigravityProcessIds(installationPath: string): readonly number[] {
  if (process.platform !== "win32") return [];
  const escaped = installationPath.replaceAll("'", "''");
  const script = `Get-CimInstance Win32_Process -Filter "Name='Antigravity.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${escaped}', [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty ProcessId`;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true });
    return output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

function terminate(processId: number, force: boolean): void {
  const args = ["/PID", String(processId), "/T"];
  if (force) args.push("/F");
  try {
    execFileSync("taskkill.exe", args, { windowsHide: true, stdio: "ignore" });
  } catch {
    // The process may have already exited between listing and termination.
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks Antigravity to close, escalating to a forced kill only if it refuses. */
export async function closeAntigravity(installationPath: string, onProgress: ProgressReporter): Promise<void> {
  if (antigravityProcessIds(installationPath).length === 0) return;
  onProgress({ percent: 8, stage: "inspect", message: "Closing Antigravity safely…" });

  for (const processId of antigravityProcessIds(installationPath)) terminate(processId, false);

  const deadline = Date.now() + GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (antigravityProcessIds(installationPath).length === 0) return;
    await delay(POLL_INTERVAL_MS);
  }

  for (const processId of antigravityProcessIds(installationPath)) terminate(processId, true);
  if (antigravityProcessIds(installationPath).length > 0) {
    throw new Error("Antigravity could not be closed automatically. Close it from Task Manager and try again.");
  }
}

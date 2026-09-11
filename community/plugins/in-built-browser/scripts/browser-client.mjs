import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCodexBrowserClient } from "../vendor/codex-browser-client.mjs";

/** Codex's actual browser client, using the enabled BetterGravity transport. */
export async function setupBrowserRuntime(options = {}) {
  const descriptorFile = options.bridgeFile ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), ".config"), "BetterGravity", "browser", "bridge.json");
  const apiManifest = JSON.parse(await fs.readFile(new URL("../vendor/api.json", import.meta.url), "utf8"));
  const disabledMemberIds = new Set(["ContentAPI.exportGsuite", "ContentAPI.exportYouTubeTranscript", "PlaywrightFileChooser.setFiles", "PlaywrightFileChooser.isMultiple"]);
  async function executeAgentCommand({ type, client_timeout_ms, ...args }) {
    let descriptor;
    try { descriptor = JSON.parse(await fs.readFile(descriptorFile, "utf8")); }
    catch { throw new Error("In Built Browser is disabled or Antigravity is not running."); }
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(descriptor.url) || !/^[a-f\d]{64}$/.test(descriptor.token)) throw new Error("Invalid browser bridge descriptor.");
    // Re-read on every call. A client kept alive after disable has no authority.
    const response = await fetch(`${descriptor.url}/command`, { method: "POST", headers: { Authorization: `Bearer ${descriptor.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command: type, args }), signal: AbortSignal.timeout(Math.min(Math.max(client_timeout_ms ?? 120_000, 1000), 120_000)) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error ?? "The browser command failed.");
    return result.value;
  }
  return createCodexBrowserClient({ apiManifest, disabledMemberIds, executeAgentCommand,
    displayBridge: { displayImage: options.displayImage ?? (() => {}), displayValue: options.displayValue ?? (() => {}) } });
}

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const [command, json = "{}"] = process.argv.slice(2);
if (!command) throw new Error('Usage: node run-action.mjs list_browsers "{}"');
const file = path.join(process.env.APPDATA ?? path.join(os.homedir(), ".config"), "BetterGravity", "browser", "bridge.json");
const descriptor = JSON.parse(await fs.readFile(file, "utf8").catch(() => { throw new Error("Enable In Built Browser in BetterGravity first."); }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(descriptor.url) || !/^[a-f\d]{64}$/.test(descriptor.token)) throw new Error("Invalid browser bridge descriptor.");
const response = await fetch(`${descriptor.url}/command`, { method: "POST", headers: { Authorization: `Bearer ${descriptor.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ command, args: JSON.parse(json) }), signal: AbortSignal.timeout(120_000) });
const result = await response.json();
if (!response.ok) throw new Error(result.error ?? "Browser command failed.");
process.stdout.write(JSON.stringify(result.value, null, 2) + "\n");

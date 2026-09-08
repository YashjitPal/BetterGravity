// A raw CDP pipe for one-off diagnosis: sends a sequence of commands on one
// socket and prints every reply and event it sees.
//
//   node scripts/dev-cdp.mjs '[["Debugger.enable"],["Runtime.evaluate",{"expression":"1+1","returnByValue":true}]]'
//
// Each command gets its own id; the socket closes when the last reply lands or
// after the timeout, whichever comes first.
import { readFileSync } from "node:fs";
import path from "node:path";

let port = 9333;
try {
  const active = readFileSync(path.join(process.env["APPDATA"] ?? "", "Antigravity", "DevToolsActivePort"), "utf8");
  const parsed = parseInt(active.split("\n")[0].trim(), 10);
  if (parsed > 0) port = parsed;
} catch {}

const commands = JSON.parse(process.argv[2] ?? "[]");
const waitMs = Number(process.argv[3] ?? 12_000);

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === "page" && String(target.url).startsWith("https://127.0.0.1:"));
if (!page) throw new Error("no page target");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
});

let outstanding = commands.length;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id !== undefined) {
    outstanding -= 1;
    console.log(`<- reply ${message.id}`, JSON.stringify(message.error ?? message.result).slice(0, 600));
    if (outstanding <= 0) setTimeout(() => process.exit(0), 250);
    return;
  }
  console.log(`<- event ${message.method}`, JSON.stringify(message.params ?? {}).slice(0, 400));
});

commands.forEach(([method, params], index) => {
  console.log(`-> ${index + 1} ${method}`);
  socket.send(JSON.stringify({ id: index + 1, method, params: params ?? {} }));
});

setTimeout(() => {
  console.log(`(timed out after ${waitMs}ms with ${outstanding} reply/replies outstanding)`);
  process.exit(outstanding > 0 ? 2 : 0);
}, waitMs);

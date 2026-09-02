// Talks to a running Antigravity over the Chrome DevTools Protocol so the
// injected UI can be inspected without fighting the Windows foreground lock.
//
//   node scripts/dev-inspect.mjs launch          restart Antigravity with a debug port
//   node scripts/dev-inspect.mjs shot [file]     screenshot the renderer
//   node scripts/dev-inspect.mjs eval "<expr>"   evaluate an expression in the page
//
// Antigravity always enables remote debugging (main.js appends the switch when
// it is absent), so `launch` only pins it to a predictable port.

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const PORT = 9333;
const HOST_URL_PREFIX = "https://127.0.0.1:";
const executable = path.join(
  process.env["LOCALAPPDATA"] ?? "",
  "Programs",
  "Antigravity",
  "Antigravity.exe"
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
  return response.json();
}

/** Waits for the window showing Antigravity's real UI, not the loading overlay. */
async function waitForPage(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not reachable yet";
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets();
      const page = targets.find((target) => target.type === "page" && String(target.url).startsWith(HOST_URL_PREFIX));
      if (page) return page;
      lastError = `no page on ${HOST_URL_PREFIX}* yet (${targets.length} target(s))`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for the Antigravity page: ${lastError}`);
}

async function send(webSocketUrl, method, params = {}) {
  const socket = new WebSocket(webSocketUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not open the DevTools socket.")), { once: true });
    });

    const id = 1;
    const reply = new Promise((resolve, reject) => {
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      setTimeout(() => reject(new Error(`${method} timed out.`)), 30_000);
    });

    socket.send(JSON.stringify({ id, method, params }));
    return await reply;
  } finally {
    socket.close();
  }
}

const [command = "shot", argument] = process.argv.slice(2);

if (command === "launch") {
  spawn(executable, [`--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore" }).unref();
  console.log(`Launching Antigravity with remote debugging on ${PORT}…`);
  const page = await waitForPage();
  console.log(`Ready: ${page.url}`);
} else if (command === "shot") {
  const page = await waitForPage(20_000);
  const result = await send(page.webSocketDebuggerUrl, "Page.captureScreenshot", { format: "png" });
  const file = argument ?? "antigravity.png";
  await writeFile(file, Buffer.from(result.data, "base64"));
  console.log(`Saved ${file}`);
} else if (command === "eval") {
  if (!argument) {
    console.error('Provide an expression, for example: eval "document.title"');
    process.exit(1);
  }
  const page = await waitForPage(20_000);
  const result = await send(page.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression: argument,
    returnByValue: true,
    awaitPromise: true
  });
  console.log(JSON.stringify(result.result?.value ?? result.result, null, 2));
} else {
  console.error(`Unknown command "${command}". Use launch, shot, or eval.`);
  process.exit(1);
}

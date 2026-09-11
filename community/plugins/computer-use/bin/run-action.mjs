import http from "node:http";
import { ComputerUseToolRegistry } from "file:///C:/Users/Yashjit 2/AppData/Roaming/BetterGravity/plugins/computer-use/tools/index.js";

function notifyBridge(type, data) {
  try {
    const req = http.request({
      hostname: "127.0.0.1",
      port: 51829,
      path: "/event",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeout: 300,
    });
    req.on("error", () => {});
    req.write(JSON.stringify({ type, ...data }));
    req.end();
  } catch {}
}

async function main() {
  const args = process.argv.slice(2);
  const toolName = args[0];
  if (!toolName) {
    process.stderr.write("Usage: node run-action.mjs <toolName> [jsonArgs]\n");
    process.exit(1);
  }

  let toolArgs = {};
  if (args[1]) {
    try {
      toolArgs = JSON.parse(args[1]);
    } catch {
      toolArgs = {};
    }
  }

  notifyBridge("tool_start", { toolName, args: toolArgs });

  try {
    const registry = new ComputerUseToolRegistry();
    const result = await registry.executeTool(toolName, toolArgs);
    notifyBridge("tool_complete", { toolName, args: toolArgs, result });
    process.stdout.write(typeof result === "string" ? result : JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    notifyBridge("tool_complete", { toolName, args: toolArgs, error: err.message });
    process.stderr.write(JSON.stringify({ error: err.message }) + "\n");
    process.exit(1);
  }
}

main();

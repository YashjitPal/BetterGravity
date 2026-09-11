/**
 * Windows Helper Transport
 * Communicates with the native Windows binary (`codex-computer-use.exe`)
 * Extracted from main-g2764IDy.js & src-CLzQUgbV.js
 */

import { spawn } from "node:child_process";
import readline from "node:readline";

export class WindowsHelperTransport {
  constructor({
    helperCommand,
    helperArgs = [],
    helperEnv = {},
    preserveHelperOnTimeout = true,
  }) {
    this.helperCommand = helperCommand;
    this.helperArgs = helperArgs;
    this.helperEnv = helperEnv;
    this.preserveHelperOnTimeout = preserveHelperOnTimeout;

    this.child = null;
    this.rl = null;
    this.pendingRequests = new Map();
    this.eventListeners = new Set();
    this.exitListeners = new Set();
    this.requestId = 1;
    this.isClosed = false;

    if (this.helperCommand) {
      this.spawnHelper();
    }
  }

  /**
   * Spawn native Windows helper process with parent PID linkage
   */
  spawnHelper() {
    if (this.isClosed || !this.helperCommand) return;

    const args = [
      ...this.helperArgs,
      "--parent-pid",
      String(process.pid),
    ];

    try {
      this.child = spawn(this.helperCommand, args, {
        env: {
          ...process.env,
          ...this.helperEnv,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      this.rl = readline.createInterface({
        input: this.child.stdout,
        crlfDelay: Infinity,
      });

      this.rl.on("line", (line) => {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          this.handleIncomingLine(trimmed);
        }
      });

      this.child.on("exit", (code, signal) => {
        this.child = null;
        this.rl = null;
        for (const listener of this.exitListeners) {
          listener({ code, signal });
        }
      });

      this.child.on("error", () => {
        // Handled silently
      });
    } catch {
      this.child = null;
    }
  }

  /**
   * Handle incoming JSON-RPC line from codex-computer-use.exe
   */
  handleIncomingLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // Check if event notification
    if (msg.event || msg.method === "event") {
      const payload = msg.params ?? msg;
      for (const listener of this.eventListeners) {
        listener(payload);
      }
      return;
    }

    // Response to a pending request
    if (msg.id != null && this.pendingRequests.has(msg.id)) {
      const { resolve, reject, timeoutId } = this.pendingRequests.get(msg.id);
      clearTimeout(timeoutId);
      this.pendingRequests.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message || "Windows helper error"));
      } else {
        resolve(msg.result);
      }
    }
  }

  /**
   * Send JSON-RPC request to codex-computer-use.exe
   */
  async request(method, params = {}, { timeoutMs = 15000, signal = null } = {}) {
    signal?.throwIfAborted();

    if (!this.child && this.helperCommand) {
      this.spawnHelper();
    }

    // If running in standalone mock mode (no native binary available on disk)
    if (!this.child) {
      return this.mockResponse(method, params);
    }

    const id = this.requestId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(new Error("Request aborted"));
      };

      signal?.addEventListener("abort", abortHandler, { once: true });

      const timeoutId = setTimeout(() => {
        signal?.removeEventListener("abort", abortHandler);
        this.pendingRequests.delete(id);
        reject(new Error(`Windows helper request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (val) => {
          signal?.removeEventListener("abort", abortHandler);
          resolve(val);
        },
        reject: (err) => {
          signal?.removeEventListener("abort", abortHandler);
          reject(err);
        },
        timeoutId,
      });

      this.child.stdin.write(payload + "\n");
    });
  }

  /**
   * Standalone fallback when running outside the packaged Windows client
   */
  mockResponse(method, params) {
    switch (method) {
      case "get_appshot_target":
        return {
          id: 1,
          app: "process:notepad.exe",
          displayName: "Notepad",
          frame: { x: 100, y: 100, width: 800, height: 600 },
          title: "Untitled - Notepad",
        };
      case "list_apps":
        return [
          { id: "process:notepad.exe", displayName: "Notepad", windows: [{ id: 1, title: "Untitled - Notepad" }] },
          { id: "process:calc.exe", displayName: "Calculator", windows: [{ id: 2, title: "Calculator" }] },
          { id: "process:excel.exe", displayName: "Microsoft Excel", windows: [{ id: 3, title: "Book1 - Excel" }] },
          { id: "process:msedge.exe", displayName: "Microsoft Edge", windows: [{ id: 4, title: "New Tab - Edge" }] },
        ];
      case "load_appshot_capture_source":
      case "complete_appshot_capture":
        return {
          screenshots: [
            { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }
          ],
          accessibility: {
            tree: `[Window: "${params.window?.title || "Active Window"}"] [Role: UIA_WindowControlTypeId]\n  [Edit: "Text Editor", Role: UIA_EditControlTypeId, Value: ""]\n  [Button: "File", Role: UIA_MenuItemControlTypeId]`,
          },
          transitionSnapshotURL: null,
        };
      default:
        return { status: "success", method, params };
    }
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async close() {
    this.isClosed = true;
    for (const [id, req] of this.pendingRequests) {
      clearTimeout(req.timeoutId);
      req.reject(new Error("Windows helper transport closed"));
    }
    this.pendingRequests.clear();

    if (this.child) {
      try {
        this.child.kill();
      } catch {}
      this.child = null;
    }
  }
}

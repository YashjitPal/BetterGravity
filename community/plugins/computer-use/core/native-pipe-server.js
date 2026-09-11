/**
 * Codex Computer Use Native Named Pipe Server
 * Extracted from main-g2764IDy.js (lines 2080-2340)
 */

import net from "node:net";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { AppApprovalManager } from "./approval-manager.js";
import { ComputerUseToolRegistry } from "../tools/index.js";

export class ComputerUseNativePipeServer {
  constructor({
    pipePath = null,
    approvalManager = null,
    toolRegistry = null,
    onAnalyticsEvent = null,
  } = {}) {
    this.pipePath = pipePath || this.generateDefaultPipePath();
    this.approvalManager = approvalManager || new AppApprovalManager();
    this.toolRegistry = toolRegistry || new ComputerUseToolRegistry();
    this.onAnalyticsEvent = onAnalyticsEvent;
    this.server = null;
    this.activeSockets = new Set();
    this.activeTurnBySocket = new Map();
    this.isDisposed = false;
  }

  /**
   * Generate default named pipe path (Windows) or domain socket (macOS/Linux)
   */
  generateDefaultPipePath() {
    const id = crypto.randomUUID();
    if (process.platform === "win32") {
      return `\\\\.\\pipe\\codex-computer-use-${id}`;
    }
    return path.join(os.tmpdir(), `codex-computer-use-${id}.sock`);
  }

  /**
   * Start listening for connections
   */
  async start() {
    if (this.server) return this.pipePath;

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on("error", (err) => {
        if (!this.isDisposed) {
          reject(err);
        }
      });

      this.server.listen(this.pipePath, () => {
        this.onAnalyticsEvent?.({
          type: "server-launched",
          pipePath: this.pipePath,
          transport: "native_pipe",
        });
        resolve(this.pipePath);
      });
    });
  }

  /**
   * Handle an incoming connection
   */
  handleConnection(socket) {
    this.activeSockets.add(socket);
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let boundaryIndex;
      while ((boundaryIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + 1);
        if (line.length > 0) {
          this.handleIncomingLine(socket, line);
        }
      }
    });

    socket.on("close", () => {
      this.activeSockets.delete(socket);
      this.activeTurnBySocket.delete(socket);
      if (this.activeSockets.size === 0) {
        this.onLastSocketClosed();
      }
    });

    socket.on("error", (err) => {
      this.onAnalyticsEvent?.({ type: "socket-error", error: err.message });
    });
  }

  /**
   * Parse and dispatch a JSON-RPC 2.0 message
   */
  async handleIncomingLine(socket, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return this.sendResponse(socket, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }

    const { id, method, params } = message;

    // 1. Ping
    if (method === "ping") {
      return this.sendResponse(socket, { jsonrpc: "2.0", id, result: "pong" });
    }

    // 2. Close connection
    if (method === "close") {
      this.activeTurnBySocket.delete(socket);
      this.sendResponse(socket, { jsonrpc: "2.0", id, result: null });
      socket.end();
      return;
    }

    // 3. Request (Tool execution)
    if (method === "request") {
      await this.handleToolRequest(socket, id, params);
      return;
    }

    // Unsupported method
    this.sendResponse(socket, {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }

  /**
   * Process tool execution request with security approval
   */
  async handleToolRequest(socket, id, params) {
    const startTime = Date.now();
    const toolMethod = params?.method;
    const toolArgs = params?.params || {};
    const turnMetadata = params?.codexTurnMetadata;

    let terminalStatus = "failed";

    try {
      // Check app approval security policy
      const targetApp = toolArgs.app || toolArgs.targetAppName || toolArgs.appName;
      const appId = typeof targetApp === "object" ? (targetApp.bundleId || targetApp.bundleIdentifier || targetApp.name) : targetApp;
      const appName = typeof targetApp === "object" ? (targetApp.displayName || targetApp.name) : targetApp;

      if (appId) {
        await this.approvalManager.requestApproval({
          appName: appName || appId,
          appId,
          toolName: toolMethod,
        });
      }

      // Execute tool via registry
      const result = await this.toolRegistry.executeTool(toolMethod, toolArgs);
      terminalStatus = "completed";

      this.sendResponse(socket, {
        jsonrpc: "2.0",
        id,
        result,
      });
    } catch (err) {
      this.sendResponse(socket, {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      const durationMs = Date.now() - startTime;
      this.onAnalyticsEvent?.({
        type: "tool-called",
        toolName: toolMethod,
        terminalStatus,
        durationMs,
        turnMetadata,
      });
    }
  }

  /**
   * Send JSON-RPC response over socket
   */
  sendResponse(socket, payload) {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(payload) + "\n");
    }
  }

  onLastSocketClosed() {
    this.onAnalyticsEvent?.({ type: "last-socket-closed" });
  }

  /**
   * Stop server and clean up
   */
  async dispose() {
    this.isDisposed = true;
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();
    this.activeTurnBySocket.clear();

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
  }
}

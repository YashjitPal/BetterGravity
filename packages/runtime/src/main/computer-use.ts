import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { RuntimeSettings } from "../protocol.js";

const MAX_JSON_BYTES = 64 * 1024;
const HTTP_PORT = 51829;
const HTTP_HOST = "127.0.0.1";

export interface ComputerUseEvent {
  type: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  timestamp?: number;
  [key: string]: unknown;
}

function readJson(file: string): Record<string, unknown> {
  if (fs.statSync(file).size > MAX_JSON_BYTES) throw new Error("Config file is too large.");
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object.");
  return value as Record<string, unknown>;
}

function writeJson(file: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

/** Owns the native skills, MCP server registrations, and HTTP bridge for the Computer Use plugin. */
export class ComputerUseService {
  readonly pluginsDirectory: string;
  readonly homeDirectory: string;
  readonly skillDirectory: string;
  readonly mcpServerScript: string;
  readonly skillsConfig: string;
  readonly mcpConfig: string;
  readonly port: number;

  private enabled = false;
  private problem: string | undefined;
  private server: http.Server | undefined;
  private sseClients = new Set<http.ServerResponse>();
  private eventQueue: ComputerUseEvent[] = [];
  private readonly maxEventQueue = 100;
  private readonly eventListeners = new Set<(event: ComputerUseEvent) => void>();
  private nextEventId = 1;

  constructor(plugins: string, home: string, port = HTTP_PORT) {
    this.pluginsDirectory = plugins;
    this.homeDirectory = home;
    this.port = port;
    this.skillDirectory = path.join(plugins, "computer-use", "skills");
    this.mcpServerScript = path.join(plugins, "computer-use", "mcp-server.cjs");
    this.skillsConfig = path.join(home, ".gemini", "config", "skills.json");
    this.mcpConfig = path.join(home, ".gemini", "config", "mcp_config.json");
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get lastProblem(): string | undefined {
    return this.problem;
  }

  get isServerListening(): boolean {
    return this.server?.listening === true;
  }

  onEvent(listener: (event: ComputerUseEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  sync(settings: RuntimeSettings): void {
    const wanted = settings.plugins.developerMode && settings.plugins.enabled.includes("computer-use");
    this.enabled = wanted;
    this.problem = undefined;

    try {
      this.syncSkills(wanted);
    } catch (error) {
      this.problem = error instanceof Error ? error.message : String(error);
    }

    try {
      this.syncMcp(wanted);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.problem = this.problem ? `${this.problem}; ${msg}` : msg;
    }

    if (wanted) {
      this.startServer();
    } else {
      this.stopServer();
    }
  }

  private syncSkills(wanted: boolean): void {
    const skillMd = path.join(this.skillDirectory, "computer-use", "SKILL.md");
    if (wanted && !fs.existsSync(skillMd)) {
      throw new Error("The Computer Use skill is missing. Reinstall computer-use.");
    }

    let config: Record<string, unknown> = {};
    if (fs.existsSync(this.skillsConfig)) {
      try {
        config = readJson(this.skillsConfig);
      } catch {
        throw new Error("skills.json is invalid; left unchanged.");
      }
    }

    if (config["entries"] !== undefined && !Array.isArray(config["entries"])) {
      throw new Error("skills.json has an invalid entries list; left unchanged.");
    }

    const entries = (config["entries"] ?? []) as unknown[];
    const ours = (entry: unknown) =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>)["path"] === "string" &&
      path.resolve((entry as { path: string }).path) === path.resolve(this.skillDirectory);

    const next = entries.filter((entry) => !ours(entry));
    if (wanted) {
      next.push({ path: this.skillDirectory });
    }

    if (JSON.stringify(next) !== JSON.stringify(entries)) {
      writeJson(this.skillsConfig, { ...config, entries: next });
    }
  }

  private syncMcp(wanted: boolean): void {
    if (wanted && !fs.existsSync(this.mcpServerScript)) {
      throw new Error("The Computer Use MCP server script is missing. Reinstall computer-use.");
    }

    let config: Record<string, unknown> = {};
    if (fs.existsSync(this.mcpConfig)) {
      try {
        config = readJson(this.mcpConfig);
      } catch {
        throw new Error("mcp_config.json is invalid; left unchanged.");
      }
    }

    if (
      config["mcpServers"] !== undefined &&
      (typeof config["mcpServers"] !== "object" || Array.isArray(config["mcpServers"]) || config["mcpServers"] === null)
    ) {
      throw new Error("mcp_config.json has invalid mcpServers; left unchanged.");
    }

    const mcpServers = { ...(config["mcpServers"] as Record<string, unknown> | undefined) };
    const existed = "computer-use" in mcpServers;

    if (wanted) {
      mcpServers["computer-use"] = {
        command: "node",
        args: [this.mcpServerScript]
      };
    } else if (existed) {
      delete mcpServers["computer-use"];
    }

    if (wanted || existed) {
      writeJson(this.mcpConfig, { ...config, mcpServers });
    }
  }

  private startServer(): void {
    if (this.server) return;
    try {
      this.server = http.createServer((req, res) => {
        const corsHeaders: Record<string, string> = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Accept",
        };

        if (req.method === "OPTIONS") {
          res.writeHead(204, corsHeaders);
          res.end();
          return;
        }

        if (req.method === "POST" && (req.url === "/event" || req.url === "/events")) {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });
          req.on("end", () => {
            try {
              const event = JSON.parse(body) as ComputerUseEvent;
              event.id = event.id ?? this.nextEventId++;
              event.timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();
              this.eventQueue.push(event);
              if (this.eventQueue.length > this.maxEventQueue) {
                this.eventQueue.shift();
              }
              const sseData = `data: ${JSON.stringify(event)}\n\n`;
              for (const client of this.sseClients) {
                try {
                  client.write(sseData);
                } catch {
                  this.sseClients.delete(client);
                }
              }
              for (const listener of this.eventListeners) {
                try {
                  listener(event);
                } catch {}
              }
              res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }

        if (req.method === "GET" && (req.url === "/events" || req.url === "/events/stream")) {
          res.writeHead(200, {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(": connected\n\n");
          this.sseClients.add(res);
          req.on("close", () => {
            this.sseClients.delete(res);
          });
          return;
        }

        if (req.method === "GET" && (req.url === "/poll" || req.url === "/event")) {
          const events = [...this.eventQueue];
          this.eventQueue = [];
          res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify(events));
          return;
        }

        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "computer-use", clients: this.sseClients.size }));
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EADDRINUSE") {
          this.problem = err.message;
        }
      });

      this.server.listen(this.port, HTTP_HOST);
    } catch (error) {
      this.problem = error instanceof Error ? error.message : String(error);
    }
  }

  private stopServer(): void {
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {}
    }
    this.sseClients.clear();
    this.eventQueue = [];
    if (this.server) {
      try {
        this.server.close();
      } catch {}
      this.server = undefined;
    }
  }

  dispose(): void {
    this.enabled = false;
    this.stopServer();
    this.eventListeners.clear();
  }
}

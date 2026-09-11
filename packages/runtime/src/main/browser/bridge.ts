import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

export interface BrowserBridgeTarget {
  isEnabled: boolean;
  tools(): unknown[];
  execute(command: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Authenticated loopback transport. Web pages cannot call it through CORS. */
export class BrowserHttpBridge {
  private server: http.Server | undefined;
  readonly token = randomBytes(32).toString("hex");
  private readonly sockets = new Set<import("node:net").Socket>();

  constructor(private readonly target: BrowserBridgeTarget) {}

  start(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const respond = (status: number, value: unknown) => {
          if (response.destroyed) return;
          response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
          response.end(JSON.stringify(value));
        };
        const auth = Buffer.from(request.headers.authorization ?? "");
        const expected = Buffer.from(`Bearer ${this.token}`);
        const host = request.headers.host ?? "";
        if (request.headers.origin || !/^127\.0\.0\.1:\d+$/.test(host) || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
          respond(403, { error: "Browser bridge access denied." });
          return;
        }
        if (!this.target.isEnabled) { respond(410, { error: "In Built Browser is disabled." }); return; }
        if (request.method === "GET" && request.url === "/tools") { respond(200, { tools: this.target.tools() }); return; }
        if (request.method === "GET" && request.url === "/status") { respond(200, { enabled: true }); return; }
        if (request.method !== "POST" || request.url !== "/command") { respond(404, { error: "Unknown browser endpoint." }); return; }
        let bytes = 0;
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) { respond(413, { error: "Browser command is too large." }); request.destroy(); }
          else chunks.push(chunk);
        });
        request.on("error", () => { /* A disconnected caller has no response channel. */ });
        request.on("end", () => {
          let body: { command?: unknown; args?: unknown };
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof body;
            if (!body || typeof body.command !== "string" || !body.args || typeof body.args !== "object" || Array.isArray(body.args)) throw new Error();
          } catch { respond(400, { error: "Expected a command and argument object." }); return; }
          void this.target.execute(body.command as string, body.args as Record<string, unknown>)
            .then(value => respond(200, { value }), error => respond(400, { error: error instanceof Error ? error.message : String(error) }));
        });
      });
      this.server = server;
      server.requestTimeout = 65_000;
      server.headersTimeout = 10_000;
      server.on("connection", socket => { this.sockets.add(socket); socket.once("close", () => this.sockets.delete(socket)); });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") { reject(new Error("Browser bridge failed to bind.")); return; }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }

  dispose(): void {
    this.server?.close();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server = undefined;
  }
}

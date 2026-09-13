import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPatcher } from "../src/world/hooks/patcher.js";
import type { FetchMiddleware } from "../src/world/hooks/net.js";

const source = readFileSync("community/plugins/yolo/index.js", "utf8");
const ORIGIN = "https://127.0.0.1:51785";
const SERVICE = "/exa.language_server_pb.LanguageServerService/";
const POLICY = {
  autoAllowAllInteractions: true, autoInteractionBehavior: 1,
  runCommand: { autoCommandConfig: { autoExecutionPolicy: 3 } },
  antigravityBrowser: { autoRunDecision: 1, browserJsAutoRunPolicy: 3, browserJsExecutionPolicy: 4, skipPermissionChecks: true },
  notifyUser: { artifactReviewMode: 2 }
};

// Serialized by Antigravity 2.12.2's own SendUserCascadeMessage descriptor.
const NATIVE_BINARY = Buffer.from("ChN5b2xvLW5hdGl2ZS1maXh0dXJlKioKKGomQgJ4AdICHxobEgxmaXh0dXJlLW9ubHkaC3JlYWRfdXJsKCopKAGqAQtuYXRpdmUtdGVzdLoBCXVuY2hhbmdlZA==", "base64");

class TestSocket {
  readonly sent: unknown[] = [];
  constructor(readonly url = "wss://127.0.0.1:51785/connect-websocket") {}
  send(data: unknown): void { this.sent.push(data); }
}

let middleware: FetchMiddleware | undefined;
let schema: any;
let cleanups: (() => void)[];

function start() {
  new Function("plugin", source)({
    settings: { define: (value: unknown) => { schema = value; } },
    patcher: createPatcher(cleanup => cleanups.push(cleanup)),
    net: { onFetch: (handler: FetchMiddleware) => {
      middleware = handler;
      cleanups.push(() => { middleware = undefined; });
    } },
    onDispose: (cleanup: () => void) => cleanups.push(cleanup)
  });
}

function stop() { while (cleanups.length) cleanups.pop()!(); }

function request(body: unknown = { cascadeConfig: {} }, method = "SendUserCascadeMessage", type = "application/json", origin = ORIGIN) {
  return new Request(origin + SERVICE + method, {
    method: "POST", headers: { "content-type": type, "x-codeium-csrf-token": "test-only", "connect-protocol-version": "1" },
    body: body instanceof Uint8Array ? new Uint8Array(body) : typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function outgoing(input: Request): Promise<Request> {
  let captured!: Request;
  const next = vi.fn(async (value: Request) => { captured = value; return new Response("{}"); });
  if (middleware) await middleware(input, next); else await next(input);
  expect(next).toHaveBeenCalledTimes(1);
  return captured;
}

function frame(bytes: Uint8Array, flags = 0): Uint8Array {
  const result = new Uint8Array(5 + bytes.length);
  result[0] = flags;
  new DataView(result.buffer).setUint32(1, bytes.length);
  result.set(bytes, 5);
  return result;
}

// A test-only protobuf reader; BigInt keeps unknown 64-bit fields exact.
function fields(bytes: Uint8Array): Map<number, (Uint8Array | bigint)[]> {
  let offset = 0;
  const result = new Map<number, (Uint8Array | bigint)[]>();
  const read = () => {
    let value = 0n, shift = 0n;
    for (;;) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new Error("Truncated fixture");
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) return value;
      shift += 7n;
    }
  };
  while (offset < bytes.length) {
    const tag = Number(read()), number = tag >>> 3, wire = tag & 7;
    let value: Uint8Array | bigint;
    if (!wire) value = read();
    else {
      const length = wire === 2 ? Number(read()) : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (length < 0 || offset + length > bytes.length) throw new Error("Invalid fixture");
      value = new Uint8Array(bytes.subarray(offset, offset + length)); offset += length;
    }
    result.set(number, [...result.get(number) ?? [], value]);
  }
  return result;
}

function nested(bytes: Uint8Array, ...path: number[]): Uint8Array {
  for (const number of path) {
    const value = fields(bytes).get(number)?.at(-1);
    if (!(value instanceof Uint8Array)) throw new Error(`Missing message ${number}`);
    bytes = value;
  }
  return bytes;
}

function expectBinaryPolicy(bytes: Uint8Array) {
  const tools = nested(bytes, 5, 1, 13);
  expect(fields(tools).get(46)).toEqual([1n]);
  expect(fields(tools).get(53)).toEqual([1n]);
  expect(fields(nested(tools, 8, 3)).get(6)).toEqual([3n]);
  expect(fields(nested(tools, 8)).get(15)).toEqual([1n]); // existing sandbox setting
  expect(fields(nested(tools, 25)).get(25)).toEqual([1n]);
  expect(fields(nested(tools, 33)).get(1)).toEqual([2n]);
  expect(nested(tools, 42)).toEqual(nested(NATIVE_BINARY, 5, 1, 13, 42));
}

beforeEach(() => {
  cleanups = []; middleware = undefined; schema = undefined;
  vi.stubGlobal("location", { origin: ORIGIN });
  vi.stubGlobal("WebSocket", TestSocket);
});

afterEach(() => { stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("YOLO native execution policy", () => {
  it("sets policy before the transport runs and preserves content, managed grants, and model configuration", async () => {
    start();
    const input = {
      cascadeId: "conversation", items: [{ text: 'Write-Output "$(unchanged)"' }], images: [{ data: "AAEC/w==" }],
      cascadeConfig: { plannerConfig: {
        requestedModel: "fixture-model", toolConfig: {
          runCommand: { enableTerminalSandbox: true, cwd: "C:/project" },
          permissionConfig: { enterpriseConfig: { sentinel: "managed" }, defaultGrants: { ask: ["read_url(*)"], deny: ["fixture"] }, permissionsV2: true }
        }
      }, executorConfig: { sentinel: "preserve" } }
    };
    const original = request(input);
    const sent = await outgoing(original);
    const decoded = await sent.json();
    expect(decoded.cascadeConfig.plannerConfig.toolConfig).toMatchObject(POLICY);
    expect(decoded.cascadeConfig.plannerConfig.toolConfig).toMatchObject(input.cascadeConfig.plannerConfig.toolConfig);
    expect(decoded.items).toEqual(input.items);
    expect(decoded.images).toEqual(input.images);
    expect(decoded.cascadeConfig.plannerConfig.requestedModel).toBe("fixture-model");
    expect(decoded.cascadeConfig.executorConfig).toEqual(input.cascadeConfig.executorConfig);
    expect(await original.json()).toEqual(input);
    expect(schema.status.read()).toContain("1 execution request configured");
  });

  it.each([
    ["SendUserCascadeMessage", "cascadeConfig"], ["SendAllQueuedMessages", "cascadeConfig"],
    ["RevertToCascadeStep", "overrideConfig"], ["ReplayGroundTruthTrajectory", "cascadeConfig"]
  ])("configures %s and preserves requests that reuse their server configuration", async (method, key) => {
    start();
    const sent = await (await outgoing(request({ cascadeId: "chat", [key!]: {} }, method))).json();
    expect(sent[key!].plannerConfig.toolConfig).toEqual(POLICY);
    const absent = request({ cascadeId: "chat" }, method);
    expect(await outgoing(absent)).toBe(absent);
  });

  it.each([
    ["StartCascade", "customAgentSpec"], ["StartCascade", "agentScriptItem"],
    ["SetOrVerifyStaticConfig", "customAgentSpec"], ["ForkConversation", "agentScriptOverride"],
    ["SendUserCascadeMessage", "customAgentSpec"]
  ])("configures existing %s %s without creating an optional agent", async (method, key) => {
    start();
    const sent = await (await outgoing(request({ [key!]: { name: "unchanged", cascadeConfig: {} } }, method))).json();
    expect(sent[key!]).toMatchObject({ name: "unchanged", cascadeConfig: { plannerConfig: { toolConfig: POLICY } } });
    const absent = await (await outgoing(request({}, method))).json();
    expect(absent[key!]).toBeUndefined();
  });

  it("covers every battle-mode request and nested agent specification", async () => {
    start();
    const sent = await (await outgoing(request({
      request: { cascadeId: "legacy", cascadeConfig: {} }, requests: [{ cascadeId: "first", cascadeConfig: {} }, { cascadeId: "second", cascadeConfig: {}, customAgentSpec: { cascadeConfig: {} } }],
      agentScripts: [{ name: "agent", cascadeConfig: {} }], models: [1, 2], numForks: 2
    }, "StartBattleMode"))).json();
    for (const item of [sent.request, ...sent.requests, sent.requests[1].customAgentSpec, ...sent.agentScripts]) {
      expect(item.cascadeConfig.plannerConfig.toolConfig).toEqual(POLICY);
    }
    expect(sent.models).toEqual([1, 2]);
    expect(sent.requests.map((item: any) => item.cascadeId)).toEqual(["first", "second"]);
    const detected = await (await outgoing(request({ userMessage: { cascadeId: "trigger", cascadeConfig: {} } }, "DetectBattleModeAutoTrigger"))).json();
    expect(detected.userMessage.cascadeConfig.plannerConfig.toolConfig).toEqual(POLICY);
  });

  it.each(["configPath", "commandSpec", "pythonSpec"])("preserves an agent's %s source without inserting another oneof choice", async sourceKey => {
    start();
    const input = { agentScriptItem: { name: "external agent", [sourceKey]: sourceKey === "configPath" ? { configPathUri: "file:///fixture/agent.yaml" } : {} } };
    const original = request(input, "StartCascade");
    expect(await outgoing(original)).toBe(original);
    expect(await original.json()).toEqual(input);
  });

  it("handles an inline custom configuration inside an agent script", async () => {
    start();
    const sent = await (await outgoing(request({ agentScriptItem: { config: { cascadeConfig: {}, skipMcpPrefixes: true } } }, "StartCascade"))).json();
    expect(sent.agentScriptItem.cascadeConfig).toBeUndefined();
    expect(sent.agentScriptItem.config.cascadeConfig.plannerConfig.toolConfig).toEqual(POLICY);
    expect(sent.agentScriptItem.config.skipMcpPrefixes).toBe(true);
  });

  it("supports protobuf JSON snake_case and remains idempotent", async () => {
    start();
    const sent = await (await outgoing(request({ cascade_config: { planner_config: { tool_config: { auto_allow_all_interactions: false } } } }))).json();
    expect(sent.cascadeConfig).toBeUndefined();
    expect(sent.cascade_config.planner_config.tool_config.auto_allow_all_interactions).toBe(true);
    const again = await (await outgoing(request(sent))).json();
    expect(again).toEqual(sent);
  });

  it("retains authentication, abort propagation, credentials, and fetch options", async () => {
    start();
    const controller = new AbortController();
    const original = new Request(request(), { signal: controller.signal, credentials: "include", redirect: "error", cache: "no-store" });
    const sent = await outgoing(original);
    expect([...sent.headers]).toEqual([...original.headers]);
    expect([sent.credentials, sent.redirect, sent.cache]).toEqual(["include", "error", "no-store"]);
    controller.abort();
    expect(sent.signal.aborted).toBe(true);
  });

  it("never retries a message after the network rejects it", async () => {
    start();
    const next = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(middleware!(request(), next)).rejects.toThrow("offline");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not retry a synchronous transport failure during disposal", async () => {
    start();
    const next = vi.fn(() => { throw new Error("transport failed"); });
    const pending = middleware!(request(), next);
    stop();
    await expect(pending).rejects.toThrow("transport failed");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["GetUserStatus", ORIGIN], ["HandleCascadeUserInteraction", ORIGIN], ["UpdateCustomization", ORIGIN],
    ["SendUserCascadeMessage", "https://example.com"], ["SendUserCascadeMessage", "https://127.0.0.1:51786"]
  ])("leaves %s at %s untouched", async (method, origin) => {
    start();
    const original = request({}, method, "application/json", origin);
    expect(await outgoing(original)).toBe(original);
  });

  it("rewrites native protobuf without discarding unknown fields or existing grants", async () => {
    start();
    // Unknown field 100: uint64 max, 101: fixed32, 102: fixed64.
    const unknown = Buffer.from("a006ffffffffffffffffff01ad0678563412b1060123456789abcdef", "hex");
    const sent = await outgoing(request(Buffer.concat([NATIVE_BINARY, unknown]), undefined, "application/proto"));
    const bytes = new Uint8Array(await sent.arrayBuffer());
    expectBinaryPolicy(bytes);
    for (const number of [1, 21, 23]) expect(fields(bytes).get(number)).toEqual(fields(NATIVE_BINARY).get(number));
    for (const [number, values] of fields(unknown)) expect(fields(bytes).get(number)).toEqual(values);
    const again = new Uint8Array(await (await outgoing(request(bytes, undefined, "application/proto"))).arrayBuffer());
    expect(again).toEqual(bytes);
  });

  it.each(["application/connect+proto", "application/grpc-web+proto", "application/connect+json", "application/grpc-web+json"])("updates %s frame lengths and keeps trailers intact", async type => {
    start();
    const json = type.endsWith("+json");
    const trailer = frame(new TextEncoder().encode('{}'), type.includes("grpc") ? 128 : 2);
    const original = Buffer.concat([frame(json ? new TextEncoder().encode('{"cascadeConfig":{}}') : NATIVE_BINARY), trailer]);
    const bytes = new Uint8Array(await (await outgoing(request(original, undefined, type))).arrayBuffer());
    const length = new DataView(bytes.buffer).getUint32(1);
    expect(bytes.slice(5 + length)).toEqual(trailer);
    if (json) expect(JSON.parse(new TextDecoder().decode(bytes.slice(5, 5 + length))).cascadeConfig.plannerConfig.toolConfig).toEqual(POLICY);
    else expectBinaryPolicy(bytes.slice(5, 5 + length));
  });

  it.each([
    ["{broken", "application/json"], ["null", "application/json"],
    ['{"cascadeConfig":{"plannerConfig":42}}', "application/json"],
    ['{"cascadeConfig":{},"cascade_config":{}}', "application/json"],
    [new Uint8Array([42, 255]), "application/proto"], [new Uint8Array([42, 5, 1]), "application/proto"],
    [frame(NATIVE_BINARY, 1), "application/connect+proto"], [new Uint8Array([0, 0, 0]), "application/connect+proto"],
    ["opaque", "application/octet-stream"]
  ])("preserves unsupported input %# without consuming it or blocking the request", async (body, type) => {
    start();
    const original = request(body, undefined, type as string);
    expect(await outgoing(original)).toBe(original);
    expect(original.bodyUsed).toBe(false);
    expect(schema.status.read()).toContain("normal policy");
  });

  it("does not rewrite compressed HTTP payloads", async () => {
    start();
    const original = request(); original.headers.set("content-encoding", "gzip");
    expect(await outgoing(original)).toBe(original);
  });

  it("configures an existing WebSocket before send and preserves envelope metadata", () => {
    const socket = new TestSocket(); // opened before the plugin starts
    start();
    const envelope = { streamId: "stream", type: "start", procedure: SERVICE + "SendUserCascadeMessage", stream: false,
      headers: { "x-codeium-csrf-token": "fixture" }, payload: { cascadeId: "chat", cascadeConfig: {} } };
    socket.send(JSON.stringify(envelope));
    const sent = JSON.parse(socket.sent[0] as string);
    expect(sent.payload.cascadeConfig.plannerConfig.toolConfig).toEqual(POLICY);
    expect({ ...sent, payload: undefined }).toEqual({ ...envelope, payload: undefined });
    expect(envelope.payload).toEqual({ cascadeId: "chat", cascadeConfig: {} });
  });

  it("leaves WebSocket cancellations, unrelated procedures, malformed data and foreign sockets unchanged", () => {
    start();
    const socket = new TestSocket();
    for (const data of ["invalid", JSON.stringify({ type: "cancel", streamId: 1 }), JSON.stringify({ type: "start", procedure: SERVICE + "HandleCascadeUserInteraction", payload: {} }), new Uint8Array([1])]) {
      socket.send(data); expect(socket.sent.at(-1)).toBe(data);
    }
    for (const url of ["wss://example.com/connect-websocket", "wss://127.0.0.1:51785/other"]) {
      const other = new TestSocket(url);
      const data = JSON.stringify({ type: "start", procedure: SERVICE + "SendUserCascadeMessage", payload: {} });
      other.send(data); expect(other.sent[0]).toBe(data);
    }
  });

  it("restores both transports on disable, including requests still being read", async () => {
    const originalSend = TestSocket.prototype.send;
    start();
    const original = request();
    const pending = outgoing(original);
    stop();
    expect(await pending).toBe(original);
    expect(TestSocket.prototype.send).toBe(originalSend);
    expect(middleware).toBeUndefined();
    expect(await outgoing(request())).toBeInstanceOf(Request);
    start();
    expect((await (await outgoing(request())).json()).cascadeConfig.plannerConfig.toolConfig).toEqual(POLICY);
  });
});

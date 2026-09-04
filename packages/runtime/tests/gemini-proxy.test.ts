/**
 * The listener end to end: what arrives on the loopback port, where the proxy
 * sends it, and what comes back. The translation is covered on its own in
 * `gemini-translate.test.ts` and the log in `gemini-audit.test.ts`; this is the
 * transport around both.
 *
 * `node:https` is mocked so an outbound request lands on a local stand-in for
 * Google instead of on Google, while `createServer` stays real: the listener
 * under test is a genuine TLS server, reached over the network.
 */

import fs from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { RequestOptions } from "node:https";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLog } from "../src/main/gemini/audit.js";
import { certificateFiles, loadOrMint } from "../src/main/gemini/certificate.js";
import { GeminiProxy, probeKey, type ProxySettings } from "../src/main/gemini/proxy.js";
import {
  CATALOG_PATH_PREFIX,
  CCPA_HOST,
  CHAT_PATH_PREFIX,
  GOOGLE_BASE,
  ModelRegistry,
  PUBLIC_HOST,
  parseBaseUrl,
  readEventData,
  splitEvents
} from "../src/main/gemini/translate.js";

/** Where a redirected outbound request goes. Read inside the mock factory. */
const redirect = vi.hoisted(() => ({ port: 0 }));

vi.mock("node:https", async () => {
  const actual = await vi.importActual<typeof import("node:https")>("node:https");
  const request = (options: RequestOptions) =>
    actual.request({
      ...options,
      host: "127.0.0.1",
      port: redirect.port,
      rejectUnauthorized: false,
      // The name the proxy meant to reach, so the stand-in can say which of
      // Google's two hosts a request was addressed to.
      headers: { ...options.headers, "x-intended-host": options.host ?? "" }
    });
  const patched = { ...actual, request };
  return { ...patched, default: patched };
});
const realHttps = await vi.importActual<typeof import("node:https")>("node:https");

interface UpstreamCall {
  /** The host the proxy meant to reach, whatever it was redirected to. */
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

interface UpstreamAnswer {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer;
}

const SHARED = fs.mkdtempSync(path.join(os.tmpdir(), "bettergravity-proxy-"));
/** Minting is the slow part, so the listener and the stand-in share one authority. */
const MATERIAL = loadOrMint(certificateFiles(SHARED));

/** What the key serves, answered on any test's behalf unless it says otherwise. */
const MODELS_LIST = JSON.stringify({
  models: [
    { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.1-pro-preview", supportedGenerationMethods: ["generateContent"] }
  ]
});

/** Antigravity's own catalogue, with the Gemini model's quota reported spent. */
const CATALOG = JSON.stringify({
  models: {
    "gemini-3-flash-agent": {
      model: "MODEL_PLACEHOLDER_M84",
      displayName: "Gemini 3.5 Flash (Low)",
      apiProvider: "API_PROVIDER_GOOGLE_GEMINI",
      quotaInfo: { remainingFraction: 0 }
    }
  }
});

/** Two events as the public API sends them: the answer, then the terminator. */
const SSE = `${[
  'data: {"candidates":[{"index":0,"content":{"role":"model","parts":[{"text":"the answer"}]}}],"usageMetadata":{"promptTokenCount":4,"totalTokenCount":9}}',
  'data: {"candidates":[{"index":0,"finishReason":"STOP"}]}'
].join("\r\n\r\n")}\r\n\r\n`;

/** Synthetic: long enough to be redacted, short enough to be obviously fake. */
const KEY = "AIzaSyB1cD3fGh4jKl5mN6oPqRsTuV";
const EDITOR = { authorization: "Bearer subscription-token", "content-type": "application/json" };
const calls: UpstreamCall[] = [];
/** What the stand-in answers next. `undefined` falls back to the model list. */
let answer: (call: UpstreamCall) => UpstreamAnswer | undefined = () => undefined;

const header = (headers: IncomingHttpHeaders, name: string): string | undefined => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Google, or near enough: it records what it was asked and answers to order. */
const google = realHttps.createServer(
  { cert: MATERIAL.chainPem, key: MATERIAL.keyPem },
  (request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const call: UpstreamCall = {
        host: header(request.headers, "x-intended-host") ?? "",
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8")
      };
      calls.push(call);
      const listing = call.path.startsWith("/v1beta/models?") ? { body: MODELS_LIST } : {};
      const reply: UpstreamAnswer = answer(call) ?? listing;
      const body =
        typeof reply.body === "string" ? Buffer.from(reply.body, "utf8") : (reply.body ?? Buffer.from("{}", "utf8"));
      response.writeHead(reply.status ?? 200, {
        "content-type": "application/json",
        ...(reply.headers ?? {}),
        "content-length": String(body.byteLength)
      });
      response.end(body);
    })();
  }
);

await new Promise<void>((resolve) => void google.listen(0, "127.0.0.1", resolve));
const GOOGLE_PORT = (google.address() as AddressInfo).port;

/** A port nothing is listening on, for the tests about Google being out of reach. */
async function closedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => void probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}
const proxies: GeminiProxy[] = [];

interface Harness {
  readonly proxy: GeminiProxy;
  readonly port: number;
  readonly registry: ModelRegistry;
  readonly audit: AuditLog;
  /** How many times the panel has been told there is something new to read. */
  activity(): number;
}

/** A listening proxy on the shared material, with the settings a test asks for. */
async function listening(
  options: Partial<ProxySettings> = {},
  registry: ModelRegistry = new ModelRegistry()
): Promise<Harness> {
  const settings: ProxySettings = {
    apiKey: options.apiKey ?? "",
    base: options.base ?? GOOGLE_BASE,
    stream: options.stream ?? true,
    thoughts: options.thoughts ?? false,
    bypass: options.bypass ?? false
  };
  const audit = new AuditLog();
  let activity = 0;
  const proxy = new GeminiProxy({
    material: MATERIAL,
    registry,
    audit,
    settings: () => settings,
    onActivity: () => void (activity += 1)
  });
  proxies.push(proxy);
  return { proxy, port: await proxy.listen(), registry, audit, activity: () => activity };
}

interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly raw: Buffer;
  readonly text: string;
}

interface Ask {
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Record<string, string>;
}
/** One request to the listener, the way the language server would make it. */
function ask(port: number, target: string, options: Ask = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = options.body ?? "";
    const request = realHttps.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: target,
        agent: false,
        rejectUnauthorized: false,
        headers: {
          ...(body === "" ? {} : { "content-length": String(Buffer.byteLength(body)) }),
          ...(options.headers ?? {})
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => void chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const raw = Buffer.concat(chunks);
          resolve({ status: response.statusCode ?? 0, headers: response.headers, raw, text: raw.toString("utf8") });
        });
      }
    );
    request.on("error", reject);
    if (body !== "") request.write(body);
    request.end();
  });
}

/** A chat as Antigravity sends one: the request it wants, inside its own envelope. */
const chatBody = (modelEnum: string, prompt = "hello"): string =>
  JSON.stringify({
    model: "gemini-pro-agent",
    request: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      labels: { model_enum: modelEnum },
      sessionId: "session-1"
    }
  });

/** The events the editor was handed, unwrapped. */
const eventsIn = (reply: Reply): readonly Record<string, unknown>[] =>
  splitEvents(reply.raw).events.flatMap((event) => [...readEventData(event)]);
beforeEach(() => {
  calls.length = 0;
  answer = () => undefined;
  redirect.port = GOOGLE_PORT;
});

afterEach(async () => {
  while (proxies.length > 0) await proxies.pop()?.close();
});

afterAll(async () => {
  realHttps.globalAgent.destroy();
  await new Promise<void>((resolve) => {
    google.close(() => resolve());
    google.closeAllConnections();
  });
  fs.rmSync(SHARED, { recursive: true, force: true });
});

describe("forwarding what it cannot translate", () => {
  it("sends what is not a chat to Cloud Code, on the editor's own token", async () => {
    const { port, proxy, activity } = await listening({ apiKey: KEY });
    answer = () => ({ body: JSON.stringify({ ok: true }) });

    const reply = await ask(port, "/v1internal:getUserStatus", { method: "POST", body: "{}", headers: EDITOR });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ host: CCPA_HOST, method: "POST", path: "/v1internal:getUserStatus" });
    // Google answers on its own name and not on the loopback address the
    // language server addressed, and the subscription pays for this one.
    expect(calls[0]?.headers["host"]).toBe(CCPA_HOST);
    expect(calls[0]?.headers["authorization"]).toBe("Bearer subscription-token");
    expect(proxy.counts).toEqual({ translated: 0, passedThrough: 1, failed: 0 });
    expect(activity()).toBe(1);
  });

  it("forwards a compressed body byte for byte, encoding and all", async () => {
    const { port } = await listening();
    const packed = zlib.gzipSync(Buffer.from(JSON.stringify({ ok: true }), "utf8"));
    answer = () => ({ headers: { "content-encoding": "gzip" }, body: packed });

    const reply = await ask(port, "/v1internal:getUserStatus", { method: "POST", body: "{}", headers: EDITOR });

    expect(reply.headers["content-encoding"]).toBe("gzip");
    expect(reply.raw.equals(packed)).toBe(true);
  });

  it("leaves a chat alone while no key is set", async () => {
    const { port, proxy } = await listening();

    await ask(port, `${CHAT_PATH_PREFIX}?alt=sse`, {
      method: "POST",
      body: chatBody("MODEL_PLACEHOLDER_M16"),
      headers: EDITOR
    });

    expect(calls[0]).toMatchObject({ host: CCPA_HOST, path: `${CHAT_PATH_PREFIX}?alt=sse` });
    expect(proxy.counts).toEqual({ translated: 0, passedThrough: 1, failed: 0 });
  });

  it("leaves a chat alone while the comparison switch is on", async () => {
    const { port } = await listening({ apiKey: KEY, bypass: true });

    await ask(port, CHAT_PATH_PREFIX, { method: "POST", body: chatBody("MODEL_PLACEHOLDER_M16"), headers: EDITOR });

    expect(calls[0]?.host).toBe(CCPA_HOST);
    // Untranslated, so Antigravity's own envelope is still around it.
    expect(calls[0]?.body).toContain("model_enum");
  });

  it("leaves a model the key cannot serve to the subscription", async () => {
    const { port, proxy } = await listening({ apiKey: KEY });

    await ask(port, CHAT_PATH_PREFIX, { method: "POST", body: chatBody("MODEL_SOMETHING_ELSE"), headers: EDITOR });

    expect(calls[0]?.host).toBe(CCPA_HOST);
    expect(proxy.counts).toEqual({ translated: 0, passedThrough: 1, failed: 0 });
  });
});

describe("translating a chat", () => {
  const streamed = (): UpstreamAnswer => ({ headers: { "content-type": "text/event-stream" }, body: SSE });

  it("sends it to the public API on the user's key, and withholds the editor's", async () => {
    const { port, proxy } = await listening({ apiKey: KEY });
    answer = () => streamed();

    const reply = await ask(port, CHAT_PATH_PREFIX, {
      method: "POST",
      body: chatBody("MODEL_PLACEHOLDER_M16"),
      headers: EDITOR
    });

    expect(reply.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      host: PUBLIC_HOST,
      method: "POST",
      path: "/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse"
    });
    expect(calls[0]?.headers["x-goog-api-key"]).toBe(KEY);
    // Going out on the user's own key, so the subscription's token must not.
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    expect(proxy.counts).toEqual({ translated: 1, passedThrough: 0, failed: 0 });
  });

  // A relay of one's own, or a gateway a workplace insists on: same API, a
  // different address, and the standard path hung off whatever it lives under.
  it("aims at a base URL of one's own, path and all", async () => {
    const base = parseBaseUrl("https://relay.example.test:8443/api/");
    const { port, proxy } = await listening({ apiKey: KEY, base });
    answer = () => streamed();

    await ask(port, CHAT_PATH_PREFIX, { method: "POST", body: chatBody("MODEL_PLACEHOLDER_M16"), headers: EDITOR });

    expect(calls[0]).toMatchObject({
      host: "relay.example.test",
      path: "/api/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse"
    });
    expect(calls[0]?.headers["x-goog-api-key"]).toBe(KEY);
    expect(proxy.counts).toEqual({ translated: 1, passedThrough: 0, failed: 0 });
  });

  it("takes Antigravity's envelope off and sets the thinking dial", async () => {
    const { port } = await listening({ apiKey: KEY });
    answer = () => streamed();

    await ask(port, CHAT_PATH_PREFIX, { method: "POST", body: chatBody("MODEL_PLACEHOLDER_M16"), headers: EDITOR });

    const sent = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
    expect(sent["contents"]).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
    // The public API rejects a request carrying a field it does not know.
    expect(sent).not.toHaveProperty("labels");
    expect(sent).not.toHaveProperty("sessionId");
    expect(sent["generationConfig"]).toEqual({
      thinkingConfig: { thinkingLevel: "high", includeThoughts: false }
    });
  });

  it("re-wraps each event it is given, under one trace id", async () => {
    const { port } = await listening({ apiKey: KEY });
    answer = () => streamed();

    const reply = await ask(port, CHAT_PATH_PREFIX, {
      method: "POST",
      body: chatBody("MODEL_PLACEHOLDER_M16"),
      headers: EDITOR
    });

    expect(reply.headers["content-type"]).toBe("text/event-stream");
    const events = eventsIn(reply);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event["traceId"])).size).toBe(1);
    const answered = events[0]?.["response"] as Record<string, unknown>;
    expect(answered["candidates"]).toEqual([{ content: { role: "model", parts: [{ text: "the answer" }] } }]);
  });

  it("consolidates the whole answer when streaming is off", async () => {
    const { port } = await listening({ apiKey: KEY, stream: false });
    answer = () => streamed();

    const reply = await ask(port, CHAT_PATH_PREFIX, {
      method: "POST",
      body: chatBody("MODEL_PLACEHOLDER_M16"),
      headers: EDITOR
    });

    expect(reply.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(reply.headers["content-length"]).toBe(String(reply.raw.byteLength));
    const events = eventsIn(reply);
    expect(events).toHaveLength(2);
    const answered = events[0]?.["response"] as Record<string, unknown>;
    expect(answered["candidates"]).toEqual([{ content: { role: "model", parts: [{ text: "the answer" }] } }]);
  });

  it("hands back Google's own refusal rather than a translator error", async () => {
    const { port, proxy } = await listening({ apiKey: KEY });
    answer = () => ({ status: 429, body: JSON.stringify({ error: { message: "Quota exceeded" } }) });

    const reply = await ask(port, CHAT_PATH_PREFIX, {
      method: "POST",
      body: chatBody("MODEL_PLACEHOLDER_M16"),
      headers: EDITOR
    });

    // A spent quota or a rejected key is the user's to fix, and a 502 would tell
    // them nothing about which it was.
    expect(reply.status).toBe(429);
    expect(reply.text).toContain("Quota exceeded");
    expect(proxy.counts).toEqual({ translated: 0, passedThrough: 0, failed: 1 });
  });

  it("notes the model and the outcome, and nothing that was said", async () => {
    const { port, audit } = await listening({ apiKey: KEY });
    const directory = fs.mkdtempSync(path.join(SHARED, "audit-"));
    audit.open(directory);
    audit.setEnabled(true);
    answer = () => streamed();

    await ask(port, CHAT_PATH_PREFIX, {
      method: "POST",
      body: chatBody("MODEL_PLACEHOLDER_M16", "a private prompt"),
      headers: EDITOR
    });

    const written = fs.readFileSync(path.join(directory, "api-calls.jsonl"), "utf8");
    expect(written.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(written)).toMatchObject({
      mode: "stream",
      srcEnum: "MODEL_PLACEHOLDER_M16",
      model: "gemini-3.1-pro-preview",
      thinkingLevel: "high",
      thinkingBudget: null,
      includeThoughts: false,
      status: 200
    });
    expect(written).not.toContain("a private prompt");
    expect(written).not.toContain("the answer");
    expect(written).not.toContain(KEY);
  });
});

describe("the model catalogue", () => {
  const fromCloudCode = (call: UpstreamCall): UpstreamAnswer | undefined =>
    call.host === CCPA_HOST ? { body: CATALOG } : undefined;

  it("learns the mapping from it and fills the quota back up", async () => {
    const { port, proxy, registry } = await listening({ apiKey: KEY });
    answer = fromCloudCode;

    const reply = await ask(port, CATALOG_PATH_PREFIX, { method: "POST", body: "{}", headers: EDITOR });

    // The catalogue arrives first, then the key's own model list, so what the
    // catalogue offers is resolved against what the key can actually serve.
    expect(calls.map((call) => call.host)).toEqual([CCPA_HOST, PUBLIC_HOST]);
    expect(calls[1]?.headers["x-goog-api-key"]).toBe(KEY);
    expect(registry.resolve("MODEL_PLACEHOLDER_M84")).toEqual({
      model: "gemini-3.5-flash",
      thinkingLevel: "low",
      thinkingBudget: null
    });

    // A chat on the user's key does not spend the subscription, so the picker
    // must not be told those models are exhausted.
    const models = (JSON.parse(reply.text) as { models: Record<string, { quotaInfo?: { remainingFraction?: number } }> })
      .models;
    expect(models["gemini-3-flash-agent"]?.quotaInfo?.remainingFraction).toBe(1);
    expect(reply.headers["content-length"]).toBe(String(reply.raw.byteLength));
    expect(proxy.counts).toEqual({ translated: 0, passedThrough: 1, failed: 0 });
  });

  it("passes the bytes on untouched when there is no key", async () => {
    const { port, registry } = await listening();
    answer = fromCloudCode;

    const reply = await ask(port, CATALOG_PATH_PREFIX, { method: "POST", body: "{}", headers: EDITOR });

    // Nothing was asked of the public API, and the quota the picker draws is the
    // subscription's own — which is the truth when chat is going through it.
    expect(calls.map((call) => call.host)).toEqual([CCPA_HOST]);
    expect(reply.text).toBe(CATALOG);
    // The mapping is still learned: it costs nothing and the log wants it.
    expect(registry.catalogSize).toBe(1);
  });

  it("decodes a compressed catalogue and describes what it sends on", async () => {
    const { port } = await listening({ apiKey: KEY });
    answer = (call) =>
      call.host === CCPA_HOST
        ? { headers: { "content-encoding": "gzip" }, body: zlib.gzipSync(Buffer.from(CATALOG, "utf8")) }
        : undefined;

    const reply = await ask(port, CATALOG_PATH_PREFIX, { method: "POST", body: "{}", headers: EDITOR });

    // Read to rewrite it, so what goes on is plain, and its length says so.
    expect(reply.headers["content-encoding"]).toBeUndefined();
    expect(reply.headers["content-length"]).toBe(String(reply.raw.byteLength));
    expect(JSON.parse(reply.text)).toMatchObject({
      models: { "gemini-3-flash-agent": { quotaInfo: { remainingFraction: 1 } } }
    });
  });
});

describe("when Google cannot be reached", () => {
  beforeEach(async () => {
    redirect.port = await closedPort();
  });

  it("says so on a chat, and counts it", async () => {
    const { port, proxy } = await listening({ apiKey: KEY });

    const reply = await ask(port, CHAT_PATH_PREFIX, {
      method: "POST",
      body: chatBody("MODEL_PLACEHOLDER_M16"),
      headers: EDITOR
    });

    expect(reply.status).toBe(502);
    expect(reply.text).toBe("The Gemini API could not be reached.");
    expect(proxy.counts.failed).toBe(1);
  });

  it("says so on the catalogue, and writes a line about why", async () => {
    const { port, proxy, audit } = await listening({ apiKey: KEY });
    const directory = fs.mkdtempSync(path.join(SHARED, "audit-"));
    audit.open(directory);
    audit.setEnabled(true);

    const reply = await ask(port, CATALOG_PATH_PREFIX, { method: "POST", body: "{}", headers: EDITOR });

    expect(reply.status).toBe(502);
    expect(reply.text).toBe("The model catalogue could not be fetched.");
    expect(proxy.counts.failed).toBe(1);
    const noted = JSON.parse(fs.readFileSync(path.join(directory, "api-calls.jsonl"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(noted).toMatchObject({ mode: "catalog", status: 0 });
    expect(typeof noted["error"]).toBe("string");
  });
  it("gives a translator error when even a plain forward fails", async () => {
    const { port, proxy } = await listening({ apiKey: KEY });

    const reply = await ask(port, "/v1internal:getUserStatus", { method: "POST", body: "{}", headers: EDITOR });

    expect(reply.status).toBe(502);
    expect(reply.text).toBe("The BetterGravity translator could not complete this request.");
    expect(proxy.counts.failed).toBe(1);
  });
});

describe("checking the key", () => {
  it("asks Google what the key can see, and counts the answer", async () => {
    const result = await probeKey(KEY);

    expect(result).toEqual({ ok: true, message: "The key works, and can reach 2 models.", models: 2 });
    expect(calls[0]?.host).toBe(PUBLIC_HOST);
    expect(calls[0]?.path).toBe("/v1beta/models?pageSize=1000");
    expect(calls[0]?.headers["x-goog-api-key"]).toBe(KEY);
  });

  it("does not ask at all when there is no key", async () => {
    expect(await probeKey("  ")).toEqual({ ok: false, message: "No API key has been set." });
    expect(calls).toHaveLength(0);
  });

  it("relays Google's refusal without relaying the key it quoted", async () => {
    answer = () => ({
      status: 400,
      body: JSON.stringify({ error: { message: `API key not valid: ${KEY}` } })
    });

    const result = await probeKey(KEY);

    expect(result).toEqual({ ok: false, message: "Google answered 400. API key not valid: AIza…" });
    expect(result.message).not.toContain(KEY);
  });

  it("checks the key against a base URL of one's own, and names it", async () => {
    const base = parseBaseUrl("https://relay.example.test/api");
    answer = () => ({ status: 401, body: JSON.stringify({ error: { message: "unknown key" } }) });

    const result = await probeKey(KEY, base);

    expect(result).toEqual({ ok: false, message: "https://relay.example.test/api answered 401. unknown key" });
    expect(calls[0]).toMatchObject({ host: "relay.example.test", path: "/api/v1beta/models?pageSize=1000" });
  });

  // Checking a key against an address that is not one would only ever answer
  // about Google, which is not the question the button was asked.
  it("refuses to check anything while the base URL cannot be read", async () => {
    const result = await probeKey(KEY, parseBaseUrl("http://relay.example.test"));

    expect(result.ok).toBe(false);
    expect(result.message).toContain("unencrypted");
    expect(calls).toHaveLength(0);
  });
});


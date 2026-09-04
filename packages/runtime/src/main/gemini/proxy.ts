/**
 * The loopback endpoint Antigravity's language server is pointed at.
 *
 * `endpoint.ts` rewrites `--cloud_code_endpoint` to `https://127.0.0.1:<port>`,
 * so every Cloud Code call the language server makes arrives here. Three things
 * can happen to one:
 *
 *  - The model catalog is buffered on its way through, so the translator learns
 *    what the editor is offering, and the copy the editor sees has its Gemini
 *    quota cleared — a chat on the user's own key does not spend the bundled
 *    subscription, so showing those models as exhausted would be a lie.
 *  - A chat for a model that resolves to something the key can serve is
 *    translated to the public Gemini API and its answer re-wrapped.
 *  - Everything else is forwarded to `daily-cloudcode-pa.googleapis.com`
 *    untouched, bearing the language server's own credentials. That is the
 *    important case: Claude, a model this build has never heard of, or no key at
 *    all all behave exactly as they would with the translator switched off.
 *
 * The translation itself is in `translate.ts`; this file is transport. It listens
 * on `127.0.0.1` alone, so nothing off this machine can reach it.
 */

import { once } from "node:events";
import { request as insecureRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import https from "node:https";
import type { RequestOptions } from "node:https";
import type { AddressInfo } from "node:net";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import type { GeminiCounts, GeminiKeyTest } from "../../protocol.js";
import { logger } from "../logger.js";
import { redact, type AuditLog, type AuditMode } from "./audit.js";
import type { CertificateMaterial } from "./certificate.js";
import {
  CATALOG_PATH_PREFIX,
  CCPA_HOST,
  CHAT_PATH_PREFIX,
  GOOGLE_BASE,
  applyThinkingConfig,
  consolidate,
  filterHeaders,
  neutralizeQuota,
  newTraceId,
  publicModelNames,
  readChatRequest,
  readEventData,
  splitEvents,
  wrapEvent,
  type BaseTarget,
  type ModelRegistry,
  type Resolution
} from "./translate.js";

/** The reference proxy's ceiling, and long enough for the longest answer. */
const UPSTREAM_TIMEOUT_MS = 600_000;
/** The catalog is a few kilobytes; waiting ten minutes for it is pointless. */
const CATALOG_TIMEOUT_MS = 120_000;
const LIST_MODELS_TIMEOUT_MS = 20_000;

/**
 * A prompt with a repository's worth of context attached is still nothing like
 * this large, so a body past it is a mistake rather than a request.
 */
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

const USER_AGENT = "BetterGravity-Gemini/1";

/** What the settings panel controls. Read fresh on every request. */
export interface ProxySettings {
  readonly apiKey: string;
  /** Where the translated requests go. Google's own API unless changed. */
  readonly base: BaseTarget;
  /** Forward each event as it arrives, for token-by-token animation. */
  readonly stream: boolean;
  /** Ask the model for its reasoning and show it in the thinking panel. */
  readonly thoughts: boolean;
  /** Forward everything untranslated, as a way to compare against the key. */
  readonly bypass: boolean;
}

export interface ProxyDeps {
  readonly material: CertificateMaterial;
  readonly registry: ModelRegistry;
  readonly audit: AuditLog;
  /** Read per request, so a settings change lands without a restart. */
  readonly settings: () => ProxySettings;
  /** Called after every request, so the panel's counters can follow along. */
  readonly onActivity: () => void;
}

/** What an error may say out loud: never a stack, never anything key-shaped. */
function why(cause: unknown): string {
  return redact(cause instanceof Error ? cause.message : String(cause));
}

/** Reads the whole request body, refusing one large enough to be a mistake. */
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    size += part.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("the request body is too large to translate");
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

async function collect(stream: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Undoes an encoding the far end applied anyway. Every outbound request asks for
 * `identity`, but a body that arrives compressed and is then read — or forwarded
 * without the header that describes it — would be unreadable either way.
 */
function decode(body: Buffer, encoding: string | undefined): Buffer {
  try {
    switch ((encoding ?? "").toLowerCase()) {
      case "gzip":
      case "x-gzip":
        return zlib.gunzipSync(body);
      case "deflate":
        return zlib.inflateSync(body);
      case "br":
        return zlib.brotliDecompressSync(body);
      default:
        return body;
    }
  } catch {
    // Not what it claimed to be; the caller is no worse off with the bytes.
    return body;
  }
}

function headerText(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** One write, waiting for the socket when it is full so nothing is dropped. */
async function write(response: ServerResponse, chunk: string): Promise<void> {
  if (response.writableEnded || response.destroyed) return;
  if (!response.write(chunk)) await once(response, "drain");
}

/** Says as little as possible: the detail goes to the log, not to the wire. */
function fail(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

interface Upstream {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly stream: IncomingMessage;
  /** Stops the deadline. Called once the body has been read or given up on. */
  readonly done: () => void;
}

/**
 * One outbound request, with a deadline over the whole exchange rather than a gap
 * between packets: a stream still delivering tokens must not be cut, and one that
 * has stalled must not hold a socket open for the rest of the session.
 */
function send(
  options: RequestOptions,
  body: Buffer | undefined,
  timeoutMs: number,
  secure = true
): Promise<Upstream> {
  return new Promise((resolve, reject) => {
    const request = secure ? https.request(options) : insecureRequest(options);
    const deadline = setTimeout(() => request.destroy(new Error("the upstream request ran out of time")), timeoutMs);
    request.on("response", (stream) => {
      resolve({
        status: stream.statusCode ?? 0,
        headers: stream.headers,
        stream,
        done: () => clearTimeout(deadline)
      });
    });
    request.on("error", (cause) => {
      clearTimeout(deadline);
      reject(cause);
    });
    if (body && body.byteLength > 0) request.write(body);
    request.end();
  });
}

/**
 * A request aimed at whatever the panel points at: Google's own API, or a relay
 * that speaks the same one. The standard path is appended to the base's own, so
 * a relay hosted under a subdirectory needs no further explanation.
 *
 * `servername` is left for Node to work out from the host, which is what makes
 * an address like `https://10.0.0.4:8443` work — an IP is not a server name, and
 * sending it as one is a warning at best.
 */
function aim(base: BaseTarget, method: string, path: string, headers: OutgoingHttpHeaders): RequestOptions {
  const options: RequestOptions = { host: base.host, method, path: `${base.prefix}${path}`, headers };
  if (base.port !== undefined) options.port = base.port;
  return options;
}

export class GeminiProxy {
  private server: https.Server | undefined;
  private bound = 0;
  private translated = 0;
  private passedThrough = 0;
  private failed = 0;
  /** The last mapping logged, so an unchanged catalog is not logged again. */
  private lastSummary = "";

  constructor(private readonly deps: ProxyDeps) {}

  get port(): number | undefined {
    return this.bound > 0 ? this.bound : undefined;
  }

  get counts(): GeminiCounts {
    return { translated: this.translated, passedThrough: this.passedThrough, failed: this.failed };
  }

  /**
   * Binds an ephemeral loopback port. HTTP/1.1 only: the language server settles
   * for it, and every event this serves is written by hand.
   */
  listen(): Promise<number> {
    if (this.bound > 0) return Promise.resolve(this.bound);
    return new Promise((resolve, reject) => {
      const server = https.createServer(
        {
          cert: this.deps.material.chainPem,
          key: this.deps.material.keyPem,
          minVersion: "TLSv1.2",
          ALPNProtocols: ["http/1.1"]
        },
        (request, response) => void this.handle(request, response)
      );
      // A prompt carrying a large attachment may take a while to arrive, and an
      // answer may take ten minutes to finish; neither is a stalled request.
      server.requestTimeout = UPSTREAM_TIMEOUT_MS;
      server.headersTimeout = 66_000;
      server.keepAliveTimeout = 65_000;
      server.on("error", (cause) => {
        logger.error(`gemini: the listener failed: ${why(cause)}`);
        reject(cause);
      });
      // Something that is not TLS, or not HTTP: nothing to say back to it.
      server.on("clientError", (_cause, socket) => socket.destroy());
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        this.bound = address !== null && typeof address === "object" ? (address as AddressInfo).port : 0;
        this.server = server;
        logger.info(`gemini: listening on https://127.0.0.1:${this.bound}`);
        resolve(this.bound);
      });
    });
  }

  warmup(apiKey: string, base: BaseTarget): void {
    if (apiKey !== "") {
      void this.refreshPublicModels(apiKey, base);
    }
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.bound = 0;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Otherwise a kept-alive language server connection holds this open.
      server.closeAllConnections();
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const settings = this.deps.settings();
    const target = request.url ?? "/";
    try {
      const body = await readBody(request);
      if (target.startsWith(CATALOG_PATH_PREFIX)) {
        await this.catalog(request, response, body, settings);
      } else if (settings.bypass || settings.apiKey === "" || !target.startsWith(CHAT_PATH_PREFIX)) {
        await this.passthrough(request, response, body);
      } else {
        await this.chat(request, response, body, settings);
      }
    } catch (cause) {
      this.failed += 1;
      logger.error(`gemini: ${request.method ?? "?"} ${target} failed: ${why(cause)}`);
      fail(response, 502, "The BetterGravity translator could not complete this request.");
    }
    this.deps.onActivity();
  }

  /**
   * Forwards to Cloud Code unchanged, carrying the language server's own bearer
   * token. This is the path that makes the feature safe to leave switched on.
   */
  private async passthrough(request: IncomingMessage, response: ServerResponse, body: Buffer): Promise<void> {
    const upstream = await this.forward(request, body, UPSTREAM_TIMEOUT_MS);
    const headers = filterHeaders(upstream.headers);
    // The body goes on byte for byte, so whatever encoding it arrived in still
    // describes it.
    const encoding = headerText(upstream.headers, "content-encoding");
    if (encoding !== undefined) headers["content-encoding"] = encoding;
    response.writeHead(upstream.status, headers);
    this.passedThrough += 1;
    try {
      await pipeline(upstream.stream, response);
    } catch (cause) {
      // Usually the editor closing a request it no longer wants.
      logger.info(`gemini: a forwarded response ended early: ${why(cause)}`);
    } finally {
      upstream.done();
    }
  }

  private forward(request: IncomingMessage, body: Buffer, timeoutMs: number): Promise<Upstream> {
    const headers = filterHeaders(request.headers);
    // The language server addressed the loopback port, so its Host header names
    // that; Google answers on its own name or not at all.
    headers["host"] = CCPA_HOST;
    headers["accept-encoding"] ??= "identity";
    if (body.byteLength > 0) headers["content-length"] = String(body.byteLength);
    const options: RequestOptions = {
      host: CCPA_HOST,
      servername: CCPA_HOST,
      method: request.method ?? "GET",
      path: request.url ?? "/",
      headers
    };
    return send(options, body, timeoutMs);
  }

  /**
   * The catalog, buffered on its way past. Two things are taken from it: the
   * mapping from Antigravity's model enums to public model names, and — for the
   * copy the editor receives — a quota that no longer claims the user's Gemini
   * models are spent. The mapping is always read from what arrived.
   */
  private async catalog(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    settings: ProxySettings
  ): Promise<void> {
    const started = Date.now();
    let upstream: Upstream;
    try {
      upstream = await this.forward(request, body, CATALOG_TIMEOUT_MS);
    } catch (cause) {
      this.failed += 1;
      this.deps.audit.record({
        mode: "catalog",
        srcEnum: "",
        model: "",
        thinkingLevel: null,
        thinkingBudget: null,
        includeThoughts: false,
        status: 0,
        latencyMs: Date.now() - started,
        error: why(cause)
      });
      logger.error(`gemini: the model catalog could not be fetched: ${why(cause)}`);
      fail(response, 502, "The model catalogue could not be fetched.");
      return;
    }

    const raw = decode(await collect(upstream.stream), headerText(upstream.headers, "content-encoding"));
    upstream.done();
    this.passedThrough += 1;

    if (upstream.status === 200) {
      // Before resolving the catalog against the key, in case a model shipped
      // while this session has been running.
      await this.refreshPublicModels(settings.apiKey, settings.base);
      if (this.deps.registry.updateFromCatalog(raw) > 0) this.logMapping();
    }

    const rewritten =
      settings.apiKey !== "" && !settings.bypass && upstream.status === 200 ? neutralizeQuota(raw) : undefined;
    const out = rewritten === undefined ? raw : Buffer.from(rewritten, "utf8");
    const headers = filterHeaders(upstream.headers);
    // Decoded above, so the length is this one and the encoding is gone.
    headers["content-length"] = String(out.byteLength);
    response.writeHead(upstream.status, headers);
    response.end(out);
  }

  /**
   * What the key actually serves, re-read when the cache has gone stale. A
   * failure is not fatal: the resolver falls back to naming models from their
   * display names, which is what it did before this existed.
   */
  private async refreshPublicModels(apiKey: string, base: BaseTarget): Promise<void> {
    if (apiKey === "" || !this.deps.registry.publicModelsStale()) return;
    try {
      const upstream = await send(
        aim(base, "GET", "/v1beta/models?pageSize=1000", {
          "x-goog-api-key": apiKey,
          "user-agent": USER_AGENT,
          "accept-encoding": "identity"
        }),
        undefined,
        LIST_MODELS_TIMEOUT_MS,
        base.secure
      );
      const raw = decode(await collect(upstream.stream), headerText(upstream.headers, "content-encoding"));
      upstream.done();
      if (upstream.status !== 200) {
        logger.info(`gemini: the key's model list answered ${upstream.status}; naming models by hand instead`);
        return;
      }
      const names = publicModelNames(raw);
      if (names.length === 0) return;
      const update = this.deps.registry.rememberPublicModels(names);
      const news = update.added.length > 0 ? `, new: ${update.added.join(", ")}` : "";
      logger.info(`gemini: the key serves ${update.count} model(s)${news}`);
    } catch (cause) {
      logger.info(`gemini: the key's model list could not be read: ${why(cause)}`);
    }
  }

  /**
   * The mapping, logged whenever it changes. Worth having: a model that quietly
   * falls through to the subscription is otherwise indistinguishable from one
   * that was never offered, and the enum numbers move between host versions.
   */
  private logMapping(): void {
    const summary = this.deps.registry.summarize().join("\n");
    if (summary === this.lastSummary || summary === "") return;
    this.lastSummary = summary;
    logger.info(`gemini: model mapping\n${summary}`);
  }

  /**
   * A chat. The model the picker chose decides everything: if it resolves to
   * something the key can serve, the request is translated; if not, it is
   * forwarded, and the answer comes from the subscription as usual.
   */
  private async chat(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    settings: ProxySettings
  ): Promise<void> {
    const read = readChatRequest(body);
    const resolution = read ? this.deps.registry.resolve(read.sourceEnum) : undefined;
    if (!read || !resolution) {
      await this.passthrough(request, response, body);
      return;
    }

    applyThinkingConfig(read.inner, resolution, settings.thoughts);
    const payload = Buffer.from(JSON.stringify(read.inner), "utf8");
    const mode: AuditMode = settings.stream ? "stream" : "buffered";
    const started = Date.now();

    let upstream: Upstream;
    try {
      upstream = await send(
        aim(
          settings.base,
          "POST",
          `/v1beta/models/${encodeURIComponent(resolution.model)}:streamGenerateContent?alt=sse`,
          {
            "content-type": "application/json",
            "content-length": String(payload.byteLength),
            "x-goog-api-key": settings.apiKey,
            "user-agent": USER_AGENT,
            "accept-encoding": "identity"
          }
        ),
        payload,
        UPSTREAM_TIMEOUT_MS,
        settings.base.secure
      );
    } catch (cause) {
      this.failed += 1;
      this.note(mode, read.sourceEnum, resolution, settings, 0, started, cause);
      logger.error(`gemini: ${resolution.model} could not be reached: ${why(cause)}`);
      fail(response, 502, "The Gemini API could not be reached.");
      return;
    }
    this.note(mode, read.sourceEnum, resolution, settings, upstream.status, started, undefined);

    if (upstream.status !== 200) {
      const message = decode(await collect(upstream.stream), headerText(upstream.headers, "content-encoding"));
      upstream.done();
      this.failed += 1;
      // Whatever Google said, said to the editor: a rejected key or a spent
      // quota is the user's to fix, and a 502 would tell them nothing.
      logger.info(`gemini: ${resolution.model} answered ${upstream.status}`);
      response.writeHead(upstream.status, {
        "content-type": headerText(upstream.headers, "content-type") ?? "application/json"
      });
      response.end(message);
      return;
    }

    this.translated += 1;
    const traceId = newTraceId();
    if (settings.stream) await this.streamOut(upstream, response, traceId, settings.thoughts);
    else await this.bufferOut(upstream, response, traceId, settings.thoughts);
  }

  /**
   * Each event re-wrapped and flushed as it arrives, which is what makes the
   * answer appear a token at a time instead of all at once.
   */
  private async streamOut(
    upstream: Upstream,
    response: ServerResponse,
    traceId: string,
    thoughts: boolean
  ): Promise<void> {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff"
    });
    let rest: Buffer = Buffer.alloc(0);
    try {
      for await (const chunk of upstream.stream) {
        const scan = splitEvents(Buffer.concat([rest, chunk as Buffer]));
        rest = scan.rest;
        for (const event of scan.events) {
          for (const payload of readEventData(event)) await write(response, wrapEvent(payload, traceId, thoughts));
        }
      }
    } catch (cause) {
      // Half an answer is still an answer; the editor keeps what arrived.
      logger.error(`gemini: the stream ended early: ${why(cause)}`);
    } finally {
      upstream.done();
    }
    response.end();
  }

  /**
   * The whole answer read first and sent as two events. Slower to appear, but
   * the shape Cloud Code itself returns, so it is the safer of the two.
   */
  private async bufferOut(
    upstream: Upstream,
    response: ServerResponse,
    traceId: string,
    thoughts: boolean
  ): Promise<void> {
    let raw: Buffer = Buffer.alloc(0);
    try {
      raw = await collect(upstream.stream);
    } finally {
      upstream.done();
    }
    const payloads = splitEvents(raw).events.flatMap((event) => [...readEventData(event)]);
    const answer = consolidate(payloads, traceId, thoughts);
    logger.info(
      `gemini: ${answer.textLength} characters, ${answer.thoughtLength} of thinking, ${answer.actionCount} tool call(s)`
    );
    const out = Buffer.from(answer.body, "utf8");
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "content-length": String(out.byteLength)
    });
    response.end(out);
  }

  private note(
    mode: AuditMode,
    srcEnum: string,
    resolution: Resolution,
    settings: ProxySettings,
    status: number,
    started: number,
    cause: unknown
  ): void {
    this.deps.audit.record({
      mode,
      srcEnum,
      model: resolution.model,
      thinkingLevel: resolution.thinkingLevel,
      thinkingBudget: resolution.thinkingBudget,
      includeThoughts: settings.thoughts,
      status,
      latencyMs: Date.now() - started,
      error: cause === undefined ? undefined : why(cause)
    });
  }
}

/** The readable part of a Google error body, when it has one. */
function googleMessage(raw: Buffer): string {
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === "string" ? redact(message) : "";
  } catch {
    return "";
  }
}

/** Who a message names: Google, unless the panel was pointed somewhere else. */
function upstreamName(base: BaseTarget): string {
  return base.host === GOOGLE_BASE.host && base.prefix === "" ? "Google" : base.origin;
}

/**
 * Asks what a key can see, changing nothing on either side. This is what the
 * settings panel's test button runs, so the answer is phrased to be read: either
 * the key works and reaches so many models, or the reason it does not.
 *
 * It goes straight to the API rather than through the listener, so it is an
 * answer about the key and the base URL alone — no certificate, no language
 * server, nothing else that could be the thing at fault.
 */
export async function probeKey(apiKey: string, base: BaseTarget = GOOGLE_BASE): Promise<GeminiKeyTest> {
  const key = apiKey.trim();
  if (key === "") return { ok: false, message: "No API key has been set." };
  // Nothing to check a key against until the address it would be sent to reads
  // as one, and the panel is saying the same thing above this button.
  if (base.problem !== undefined) return { ok: false, message: base.problem };

  const who = upstreamName(base);
  try {
    const upstream = await send(
      aim(base, "GET", "/v1beta/models?pageSize=1000", {
        "x-goog-api-key": key,
        "user-agent": USER_AGENT,
        "accept-encoding": "identity"
      }),
      undefined,
      LIST_MODELS_TIMEOUT_MS,
      base.secure
    );
    const raw = decode(await collect(upstream.stream), headerText(upstream.headers, "content-encoding"));
    upstream.done();

    if (upstream.status !== 200) {
      const detail = googleMessage(raw);
      return { ok: false, message: `${who} answered ${upstream.status}.${detail === "" ? "" : ` ${detail}`}` };
    }

    const models = publicModelNames(raw).length;
    return { ok: true, message: `The key works, and can reach ${models} model${models === 1 ? "" : "s"}.`, models };
  } catch (cause) {
    return { ok: false, message: `${who} could not be reached: ${why(cause)}` };
  }
}

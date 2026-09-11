import type { Session } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginPatches } from "../src/main/source-patch.js";

const { fetchMock, logError } = vi.hoisted(() => ({ fetchMock: vi.fn(), logError: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch: fetchMock } }));
vi.mock("../src/main/logger.js", () => ({ logger: { info: vi.fn(), error: logError } }));

const patches: PluginPatches[] = [{
  pluginId: "test",
  patches: [{ find: "bundle-anchor", replace: [{ match: "original", with: "patched" }] }]
}];
const streamUrl = "https://127.0.0.1:4567/StreamAgentStateUpdates";
const bundleUrl = "https://127.0.0.1:4567/assets/main.js?v=1";

async function intercept(sets = patches) {
  let handler!: (request: Request) => Response | Promise<Response>;
  const session = {
    protocol: { handle: vi.fn((_scheme, next) => { handler = next; }) }
  };
  const { installSourceInterceptor } = await import("../src/main/intercept.js");
  expect(installSourceInterceptor(session as unknown as Session, sets)).toBe(true);
  return async (request: Request) => handler(request);
}

// Model Electron's net.fetch: destroying its response reader does NOT abort
// the network request. Only the supplied signal closes the upstream stream.
function idleUpstream() {
  let signal!: AbortSignal;
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller;
      controller.enqueue(new Uint8Array([0, 255, 128, 42]));
    }
  });
  fetchMock.mockImplementation(async (_url, options) => {
    signal = options.signal;
    signal.addEventListener("abort", () => source.error(signal.reason), { once: true });
    return new Response(body, { headers: { "content-type": "application/connect+proto" } });
  });
  return { body, signal: () => signal, fail: (error: Error) => source.error(error) };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  logError.mockReset();
});

describe("source interceptor transport", () => {
  it("closes an idle upstream request when the renderer cancels a pending read", async () => {
    const handle = await intercept();
    const upstream = idleUpstream();
    const response = await handle(new Request(streamUrl));
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([0, 255, 128, 42]));
    const pending = reader.read();

    await reader.cancel("chat switched");

    expect(upstream.signal().aborted).toBe(true);
    expect(upstream.signal().reason).toBe("chat switched");
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(upstream.body.locked).toBe(false);
  });

  it("cancels an upstream response before its first byte arrives", async () => {
    const handle = await intercept();
    let signal!: AbortSignal;
    fetchMock.mockImplementation(async (_url, options) => {
      signal = options.signal;
      return new Response(new ReadableStream());
    });
    const response = await handle(new Request(streamUrl));

    await response.body!.cancel();

    expect(signal.aborted).toBe(true);
  });

  it("forwards an explicit request abort while waiting for headers", async () => {
    const handle = await intercept();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const controller = new AbortController();
    const response = handle(new Request(streamUrl, { signal: controller.signal }));
    const rejected = expect(response).rejects.toBe("cancelled before headers");

    controller.abort("cancelled before headers");

    await rejected;
  });

  it("forwards an already aborted request without waiting for another abort", async () => {
    const handle = await intercept();
    fetchMock.mockImplementation(async (_url, options) => { options.signal.throwIfAborted(); });
    const controller = new AbortController();
    controller.abort("already cancelled");

    await expect(handle(new Request(streamUrl, { signal: controller.signal }))).rejects.toBe("already cancelled");
  });

  it("releases the network request and reader on a response failure", async () => {
    const handle = await intercept();
    const upstream = idleUpstream();
    const response = await handle(new Request(streamUrl));
    const reader = response.body!.getReader();
    await reader.read();
    const pending = reader.read();
    const failure = new Error("connection reset");
    const rejected = expect(pending).rejects.toBe(failure);

    upstream.fail(failure);

    await rejected;
    expect(upstream.signal().aborted).toBe(true);
    expect(upstream.body.locked).toBe(false);
  });

  it("preserves binary uploads, response bytes, status and headers", async () => {
    const handle = await intercept();
    const bytes = new Uint8Array([0, 255, 128, 42]);
    let signal!: AbortSignal;
    fetchMock.mockImplementation(async (url, options) => {
      expect(url).toBe(streamUrl);
      expect(options.method).toBe("POST");
      expect(options.headers.get("x-request-id")).toBe("synthetic");
      expect(options.bypassCustomProtocolHandlers).toBe(true);
      expect(new Uint8Array(await new Request(url, options).arrayBuffer())).toEqual(bytes);
      signal = options.signal;
      return new Response(bytes, { status: 201, statusText: "Created", headers: { "x-result": "kept" } });
    });
    const controller = new AbortController();
    const response = await handle(new Request(streamUrl, {
      method: "POST", body: bytes, headers: { "x-request-id": "synthetic" }, signal: controller.signal
    }));

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-result")).toBe("kept");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    controller.abort("finished request no longer owns the network");
    expect(signal.aborted).toBe(false);
  });

  it("preserves responses without a body", async () => {
    const handle = await intercept();
    const original = new Response(null, { status: 204 });
    fetchMock.mockResolvedValue(original);

    expect(await handle(new Request(streamUrl))).toBe(original);
  });

  it("does not retry failed chat POSTs", async () => {
    const handle = await intercept();
    const failure = new Error("offline");
    fetchMock.mockRejectedValue(failure);

    await expect(handle(new Request(streamUrl, { method: "POST", body: "request" }))).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("source interception", () => {
  it("patches a bundle and discards its stale content length", async () => {
    const handle = await intercept();
    fetchMock.mockResolvedValue(new Response("/* bundle-anchor */ original", {
      headers: { "content-type": "text/javascript", "content-length": "28" }
    }));
    const response = await handle(new Request(bundleUrl));

    expect(await response.text()).toBe("/* bundle-anchor */ patched");
    expect(response.headers.get("content-type")).toBe("text/javascript");
    expect(response.headers.has("content-length")).toBe(false);
  });

  it("leaves remote JavaScript and unsuccessful responses unchanged", async () => {
    const handle = await intercept();
    fetchMock.mockResolvedValueOnce(new Response("/* bundle-anchor */ original"));
    expect(await (await handle(new Request("https://example.com/main.js"))).text()).toBe("/* bundle-anchor */ original");

    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const response = await handle(new Request(bundleUrl));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("unavailable");
  });

  it("serves the original bundle when a declaration is invalid", async () => {
    const handle = await intercept([{
      pluginId: "broken",
      patches: [{ find: "bundle-anchor", replace: [{ match: "([", with: "broken" }] }]
    }]);
    fetchMock.mockResolvedValue(new Response("/* bundle-anchor */ original"));

    expect(await (await handle(new Request(bundleUrl))).text()).toBe("/* bundle-anchor */ original");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("did not apply"));
  });

  it("releases a broken bundle response before falling back to the original", async () => {
    const handle = await intercept();
    let failedSignal!: AbortSignal;
    fetchMock.mockImplementationOnce(async (_url, options) => {
      failedSignal = options.signal;
      return new Response(new ReadableStream({ start(stream) { stream.error(new Error("broken body")); } }));
    });
    fetchMock.mockResolvedValueOnce(new Response("/* bundle-anchor */ original"));

    expect(await (await handle(new Request(bundleUrl))).text()).toBe("/* bundle-anchor */ original");
    expect(failedSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

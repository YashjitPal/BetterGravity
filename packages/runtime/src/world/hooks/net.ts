/**
 * Watching and rewriting what Antigravity sends to its language server.
 *
 * The interface talks to a local language server over connect-rpc, and `fetch`,
 * `XMLHttpRequest`, and `WebSocket` are all untouched natives on the page. The
 * page-world runtime is injected before the application bundle runs, so
 * wrapping them here catches everything the application does.
 *
 * Bodies are protobuf, not JSON, so a plugin inspecting them is working with
 * bytes unless it brings its own decoder.
 */

export type FetchMiddleware = (request: Request, next: (request: Request) => Promise<Response>) => Promise<Response>;

export interface SocketEvent {
  readonly url: string;
  readonly socket: WebSocket;
}

export interface NetworkTools {
  /**
   * Wraps every fetch the page makes. Call `next` to continue, or return your
   * own Response to answer without touching the network. Middleware runs in the
   * order it was registered.
   */
  onFetch(middleware: FetchMiddleware): () => void;
  /** Called for each WebSocket the page opens, before anything is sent. */
  onWebSocket(handler: (event: SocketEvent) => void): () => void;
  /** Called with the method and url of each XMLHttpRequest the page opens. */
  onRequest(handler: (method: string, url: string) => void): () => void;
}

interface Registry {
  readonly fetch: FetchMiddleware[];
  readonly sockets: ((event: SocketEvent) => void)[];
  readonly requests: ((method: string, url: string) => void)[];
}

const registry: Registry = { fetch: [], sockets: [], requests: [] };
let installed = false;

function report(what: string, error: unknown): void {
  console.error(`[BetterGravity] A ${what} interceptor threw; the request continued unchanged.`, error);
}

/**
 * Installs the wrappers once, as early as the page world is injected. Handlers
 * registered later apply to subsequent traffic; anything the application sent
 * before this ran is missed, which is why injection happens at document start.
 */
export function installNetworkHooks(): void {
  if (installed) return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (registry.fetch.length === 0) return nativeFetch(input, init);

    const request = input instanceof Request && !init ? input : new Request(input as RequestInfo, init);
    // Built from the inside out, so the first middleware registered is the
    // outermost and therefore the first to run.
    const chain = [...registry.fetch].reduceRight<(request: Request) => Promise<Response>>(
      (next, middleware) => (current) => {
        try {
          return middleware(current, next);
        } catch (error) {
          report("fetch", error);
          return next(current);
        }
      },
      (current) => nativeFetch(current)
    );

    return chain(request);
  };

  const NativeWebSocket = window.WebSocket;
  const PatchedWebSocket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    for (const handler of [...registry.sockets]) {
      try {
        handler({ url: String(url), socket });
      } catch (error) {
        report("WebSocket", error);
      }
    }
    return socket;
  } as unknown as typeof WebSocket;
  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  Object.assign(PatchedWebSocket, NativeWebSocket);
  window.WebSocket = PatchedWebSocket;

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    for (const handler of [...registry.requests]) {
      try {
        handler(method, String(url));
      } catch (error) {
        report("XMLHttpRequest", error);
      }
    }
    return (nativeOpen as (...args: unknown[]) => unknown).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
}

function register<Handler>(list: Handler[], handler: Handler, track: (dispose: () => void) => void): () => void {
  list.push(handler);
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
  track(remove);
  return remove;
}

export function createNetworkTools(track: (dispose: () => void) => void): NetworkTools {
  return {
    onFetch: (middleware) => register(registry.fetch, middleware, track),
    onWebSocket: (handler) => register(registry.sockets, handler, track),
    onRequest: (handler) => register(registry.requests, handler, track)
  };
}

/** Test seam: clears every registered handler. */
export function resetNetworkHandlers(): void {
  registry.fetch.length = 0;
  registry.sockets.length = 0;
  registry.requests.length = 0;
}

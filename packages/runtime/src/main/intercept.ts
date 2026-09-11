import crypto from "node:crypto";
import { net, type Session } from "electron";
import { logger } from "./logger.js";
import { applySourcePatches, type PluginPatches } from "./source-patch.js";

/** Antigravity serves its interface from a language server bound to loopback. */
const HOST_ORIGIN_PREFIX = "https://127.0.0.1:";

/** Patched bundles keyed by source hash, so a window reload costs nothing. */
const cache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 4;

let installed = false;

function signature(sets: readonly PluginPatches[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(sets)).digest("hex").slice(0, 16);
}

function isBundle(url: string): boolean {
  if (!url.startsWith(HOST_ORIGIN_PREFIX)) return false;
  try {
    return new URL(url).pathname.endsWith(".js");
  } catch {
    return false;
  }
}

/**
 * Passes a request through to the network unchanged.
 *
 * `bypassCustomProtocolHandlers` is essential: without it net.fetch is routed
 * back through the handler that called it, and every request recurses. Streamed
 * bodies also need `duplex`, which is how Antigravity's own proxy handles the
 * same problem.
 *
 * Electron's protocol Request.signal does not receive renderer cancellation.
 * It does cancel the returned response body, but net.fetch's body cancellation
 * only destroys its reader, leaving the network request open. Tie that body
 * cancellation to an explicit abort, including while an idle read is pending.
 * Otherwise abandoned chat subscriptions exhaust the HTTP/2 stream limit.
 */
async function passThrough(request: Request): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const detach = () => request.signal.removeEventListener("abort", abort);

  const options: RequestInit & { duplex?: "half"; bypassCustomProtocolHandlers?: boolean } = {
    method: request.method,
    headers: request.headers,
    cache: request.cache,
    body: request.body,
    signal: controller.signal,
    bypassCustomProtocolHandlers: true,
    ...(request.body ? { duplex: "half" as const } : {})
  };
  let response: Response;
  try {
    response = await net.fetch(request.url, options);
  } catch (error) {
    detach();
    throw error;
  }
  if (!response.body) {
    detach();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;
  const finish = () => {
    finished = true;
    detach();
    reader.releaseLock();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) {
          finish();
          stream.close();
        } else {
          stream.enqueue(value);
        }
      } catch (error) {
        if (finished) return;
        controller.abort(error);
        finish();
        stream.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      detach();
      // Abort before waiting for the reader: an idle subscription may never
      // produce another chunk, and cancelling its reader alone leaks the RPC.
      controller.abort(reason);
      try {
        await reader.cancel(reason);
      } catch {
        // Aborting the network can reject the reader's cancellation too.
      } finally {
        reader.releaseLock();
      }
    }
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * Rewrites Antigravity's bundle on its way to the renderer.
 *
 * Only loopback JavaScript is rewritten; other HTTPS responses are streamed
 * unchanged with cancellation forwarded to their network requests. A broken
 * patch, an unreadable body, or a thrown handler returns the original response;
 * end with Antigravity loading exactly as it would without BetterGravity. The
 * interceptor is not installed at all unless a plugin actually declares patches.
 */
export function installSourceInterceptor(
  session: Session,
  sets: readonly PluginPatches[],
  readLatest?: () => readonly PluginPatches[]
): boolean {
  if (installed || sets.length === 0) return false;

  let active = { sets, key: signature(sets), succeeded: new Set<string>() };
  const announce = () => {
    const declared = active.sets.flatMap((set) => set.patches.map(() => set.pluginId));
    logger.info(`Source patching enabled: ${declared.length} patch(es) from ${new Set(declared).size} plugin(s).`);
  };
  announce();

  // Reported once, after the served files have settled, so a plugin only hears
  // about its patch when it matched nothing anywhere.
  let summaryTimer: NodeJS.Timeout | undefined;
  const scheduleSummary = (selection: typeof active) => {
    if (selection !== active) return;
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      for (const { pluginId } of selection.sets) {
        if (!selection.succeeded.has(pluginId)) {
          logger.error(`Source patches from ${pluginId} matched nothing. Antigravity has probably changed since they were written.`);
        }
      }
    }, 5_000);
    summaryTimer.unref?.();
  };

  try {
    session.protocol.handle("https", async (request) => {
      // Anything that is not the application's own script is none of our
      // business, and must not be delayed or altered.
      if (!isBundle(request.url)) return passThrough(request);

      try {
        // A plugin can be updated while Electron remains open. Reading only
        // at process startup made a window reload silently lose newer hooks.
        // This runs only for local scripts, never chat RPCs or arriving tokens.
        if (readLatest) {
          const latest = readLatest();
          const key = signature(latest);
          if (key !== active.key) {
            if (summaryTimer) clearTimeout(summaryTimer);
            active = { sets: latest, key, succeeded: new Set<string>() };
            cache.clear();
            announce();
          }
        }
        const selection = active;

        // HTTP validators describe the unmodified host file. A 304 or a cached
        // response must not keep an older patch revision alive after reload.
        const requestHeaders = new Headers(request.headers);
        requestHeaders.delete("if-none-match");
        requestHeaders.delete("if-modified-since");
        const response = await passThrough(new Request(request, { headers: requestHeaders, cache: "no-store" }));
        if (!response.ok) return response;

        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("etag");
        headers.delete("last-modified");
        headers.set("cache-control", "no-store");
        // A disabled plugin must also leave the next reload able to enable its
        // hooks. Stream native bytes without letting Chromium cache that state.
        if (selection.sets.length === 0) {
          return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }

        const source = await response.text();
        const key = `${selection.key}:${crypto.createHash("sha256").update(source).digest("hex")}`;

        let patched = cache.get(key);
        if (patched === undefined) {
          const outcome = applySourcePatches(source, selection.sets);

          // A missing anchor only means this patch targets a different file, and
          // several are served. Real problems are reported at once; anchors are
          // left to the summary below, which knows whether they ever matched.
          for (const failure of outcome.failures) {
            if (failure.kind !== "anchor") logger.error(`Source patch from ${failure.pluginId} did not apply: ${failure.reason}`);
          }
          for (const pluginId of outcome.applied) selection.succeeded.add(pluginId);
          if (outcome.applied.length > 0) {
            logger.info(`Patched ${new URL(request.url).pathname} for ${outcome.applied.join(", ")}.`);
          }
          scheduleSummary(selection);

          patched = outcome.source;
          if (selection === active) {
            if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
            cache.set(key, patched);
          }
        }

        return new Response(patched, { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        logger.error("Source patching failed; serving Antigravity's own bundle.", error);
        return passThrough(request);
      }
    });

    installed = true;
    return true;
  } catch (error) {
    logger.error("Could not install the source interceptor. Patches are inactive.", error);
    return false;
  }
}

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
 */
function passThrough(request: Request): Promise<Response> {
  const options: RequestInit & { duplex?: "half"; bypassCustomProtocolHandlers?: boolean } = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    bypassCustomProtocolHandlers: true,
    ...(request.body ? { duplex: "half" as const } : {})
  };
  return net.fetch(request.url, options);
}

/**
 * Rewrites Antigravity's bundle on its way to the renderer.
 *
 * This intercepts the loopback origin only, and every failure path returns the
 * original response: a broken patch, an unreadable body, or a thrown handler all
 * end with Antigravity loading exactly as it would without BetterGravity. The
 * interceptor is not installed at all unless a plugin actually declares patches.
 */
export function installSourceInterceptor(session: Session, sets: readonly PluginPatches[]): boolean {
  if (installed || sets.length === 0) return false;

  const patchKey = signature(sets);
  const declared = sets.flatMap((set) => set.patches.map(() => set.pluginId));
  logger.info(`Source patching enabled: ${declared.length} patch(es) from ${new Set(declared).size} plugin(s).`);

  // Reported once, after the served files have settled, so a plugin only hears
  // about its patch when it matched nothing anywhere.
  const succeeded = new Set<string>();
  let summaryTimer: NodeJS.Timeout | undefined;
  const scheduleSummary = () => {
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      for (const { pluginId } of sets) {
        if (!succeeded.has(pluginId)) {
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
        const response = await passThrough(request);
        if (!response.ok) return response;

        const source = await response.text();
        const key = `${patchKey}:${crypto.createHash("sha256").update(source).digest("hex")}`;

        let patched = cache.get(key);
        if (patched === undefined) {
          const outcome = applySourcePatches(source, sets);

          // A missing anchor only means this patch targets a different file, and
          // several are served. Real problems are reported at once; anchors are
          // left to the summary below, which knows whether they ever matched.
          for (const failure of outcome.failures) {
            if (failure.kind !== "anchor") logger.error(`Source patch from ${failure.pluginId} did not apply: ${failure.reason}`);
          }
          for (const pluginId of outcome.applied) succeeded.add(pluginId);
          if (outcome.applied.length > 0) {
            logger.info(`Patched ${new URL(request.url).pathname} for ${outcome.applied.join(", ")}.`);
          }
          scheduleSummary();

          patched = outcome.source;
          if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
          cache.set(key, patched);
        }

        const headers = new Headers(response.headers);
        headers.delete("content-length");
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

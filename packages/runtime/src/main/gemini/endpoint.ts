/**
 * The one thing this feature changes about Antigravity: the address its
 * language server is told to send chat traffic to.
 *
 * That server is a Go binary the main process spawns, and it is handed
 * `--cloud_code_endpoint https://daily-cloudcode-pa.googleapis.com` on the
 * command line. Pointing the flag at our own loopback listener is the whole
 * mechanism — the binary is not patched, no socket is hijacked, and with the
 * feature off the argument is exactly the one Antigravity wrote.
 *
 * The hook wraps `child_process.spawn` on the live builtin. That works because
 * the bootstrap calls `activate()` before Antigravity's main script runs, and
 * because the spawn site reads `.spawn` off the module object at call time
 * rather than capturing it. It is also why the wrapper is so defensive: every
 * process the editor starts passes through here, so anything that is not the
 * language server goes straight to the original, and a failure inside the
 * wrapper is logged and then forgotten rather than allowed to stop a launch.
 *
 * Only the flag's value is ever changed. Nothing is appended, so a future
 * language server that no longer accepted the flag would be spawned exactly as
 * Antigravity intended instead of refusing to start on an argument it does not
 * recognise.
 */

import { createRequire } from "node:module";
import { logger } from "../logger.js";

/** The flag Antigravity passes, in either of the two forms a command line carries. */
const FLAG = "--cloud_code_endpoint";

/** Only this binary's arguments are touched. */
const BINARY_NAME = "language_server";

/** Where the untouched `spawn` is kept, so arming twice cannot stack wrappers. */
const ORIGINAL = Symbol.for("bettergravity.gemini.spawn");

/**
 * `child_process.spawn` seen from the outside. The real signature has half a
 * dozen overloads and none of them matter here: the wrapper forwards whatever
 * it was given, having possibly replaced one string inside the argument array.
 */
export type SpawnLike = (...parameters: unknown[]) => unknown;

/** The module object the wrapper is installed on, or a double standing in for it. */
export interface SpawnHost {
  spawn: SpawnLike;
  [key: symbol]: unknown;
}

export interface EndpointHook {
  /**
   * The loopback URL to hand the language server, or undefined to leave the
   * spawn alone. Read at spawn time, so a listener that came up late is used
   * and one that never came up costs nothing.
   */
  readonly endpoint: () => string | undefined;
  /**
   * Called after every language server spawn with the endpoint it was given, or
   * undefined when it was left pointing at Google. The second case is what a
   * "restart Antigravity" notice is made of.
   */
  readonly onSpawn: (endpoint: string | undefined) => void;
}

export interface Rewrite {
  /** The argument array to spawn with: the original object when nothing changed. */
  readonly args: readonly string[];
  /** The endpoint the language server will use, or undefined if the flag was not found. */
  readonly endpoint: string | undefined;
  /** What the flag said before, when it was replaced. */
  readonly replaced: string | undefined;
}

/**
 * Whether a spawn is the language server, by the name of the file rather than
 * the whole path, so a directory that happens to contain the word does not
 * volunteer every binary inside it.
 */
export function isLanguageServer(file: unknown): boolean {
  if (typeof file !== "string") return false;
  const name = file.replace(/\\/g, "/").split("/").pop() ?? "";
  return name.toLowerCase().startsWith(BINARY_NAME);
}

/**
 * Replaces the endpoint the language server was told to use. Both spellings are
 * handled — Antigravity passes the flag and its value as two arguments, but a
 * single `--flag=value` is just as valid a way to write it.
 *
 * A flag with no value after it is left alone: something is wrong with the
 * command line and guessing at it would not help.
 */
export function rewriteArgs(args: readonly string[], endpoint: string): Rewrite {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;

    if (argument === FLAG) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) break;
      if (value === endpoint) return { args, endpoint, replaced: undefined };
      const next = [...args];
      next[index + 1] = endpoint;
      return { args: next, endpoint, replaced: value };
    }

    if (argument.startsWith(`${FLAG}=`)) {
      const value = argument.slice(FLAG.length + 1);
      if (value === endpoint) return { args, endpoint, replaced: undefined };
      const next = [...args];
      next[index] = `${FLAG}=${endpoint}`;
      return { args: next, endpoint, replaced: value };
    }
  }

  return { args, endpoint: undefined, replaced: undefined };
}

/**
 * Wraps `spawn` on one host object. Exported separately from the installer so
 * the wrapper can be exercised against a double, without a real process being
 * started to prove that one argument was replaced.
 *
 * Installing twice restores the original first, so the wrapper never stacks and
 * the returned function always puts the host back the way it was found.
 */
export function patchSpawn(host: SpawnHost, hook: EndpointHook): () => void {
  const kept = host[ORIGINAL];
  const original = typeof kept === "function" ? (kept as SpawnLike) : host.spawn;
  host[ORIGINAL] = original;

  const patched: SpawnLike = function patchedSpawn(this: unknown, ...parameters: unknown[]): unknown {
    try {
      decide(parameters, hook);
    } catch (error) {
      // A spawn that goes ahead unredirected costs the user their custom key
      // for this session. A spawn that throws costs them their editor.
      logger.error("The Gemini endpoint hook threw; the language server was left alone.", error);
    }
    return original.apply(this, parameters);
  };

  host.spawn = patched;

  return () => {
    if (host.spawn === patched) host.spawn = original;
    if (host[ORIGINAL] === original) delete host[ORIGINAL];
  };
}

/**
 * Looks at one spawn and, if it is the language server, edits its arguments in
 * place. Kept apart from the wrapper so the wrapper is only about not throwing.
 */
function decide(parameters: unknown[], hook: EndpointHook): void {
  if (!isLanguageServer(parameters[0])) return;

  const args = parameters[1];
  // Antigravity always passes an array of strings. Anything else is not a
  // command line this knows how to read, so it travels as it is.
  if (!Array.isArray(args) || !args.every((value): value is string => typeof value === "string")) {
    hook.onSpawn(undefined);
    return;
  }

  const endpoint = hook.endpoint();
  if (endpoint === undefined) {
    hook.onSpawn(undefined);
    return;
  }

  const rewrite = rewriteArgs(args, endpoint);
  if (rewrite.endpoint === undefined) {
    logger.info(`The language server was spawned without ${FLAG}, so its traffic was left with Google.`);
    hook.onSpawn(undefined);
    return;
  }

  parameters[1] = rewrite.args;
  if (rewrite.replaced !== undefined) {
    logger.info(`Language server chat redirected from ${rewrite.replaced} to ${rewrite.endpoint}.`);
  }
  hook.onSpawn(rewrite.endpoint);
}

/**
 * Installs the wrapper on the builtin, for real. Both specifiers are resolved
 * because either one may be the object Antigravity's own `require` returned;
 * Node hands back the same instance for both, and the identity check below is
 * there in case some future version stops doing that.
 */
export function installEndpointHook(hook: EndpointHook): () => void {
  const load = createRequire(__filename);
  const hosts: SpawnHost[] = [];

  for (const specifier of ["node:child_process", "child_process"]) {
    let host: SpawnHost;
    try {
      host = load(specifier) as SpawnHost;
    } catch (error) {
      logger.error(`Could not reach ${specifier} to redirect the language server.`, error);
      continue;
    }
    if (typeof host?.spawn !== "function") continue;
    if (hosts.includes(host)) continue;
    hosts.push(host);
  }

  const undo = hosts.map((host) => patchSpawn(host, hook));
  return () => {
    for (const restore of undo) restore();
  };
}

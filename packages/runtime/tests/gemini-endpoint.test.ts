import { describe, expect, it } from "vitest";
import { isLanguageServer, patchSpawn, rewriteArgs, type EndpointHook, type SpawnHost } from "../src/main/gemini/endpoint.js";

const FLAG = "--cloud_code_endpoint";
const GOOGLE = "https://daily-cloudcode-pa.googleapis.com";
const OURS = "https://127.0.0.1:54321";
const BINARY = "C:\\Users\\someone\\.antigravity\\bin\\language_server_windows_x64.exe";

/** The shape of the argument list Antigravity writes, shortened. */
const hostArgs = (endpoint: string = GOOGLE): readonly string[] => ["--stdio", FLAG, endpoint, "--enable_lsp", "true"];

/** Stands in for `child_process`, so proving a rewrite starts no processes. */
function fakeHost(): { readonly host: SpawnHost; readonly calls: unknown[][] } {
  const calls: unknown[][] = [];
  const host = {
    spawn(...parameters: unknown[]): unknown {
      calls.push(parameters);
      return { pid: 4242 };
    }
  } as SpawnHost;
  return { host, calls };
}

/** A hook that answers with one endpoint and remembers what it was told. */
function fakeHook(endpoint: string | undefined): EndpointHook & { readonly seen: (string | undefined)[] } {
  const seen: (string | undefined)[] = [];
  return { endpoint: () => endpoint, onSpawn: (value) => void seen.push(value), seen };
}

describe("recognising the language server", () => {
  it.each([
    BINARY,
    "/home/someone/.antigravity/bin/language_server",
    "language_server.exe",
    "C:/x/LANGUAGE_SERVER_WINDOWS_X64.EXE"
  ])("matches %s", (file) => {
    expect(isLanguageServer(file)).toBe(true);
  });

  // The name, not the path: a folder called language_server must not volunteer
  // every binary that happens to live inside it.
  it.each(["C:/language_server/rg.exe", "/usr/bin/node", "", "my_language_server.exe"])("does not match %s", (file) => {
    expect(isLanguageServer(file)).toBe(false);
  });

  it.each([undefined, null, 42, ["language_server"]])("does not match the non-string %s", (file) => {
    expect(isLanguageServer(file)).toBe(false);
  });
});

describe("rewriting the endpoint argument", () => {
  it("replaces the value Antigravity wrote and says what it was", () => {
    const result = rewriteArgs(hostArgs(), OURS);

    expect(result.args).toEqual(["--stdio", FLAG, OURS, "--enable_lsp", "true"]);
    expect(result.endpoint).toBe(OURS);
    expect(result.replaced).toBe(GOOGLE);
  });

  it("handles the flag written as one argument", () => {
    const result = rewriteArgs(["--stdio", `${FLAG}=${GOOGLE}`], OURS);

    expect(result.args).toEqual(["--stdio", `${FLAG}=${OURS}`]);
    expect(result.replaced).toBe(GOOGLE);
  });

  it("leaves the array alone when it already says what we want", () => {
    const args = hostArgs(OURS);
    const result = rewriteArgs(args, OURS);

    expect(result.args).toBe(args);
    expect(result.endpoint).toBe(OURS);
    expect(result.replaced).toBeUndefined();
  });

  it("does not write into the array it was given", () => {
    const args = hostArgs();
    rewriteArgs(args, OURS);

    expect(args[2]).toBe(GOOGLE);
  });

  // A command line without the flag, or with it written wrongly, is one this
  // does not understand. Appending an argument a future binary might reject is
  // worse than leaving chat where Antigravity put it.
  it.each([
    ["no flag at all", ["--stdio", "--enable_lsp", "true"]],
    ["the flag last, with no value", ["--stdio", FLAG]],
    ["the flag followed by another flag", [FLAG, "--enable_lsp"]]
  ])("reports no endpoint for %s", (_case, args) => {
    const result = rewriteArgs(args, OURS);

    expect(result.endpoint).toBeUndefined();
    expect(result.args).toBe(args);
  });
});

describe("wrapping spawn", () => {
  it("redirects the language server and tells the hook where it went", () => {
    const { host, calls } = fakeHost();
    const hook = fakeHook(OURS);
    patchSpawn(host, hook);

    const options = { stdio: "pipe" };
    const child = host.spawn(BINARY, hostArgs(), options);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual(["--stdio", FLAG, OURS, "--enable_lsp", "true"]);
    // Everything else travels exactly as it was, options object and all.
    expect(calls[0]?.[0]).toBe(BINARY);
    expect(calls[0]?.[2]).toBe(options);
    expect(child).toEqual({ pid: 4242 });
    expect(hook.seen).toEqual([OURS]);
  });

  it("leaves every other process alone without a word", () => {
    const { host, calls } = fakeHost();
    const hook = fakeHook(OURS);
    patchSpawn(host, hook);

    host.spawn("C:/Windows/System32/where.exe", ["rg.exe"]);

    expect(calls[0]?.[1]).toEqual(["rg.exe"]);
    expect(hook.seen).toEqual([]);
  });

  // The feature switched off, or a listener that never came up: chat has to keep
  // working, so the argument stays as Antigravity wrote it.
  it("spawns unredirected when there is no endpoint to offer", () => {
    const { host, calls } = fakeHost();
    const hook = fakeHook(undefined);
    patchSpawn(host, hook);

    host.spawn(BINARY, hostArgs());

    expect(calls[0]?.[1]).toEqual(hostArgs());
    expect(hook.seen).toEqual([undefined]);
  });

  it("reports a spawn it could not read as unredirected", () => {
    const { host, calls } = fakeHost();
    const hook = fakeHook(OURS);
    patchSpawn(host, hook);

    host.spawn(BINARY, `${BINARY} ${FLAG} ${GOOGLE}`);

    expect(calls[0]?.[1]).toBe(`${BINARY} ${FLAG} ${GOOGLE}`);
    expect(hook.seen).toEqual([undefined]);
  });

  // A launch matters more than a redirect, so nothing the hook does may stop it.
  it("still spawns when the hook throws", () => {
    const { host, calls } = fakeHost();
    patchSpawn(host, {
      endpoint: () => {
        throw new Error("the listener exploded");
      },
      onSpawn: () => undefined
    });

    expect(() => host.spawn(BINARY, hostArgs())).not.toThrow();
    expect(calls[0]?.[1]).toEqual(hostArgs());
  });

  it("puts the module back the way it was found", () => {
    const { host } = fakeHost();
    const original = host.spawn;

    patchSpawn(host, fakeHook(OURS))();

    expect(host.spawn).toBe(original);
  });

  // Arming twice — a reload, or two plugins asking — must not stack wrappers, or
  // one launch would be rewritten as many times as the feature was armed.
  it("does not stack when installed twice", () => {
    const { host, calls } = fakeHost();
    const original = host.spawn;
    const first = fakeHook(OURS);
    const second = fakeHook(OURS);

    const undoFirst = patchSpawn(host, first);
    const undoSecond = patchSpawn(host, second);
    host.spawn(BINARY, hostArgs());

    expect(calls).toHaveLength(1);
    expect(first.seen).toEqual([]);
    expect(second.seen).toEqual([OURS]);

    undoSecond();
    undoFirst();
    expect(host.spawn).toBe(original);
  });
});

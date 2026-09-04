import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { certificateFiles, loadOrMint, writeTrustRecord } from "../src/main/gemini/certificate.js";
import { GOOGLE_BASE } from "../src/main/gemini/translate.js";
import type { GeminiConfig, GeminiStatus } from "../src/protocol.js";

interface CapturedHook {
  endpoint(): string | undefined;
  onSpawn(endpoint: string | undefined): void;
}

/**
 * The real hook wraps `child_process.spawn` for the whole process, which a test
 * has no business doing to its own runner. What matters here is the endpoint the
 * hook is willing to offer, so it is captured rather than installed.
 */
const spawns = vi.hoisted(() => ({ hooks: [] as CapturedHook[], removed: 0 }));

vi.mock("../src/main/gemini/endpoint.js", () => ({
  installEndpointHook: (hook: CapturedHook) => {
    spawns.hooks.push(hook);
    return () => {
      spawns.removed += 1;
    };
  }
}));

const { GeminiTranslator, readPreferences } = await import("../src/main/gemini/index.js");

type Translator = InstanceType<typeof GeminiTranslator>;

const SHARED = fs.mkdtempSync(path.join(os.tmpdir(), "bettergravity-translator-"));
const FILES = certificateFiles(SHARED);
/** Minting is the slow part, so every translator below reads the same authority. */
const THUMBPRINT = loadOrMint(FILES).thumbprint;

afterAll(() => fs.rmSync(SHARED, { recursive: true, force: true }));

const translators: Translator[] = [];

beforeEach(() => {
  spawns.hooks.length = 0;
  spawns.removed = 0;
  fs.rmSync(FILES.trustFile, { force: true });
});

afterEach(async () => {
  while (translators.length > 0) await translators.pop()?.dispose();
});

/** Marks the authority trusted, the way an earlier launch's install would. */
const recordTrust = () => writeTrustRecord(FILES, THUMBPRINT);

async function waitFor(translator: Translator, ready: (status: GeminiStatus) => boolean, what: string): Promise<GeminiStatus> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = translator.status();
    if (ready(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the translator never reported ${what}: ${JSON.stringify(translator.status())}`);
}

/**
 * A translator on the shared material, waited on until it is listening. The
 * platform is one Windows is not, so no PowerShell is ever started and the trust
 * record is the only thing that decides.
 */
async function armed(config?: GeminiConfig): Promise<Translator> {
  const translator = new GeminiTranslator(SHARED, "linux");
  translators.push(translator);
  translator.arm(config);
  await waitFor(translator, (status) => status.port !== undefined, "a port");
  return translator;
}

const hook = (): CapturedHook => {
  const captured = spawns.hooks[0];
  if (!captured) throw new Error("the endpoint hook was never installed");
  return captured;
};

/** Proves whether anything is still listening on a port. */
function connect(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.on("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.on("error", (cause) => reject(cause));
  });
}

describe("reading a plugin's preferences", () => {
  it("starts from the defaults that change nothing", () => {
    expect(readPreferences(undefined)).toEqual({
      apiKey: "",
      base: GOOGLE_BASE,
      stream: true,
      thoughts: true,
      bypass: false,
      audit: false
    });
  });

  it("trims a pasted key", () => {
    expect(readPreferences({ apiKey: "  AIzaSy-pasted  " }).apiKey).toBe("AIzaSy-pasted");
  });

  it("reads a base URL, and falls back to Google when it cannot", () => {
    expect(readPreferences({ baseUrl: "https://relay.example.test/gemini/" }).base).toMatchObject({
      host: "relay.example.test",
      prefix: "/gemini",
      problem: undefined
    });
    expect(readPreferences({ baseUrl: "not-an-address" }).base).toMatchObject({
      host: GOOGLE_BASE.host,
      problem: expect.stringContaining("generativelanguage.googleapis.com")
    });
  });

  it("keeps what was set before rather than reverting to a default", () => {
    const previous = readPreferences({ apiKey: "AIzaSy-one", stream: false, audit: true });

    expect(readPreferences({}, previous)).toEqual(previous);
  });

  it("ignores a value of the wrong type", () => {
    const previous = readPreferences({ apiKey: "AIzaSy-one", thoughts: true });
    const next = readPreferences({ apiKey: 7, thoughts: "yes" } as unknown as GeminiConfig, previous);

    expect(next.apiKey).toBe("AIzaSy-one");
    expect(next.thoughts).toBe(true);
  });
});

describe("arming the translator", () => {
  it("mints the certificate and opens a loopback port", async () => {
    const translator = await armed({});
    const status = translator.status();

    expect(fs.existsSync(FILES.authorityCer)).toBe(true);
    expect(status.thumbprint).toBe(THUMBPRINT);
    expect(status.port).toBeGreaterThan(0);
  });

  // Redirecting to a certificate the language server does not trust ends in a
  // refused handshake, which is worse than chat carrying on through Google. On a
  // platform with no store to install into, that is as far as the feature goes.
  it("offers no address at all while the authority is not in the store", async () => {
    const translator = await armed({ apiKey: "AIzaSy-test" });

    const status = await waitFor(translator, (value) => value.phase === "blocked", "an unreachable store");

    expect(hook().endpoint()).toBeUndefined();
    expect(status.trusted).toBe(false);
    expect(status.message).toMatch(/only be installed on Windows/);
    expect(status.restartRequired).toBe(false);
  });

  it("offers the loopback address once the certificate is trusted", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test" });
    const status = translator.status();

    expect(hook().endpoint()).toBe(`https://127.0.0.1:${status.port}`);
    expect(status).toMatchObject({ phase: "listening", trusted: true, keyed: true, restartRequired: true });
  });

  it("reports routing once the language server has been given that address", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test" });

    hook().onSpawn(hook().endpoint());

    expect(translator.status()).toMatchObject({ phase: "routing", restartRequired: false });
    // Where the requests end up, which is the useful half; the loopback port in
    // between is BetterGravity's own business.
    expect(translator.status().message).toContain("generativelanguage.googleapis.com");
  });

  it("names a base URL of one's own while routing, and complains about a bad one", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test", baseUrl: "https://relay.example.test/gemini" });
    hook().onSpawn(hook().endpoint());

    expect(translator.status().message).toContain("https://relay.example.test/gemini");

    const status = translator.configure({ baseUrl: "http://relay.example.test" });

    expect(status.phase).toBe("routing");
    expect(status.message).toContain("unencrypted");
  });

  it("asks for a restart when the language server started without it", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test" });

    hook().onSpawn(undefined);

    expect(translator.status()).toMatchObject({ phase: "listening", restartRequired: true });
  });

  // The route deliberately does not depend on the key: requests pass through
  // untouched without one, so a key pasted later needs no second restart.
  it("routes with no key set, and says chat is on the bundled subscription", async () => {
    recordTrust();
    const translator = await armed({});

    expect(hook().endpoint()).toBe(`https://127.0.0.1:${translator.status().port}`);
    expect(translator.status()).toMatchObject({ phase: "off", keyed: false });
    expect(translator.status().message).toMatch(/bundled subscription/);
  });

  it("keeps the key out of everything the panel can see", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-secret-key-value" });

    expect(JSON.stringify(translator.status())).not.toContain("AIzaSy-secret-key-value");
    expect(translator.status().keyed).toBe(true);
  });

  it("reports the comparison switch as not routing", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test" });

    const status = translator.configure({ bypass: true });

    expect(status.phase).toBe("off");
    expect(status.message).toMatch(/untranslated/);
  });

  // Switching the plugin on with Antigravity already running arrives through
  // configure, never through arm, so that is the second way in.
  it("arms itself when the plugin is switched on after launch", async () => {
    recordTrust();
    const translator = new GeminiTranslator(SHARED, "linux");
    translators.push(translator);

    translator.configure({ apiKey: "AIzaSy-late" });

    expect(spawns.hooks).toHaveLength(1);
    const status = await waitFor(translator, (value) => value.port !== undefined, "a port");
    expect(status.thumbprint).toBe(THUMBPRINT);
  });

  // A request publishes a status for the counts, so a panel told about every
  // publication would be told a great many times over.
  it("only tells the panel when the panel would look different", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test" });
    const seen: GeminiStatus[] = [];
    const stop = translator.onStatusChanged((status) => void seen.push(status));

    translator.configure({ bypass: true });
    translator.configure({ bypass: true });

    expect(seen).toHaveLength(1);

    stop();
    translator.configure({ bypass: false });

    expect(seen).toHaveLength(1);
  });
});

describe("switching the plugin off and on", () => {
  // Off has to mean off immediately. The listener cannot close — the language
  // server is already talking to it and its address cannot be unwritten — so it
  // stays up and forwards untranslated, which is chat back on the subscription.
  it("forwards untranslated the moment it is switched off", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test" });
    hook().onSpawn(hook().endpoint());
    expect(translator.status().phase).toBe("routing");

    const status = translator.suspend();

    expect(status.phase).toBe("off");
    expect(status.message).toMatch(/switched off/);
    expect(status.restartRequired).toBe(false);
    // Still answering where it said it would, because it is still answering.
    expect(hook().endpoint()).toBe(`https://127.0.0.1:${status.port ?? 0}`);
  });

  it("translates again when it is switched back on, with no restart", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test" });
    hook().onSpawn(hook().endpoint());
    translator.suspend();

    const status = translator.resume(() => ({ apiKey: "AIzaSy-test" }));

    expect(status.phase).toBe("routing");
    expect(status.restartRequired).toBe(false);
  });

  // A plugin switched on mid-session has no script running yet, so the settings
  // it saved last time are the only ones there are.
  it("arms itself from the saved settings when it was never armed", async () => {
    recordTrust();
    const translator = new GeminiTranslator(SHARED, "linux");
    translators.push(translator);

    translator.resume(() => ({ apiKey: "AIzaSy-saved" }));

    const status = await waitFor(translator, (value) => value.port !== undefined, "a port");
    expect(status).toMatchObject({ keyed: true, phase: "listening" });
  });

  it("has nothing to switch off when it was never armed", () => {
    const translator = new GeminiTranslator(SHARED, "linux");
    translators.push(translator);

    expect(translator.suspend().phase).toBe("off");
    expect(translator.status().message).toBeUndefined();
    expect(spawns.hooks).toHaveLength(0);
  });
});

describe("shutting down", () => {
  it("takes the wrapper off and closes the port", async () => {
    recordTrust();
    const translator = await armed({ apiKey: "AIzaSy-test" });
    const port = translator.status().port;
    if (port === undefined) throw new Error("the translator never reported a port");
    await expect(connect(port)).resolves.toBeUndefined();

    await translator.dispose();

    expect(spawns.removed).toBe(1);
    await expect(connect(port)).rejects.toThrow();
  });
});

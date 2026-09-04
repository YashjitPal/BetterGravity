/**
 * The certificate installing and retiring itself, which is the part no user is
 * asked about any more: switching the plugin on adds the authority to the store,
 * a launch with nothing asking for the translator takes it back out.
 *
 * The store is PowerShell on Windows and nothing at all anywhere else, so it is
 * faked here — a set of thumbprints, with a record of what was asked of it. Only
 * the three trust functions are replaced; the certificate itself is minted for
 * real, so the thumbprint that travels through all of this is a real one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CertificateFiles } from "../src/main/gemini/certificate.js";
import type { GeminiConfig, GeminiStatus } from "../src/protocol.js";

interface CapturedHook {
  endpoint(): string | undefined;
  onSpawn(endpoint: string | undefined): void;
}

const spawns = vi.hoisted(() => ({ hooks: [] as CapturedHook[] }));

vi.mock("../src/main/gemini/endpoint.js", () => ({
  installEndpointHook: (hook: CapturedHook) => {
    spawns.hooks.push(hook);
    return () => {};
  }
}));

/** The trust store, as far as anything under test can tell. */
const store = vi.hoisted(() => ({
  present: new Set<string>(),
  installs: [] as string[],
  removals: [] as string[],
  /** Whether the store refuses what it is given, which Windows sometimes does. */
  refuse: false
}));

vi.mock("../src/main/gemini/certificate.js", async () => {
  const actual = await vi.importActual<typeof import("../src/main/gemini/certificate.js")>(
    "../src/main/gemini/certificate.js"
  );
  return {
    ...actual,
    checkTrust: async (thumbprint: string) => (store.present.has(thumbprint) ? "trusted" : "untrusted"),
    installTrust: async (files: CertificateFiles, thumbprint: string) => {
      store.installs.push(thumbprint);
      if (store.refuse) {
        actual.forgetTrustRecord(files);
        return { state: "untrusted", message: "Windows did not accept the certificate." };
      }
      store.present.add(thumbprint);
      actual.writeTrustRecord(files, thumbprint);
      return { state: "trusted", message: "The certificate is trusted for your account." };
    },
    removeTrust: async (files: CertificateFiles, thumbprint: string) => {
      store.removals.push(thumbprint);
      store.present.delete(thumbprint);
      actual.forgetTrustRecord(files);
      return { state: "untrusted", message: "The certificate is no longer trusted." };
    }
  };
});

const { certificateFiles, loadOrMint, readTrustRecord, writeTrustRecord } = await import(
  "../src/main/gemini/certificate.js"
);
const { GeminiTranslator } = await import("../src/main/gemini/index.js");

type Translator = InstanceType<typeof GeminiTranslator>;

const SHARED = fs.mkdtempSync(path.join(os.tmpdir(), "bettergravity-autotrust-"));
const FILES = certificateFiles(SHARED);
const THUMBPRINT = loadOrMint(FILES).thumbprint;

afterAll(() => fs.rmSync(SHARED, { recursive: true, force: true }));

const translators: Translator[] = [];

beforeEach(() => {
  spawns.hooks.length = 0;
  store.present.clear();
  store.installs.length = 0;
  store.removals.length = 0;
  store.refuse = false;
  fs.rmSync(FILES.trustFile, { force: true });
});

afterEach(async () => {
  while (translators.length > 0) await translators.pop()?.dispose();
});

async function waitFor(translator: Translator, ready: (status: GeminiStatus) => boolean, what: string): Promise<GeminiStatus> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = translator.status();
    if (ready(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the translator never reported ${what}: ${JSON.stringify(translator.status())}`);
}

/** Long enough for the background trust work to have finished, or not started. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Windows, because that is the platform the store belongs to. */
function translator(): Translator {
  const made = new GeminiTranslator(SHARED, "win32");
  translators.push(made);
  return made;
}

async function armed(config?: GeminiConfig): Promise<Translator> {
  const made = translator();
  made.arm(config);
  await waitFor(made, (status) => status.port !== undefined, "a port");
  return made;
}

const hook = (): CapturedHook => {
  const captured = spawns.hooks[0];
  if (!captured) throw new Error("the endpoint hook was never installed");
  return captured;
};

describe("installing the authority", () => {
  // Switching the plugin on is the authorisation. A button asking for it again
  // would only be asking the same question twice.
  it("adds the authority to the store as soon as the translator is armed", async () => {
    const made = await armed({ apiKey: "AIzaSy-test" });

    const status = await waitFor(made, (value) => value.trusted, "a trusted authority");

    expect(store.installs).toEqual([THUMBPRINT]);
    expect(readTrustRecord(FILES)?.thumbprint).toBe(THUMBPRINT);
    // Trusted, but the language server started before it was: one restart left.
    expect(status).toMatchObject({ phase: "listening", restartRequired: true });
    expect(hook().endpoint()).toBe(`https://127.0.0.1:${status.port ?? 0}`);
  });

  it("leaves the store alone when the authority is already in it", async () => {
    store.present.add(THUMBPRINT);
    writeTrustRecord(FILES, THUMBPRINT);

    const made = await armed({ apiKey: "AIzaSy-test" });
    await settle();

    expect(store.installs).toEqual([]);
    expect(made.status().trusted).toBe(true);
  });

  // Everything else about the feature looks healthy in this state, so the one
  // thing that is wrong has to be said out loud.
  it("says so when the store will not take the authority", async () => {
    store.refuse = true;
    const made = await armed({ apiKey: "AIzaSy-test" });

    const status = await waitFor(made, (value) => value.phase === "blocked", "a refusal");

    expect(status.message).toMatch(/did not accept/);
    expect(status.trusted).toBe(false);
    expect(status.restartRequired).toBe(false);
    expect(hook().endpoint()).toBeUndefined();
  });

  // A record left behind by a certificate someone deleted by hand would route the
  // language server at a certificate it will refuse, so the store has the last word.
  it("corrects a record the store disagrees with", async () => {
    writeTrustRecord(FILES, THUMBPRINT);
    store.refuse = true;

    const made = await armed({ apiKey: "AIzaSy-test" });

    const status = await waitFor(made, (value) => value.phase === "blocked", "a corrected record");
    expect(status.trusted).toBe(false);
    expect(readTrustRecord(FILES)).toBeUndefined();
  });
});

describe("retiring the authority", () => {
  // The one change this feature makes outside its own directory has to come back
  // out when nothing wants it, and launch is the only safe moment: no language
  // server has been pointed at a certificate signed by it yet.
  it("takes the authority out when nothing asks for the translator", async () => {
    store.present.add(THUMBPRINT);
    writeTrustRecord(FILES, THUMBPRINT);
    const made = translator();

    await made.retire();

    expect(store.removals).toEqual([THUMBPRINT]);
    expect(store.present.has(THUMBPRINT)).toBe(false);
    expect(readTrustRecord(FILES)).toBeUndefined();
  });

  // Asking Windows about a certificate that was never installed costs a
  // PowerShell at every launch for nothing.
  it("does not go looking for a certificate that was never installed", async () => {
    const made = translator();

    await made.retire();

    expect(store.removals).toEqual([]);
  });

  it("keeps the authority while a plugin still asks for it", async () => {
    store.present.add(THUMBPRINT);
    writeTrustRecord(FILES, THUMBPRINT);
    const made = await armed({ apiKey: "AIzaSy-test" });

    await made.retire();

    expect(store.removals).toEqual([]);
    expect(made.status().trusted).toBe(true);
  });
});

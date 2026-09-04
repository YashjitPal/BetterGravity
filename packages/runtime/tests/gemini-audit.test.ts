import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog, redact, type AuditEntry } from "../src/main/gemini/audit.js";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bettergravity-audit-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  while (directories.length > 0) fs.rmSync(directories.pop()!, { recursive: true, force: true });
});

const entry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  mode: "stream",
  srcEnum: "MODEL_GEMINI_3_PRO",
  model: "gemini-3-pro-preview",
  thinkingLevel: "low",
  thinkingBudget: null,
  includeThoughts: false,
  status: 200,
  latencyMs: 1234,
  error: undefined,
  ...overrides
});

/** The log as objects, one per line. */
function lines(file: string): Record<string, unknown>[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** An opened, enabled log and the file it writes to. */
function openLog(): { readonly log: AuditLog; readonly file: string } {
  const directory = temporaryDirectory();
  const log = new AuditLog();
  log.open(directory);
  log.setEnabled(true);
  return { log, file: path.join(directory, "api-calls.jsonl") };
}

describe("keeping credentials out of the log", () => {
  it("removes a Google API key", () => {
    expect(redact("quota exceeded for key AIzaSyB1cD3fGh4jKl5mN6oPqRsTuV")).toBe("quota exceeded for key AIza…");
  });

  it.each([
    ["?key=", "GET /v1beta/models?key=AIzaSyB1cD3fGh4jKl5mN&alt=sse", "GET /v1beta/models?key=…&alt=sse"],
    ["&api_key=", "/v1?alt=sse&api_key=sk-1234567890abcdef", "/v1?alt=sse&api_key=…"],
    ["&access_token=", "/v1?x=1&access_token=ya29.abcdefghijklmnop", "/v1?x=1&access_token=…"]
  ])("removes a %s parameter", (_case, text, expected) => {
    expect(redact(text)).toBe(expected);
  });

  it.each([
    ["Bearer ya29.a0AfH6SMBabcdefghijkl", "Bearer …"],
    ["Basic YWxhZGRpbjpvcGVuc2VzYW1l", "Basic …"]
  ])("removes %s authorisation", (text, expected) => {
    expect(redact(`rejected: ${text}`)).toBe(`rejected: ${expected}`);
  });

  it("leaves an ordinary message alone", () => {
    expect(redact("429 RESOURCE_EXHAUSTED: quota exceeded")).toBe("429 RESOURCE_EXHAUSTED: quota exceeded");
  });

  it("keeps a long upstream message to a readable length", () => {
    expect(redact("x".repeat(5000))).toHaveLength(300);
  });
});

describe("the request log", () => {
  it("knows where it would write before it has written anything", () => {
    const directory = temporaryDirectory();
    const log = new AuditLog();

    expect(log.path).toBeUndefined();
    log.open(directory);

    expect(log.path).toBe(path.join(directory, "api-calls.jsonl"));
    // Opening is a decision about where, not a file on disk: someone who never
    // switches this on never has a request log.
    expect(fs.existsSync(path.join(directory, "api-calls.jsonl"))).toBe(false);
  });

  it("writes nothing at all while it is off", () => {
    const { log, file } = openLog();
    log.setEnabled(false);

    log.record(entry());

    expect(fs.existsSync(file)).toBe(false);
  });

  it("records one line per request", () => {
    const { log, file } = openLog();

    log.record(entry(), new Date("2026-09-04T08:00:00.000Z"));
    log.record(entry({ mode: "passthrough", model: "", status: 200 }));

    const written = lines(file);
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({
      ts: "2026-09-04T08:00:00.000Z",
      mode: "stream",
      srcEnum: "MODEL_GEMINI_3_PRO",
      model: "gemini-3-pro-preview",
      thinkingLevel: "low",
      thinkingBudget: null,
      includeThoughts: false,
      status: 200,
      latencyMs: 1234
    });
    expect(written[1]).toMatchObject({ mode: "passthrough", model: "" });
  });

  it("leaves the error out when there was none", () => {
    const { log, file } = openLog();

    log.record(entry());

    expect(lines(file)[0]).not.toHaveProperty("error");
  });

  // The key travels in a header and is never interpolated into a message, so
  // this is the second line of defence: an upstream error that quotes back more
  // than it should still cannot leave a key on the disk.
  it("redacts what an upstream error quoted back", () => {
    const { log, file } = openLog();

    log.record(entry({ status: 400, error: "API key not valid: AIzaSyB1cD3fGh4jKl5mN6oPqRsTuV" }));

    const written = lines(file)[0];
    expect(written?.["error"]).toBe("API key not valid: AIza…");
    expect(fs.readFileSync(file, "utf8")).not.toContain("AIzaSyB1cD3fGh4jKl5mN6oPqRsTuV");
  });

  it("creates its directory when the first request arrives", () => {
    const directory = path.join(temporaryDirectory(), "gemini");
    const log = new AuditLog();
    log.open(directory);
    log.setEnabled(true);

    log.record(entry());

    expect(lines(path.join(directory, "api-calls.jsonl"))).toHaveLength(1);
  });

  it("keeps one previous generation once it grows too large", () => {
    const { log, file } = openLog();
    fs.writeFileSync(file, `${"x".repeat(2 * 1024 * 1024)}\n`);

    log.record(entry());

    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(lines(file)).toHaveLength(1);
  });

  it("forgets both generations when asked", () => {
    const { log, file } = openLog();
    log.record(entry());
    fs.writeFileSync(`${file}.1`, "{}\n");

    log.clear();

    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.1`)).toBe(false);
  });

  it("does nothing when it was never told where to write", () => {
    const log = new AuditLog();
    log.setEnabled(true);

    expect(() => log.record(entry())).not.toThrow();
    expect(() => log.clear()).not.toThrow();
  });
});

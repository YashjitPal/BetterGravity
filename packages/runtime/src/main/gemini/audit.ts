/**
 * A record of what the translator sent where, kept so a chat that came back
 * wrong can be explained.
 *
 * One line of JSON per request. What is recorded is deliberately thin: which
 * model Antigravity asked for, which one the key was asked for, how much
 * thinking, the status, and how long it took. The prompt is not in here, the
 * answer is not in here, and neither is the key — the point is to be able to
 * see that a request went to `gemini-3.5-flash` and came back 429, not to keep
 * a copy of the conversation.
 *
 * It lives beside the certificate material in `%APPDATA%`, never in the
 * repository, and it is off unless the settings panel turns it on.
 */

import fs from "node:fs";
import path from "node:path";

/** Two megabytes is a few thousand requests: enough to explain yesterday. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Long enough for the useful part of an upstream message. */
const MAX_ERROR_CHARS = 300;

export type AuditMode = "stream" | "buffered" | "passthrough" | "catalog";

export interface AuditEntry {
  readonly mode: AuditMode;
  /** The enum Antigravity's picker sent, which is what the user chose. */
  readonly srcEnum: string;
  /** The public model it was translated to, or empty for a passthrough. */
  readonly model: string;
  readonly thinkingLevel: string | null;
  readonly thinkingBudget: number | null;
  readonly includeThoughts: boolean;
  /** Zero when the request never reached upstream at all. */
  readonly status: number;
  readonly latencyMs: number;
  readonly error: string | undefined;
}

/**
 * Anything that looks like a credential, gone before it reaches the disk. No
 * path here is meant to carry one — the key travels in a header and is never
 * interpolated into a message — so this is the second line of defence behind
 * that, for an upstream error that quotes back more than it should.
 */
export function redact(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIza…")
    .replace(/([?&](?:key|api_key|access_token)=)[^&\s]+/gi, "$1…")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 …")
    .slice(0, MAX_ERROR_CHARS);
}

export class AuditLog {
  private file: string | undefined;
  private enabled = false;

  /** Where the log would go. Nothing is created until something is recorded. */
  open(directory: string): void {
    this.file = path.join(directory, "api-calls.jsonl");
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get path(): string | undefined {
    return this.file;
  }

  /**
   * Appends one entry, rotating first if the file has grown past the cap. A
   * failure here is swallowed: an audit line is worth less than the request it
   * describes.
   */
  record(entry: AuditEntry, now: Date = new Date()): void {
    const file = this.file;
    if (!this.enabled || !file) return;
    try {
      this.rotateIfLarge(file);
      const line = {
        ts: now.toISOString(),
        mode: entry.mode,
        srcEnum: entry.srcEnum,
        model: entry.model,
        thinkingLevel: entry.thinkingLevel,
        thinkingBudget: entry.thinkingBudget,
        includeThoughts: entry.includeThoughts,
        status: entry.status,
        latencyMs: entry.latencyMs,
        ...(entry.error === undefined ? {} : { error: redact(entry.error) })
      };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    } catch {
      // A full or locked disk must not cost the user their chat.
    }
  }

  /** Keeps one previous generation, so rotating does not throw away today. */
  private rotateIfLarge(file: string): void {
    try {
      if (fs.statSync(file).size < MAX_BYTES) return;
      fs.rmSync(`${file}.1`, { force: true });
      fs.renameSync(file, `${file}.1`);
    } catch {
      // Missing file on the first write, which is the ordinary case.
    }
  }

  /** Removes both generations, for the "forget what I did" button. */
  clear(): void {
    const file = this.file;
    if (!file) return;
    try {
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}.1`, { force: true });
    } catch {
      // Nothing to do about a locked file but leave it.
    }
  }
}

import fs from "node:fs";
import path from "node:path";
import type { AccountProfile } from "../protocol.js";

/**
 * Reads the name on the Google account Antigravity is signed in with.
 *
 * Antigravity's own state does not have it. The application knows the address the
 * user signed in with — that is what its language server reports back — and
 * nothing else; there is no display name anywhere in the bundle. The name exists
 * on the machine all the same, because Antigravity signs in through a real
 * Chromium profile of its own, and Chromium writes Google's answer into that
 * profile's `Preferences` as `account_info`.
 *
 * So this reads a browser profile, deliberately: it is where the fact is. Only
 * the name is returned; see {@link AccountProfile} for why.
 */

/** Chromium's own settings file for the profile Antigravity signs in through. */
const PREFERENCES = [".gemini", "antigravity-browser-profile", "Default", "Preferences"];

/** Which of several signed-in accounts Antigravity is currently using. */
const ACTIVE_ACCOUNT = [".gemini", "google_accounts.json"];

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Missing, half-written, or not ours to understand. All three mean the same
    // thing to a caller: no name is available.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function readAccountProfile(homeDirectory: string): AccountProfile {
  const preferences = readJson(path.join(homeDirectory, ...PREFERENCES));
  if (!isRecord(preferences)) return {};

  const accounts = preferences["account_info"];
  const entries = Array.isArray(accounts) ? accounts.filter(isRecord) : [];
  if (entries.length === 0) return {};

  // More than one Google account can be signed into the same profile, and the one
  // Antigravity is using is recorded separately. Matching on it is the difference
  // between "the account the user logged in with" and "whichever account Chromium
  // happened to write down first".
  const active = readJson(path.join(homeDirectory, ...ACTIVE_ACCOUNT));
  const wanted = isRecord(active) ? text(active, "active")?.toLowerCase() : undefined;
  const chosen =
    (wanted === undefined
      ? undefined
      : entries.find((entry) => text(entry, "email")?.toLowerCase() === wanted)) ?? entries[0];
  if (chosen === undefined) return {};

  const fullName = text(chosen, "full_name");
  // Google supplies the given name itself, so splitting the full name is only a
  // fallback for a record written before it did.
  const firstName = text(chosen, "given_name") ?? fullName?.split(/\s+/)[0];
  const email = text(chosen, "email");
  const pictureUrl = text(chosen, "picture_url") ?? text(chosen, "last_downloaded_image_url_with_size");

  return {
    ...(firstName === undefined ? {} : { firstName }),
    ...(fullName === undefined ? {} : { fullName }),
    ...(email === undefined ? {} : { email }),
    ...(pictureUrl === undefined ? {} : { pictureUrl })
  };
}

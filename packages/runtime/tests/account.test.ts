import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAccountProfile } from "../src/main/account.js";

let home: string;

const PROFILE = [".gemini", "antigravity-browser-profile", "Default"];

function writePreferences(value: unknown): void {
  const directory = path.join(home, ...PROFILE);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "Preferences"), typeof value === "string" ? value : JSON.stringify(value));
}

function writeActiveAccount(email: string): void {
  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
  fs.writeFileSync(path.join(home, ".gemini", "google_accounts.json"), JSON.stringify({ active: email, old: [] }));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bg-account-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("readAccountProfile", () => {
  it("reads the name Google recorded for the signed-in account", () => {
    writePreferences({
      account_info: [{ email: "ada@example.com", given_name: "Ada", full_name: "Ada Lovelace", gaia: "1" }]
    });

    expect(readAccountProfile(home)).toEqual({ firstName: "Ada", fullName: "Ada Lovelace", email: "ada@example.com" });
  });

  it("carries picture url and email when the profile holds them", () => {
    writePreferences({
      account_info: [{ email: "ada@example.com", given_name: "Ada", full_name: "Ada Lovelace", picture_url: "https://x/y" }]
    });

    expect(readAccountProfile(home)).toEqual({
      firstName: "Ada",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      pictureUrl: "https://x/y"
    });
  });

  it("picks the account Antigravity is actually using, not the first one written down", () => {
    writePreferences({
      account_info: [
        { email: "old@example.com", given_name: "Charles", full_name: "Charles Babbage" },
        { email: "ada@example.com", given_name: "Ada", full_name: "Ada Lovelace" }
      ]
    });
    writeActiveAccount("Ada@Example.com");

    expect(readAccountProfile(home).firstName).toBe("Ada");
  });

  it("falls back to the first account when the active one is not in the profile", () => {
    writePreferences({ account_info: [{ email: "ada@example.com", given_name: "Ada" }] });
    writeActiveAccount("someone@example.com");

    expect(readAccountProfile(home).firstName).toBe("Ada");
  });

  it("splits the full name when the record predates given_name", () => {
    writePreferences({ account_info: [{ email: "ada@example.com", full_name: "Ada Lovelace" }] });

    expect(readAccountProfile(home)).toEqual({ firstName: "Ada", fullName: "Ada Lovelace", email: "ada@example.com" });
  });

  it("reports no name rather than throwing when there is nothing to read", () => {
    expect(readAccountProfile(home)).toEqual({});

    writePreferences("{ not json");
    expect(readAccountProfile(home)).toEqual({});

    writePreferences({ account_info: [] });
    expect(readAccountProfile(home)).toEqual({});

    writePreferences({ account_info: [{ given_name: "   " }] });
    expect(readAccountProfile(home)).toEqual({});
  });
});

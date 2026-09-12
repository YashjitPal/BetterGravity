import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserRegistration, readObject, writeObject } from "../src/main/browser/registration.js";
import { BrowserHttpBridge } from "../src/main/browser/bridge.js";
import { browserUrl } from "../src/main/browser/url.js";
import { validateSchema } from "../src/main/browser/commands.js";

let directory: string;
let registration: BrowserRegistration;
const bridges: BrowserHttpBridge[] = [];

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "bg-browser-registration-"));
  registration = new BrowserRegistration(path.join(directory, "plugins"), path.join(directory, "home"), path.join(directory, "data"));
  for (const file of ["plugin.json", "index.js", "styles/browser.css", "mcp-server.cjs", "scripts/browser-client.mjs", "vendor/api.json", "vendor/codex-browser-client.mjs", "vendor/command-contracts.json", "vendor/playwright-injected.js", "skills/in-built-browser/SKILL.md"]) {
    const target = path.join(registration.pluginDirectory, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, "{}");
  }
});
afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("bg-browser-registration-")) throw new Error("Unexpected browser test directory.");
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("browser plugin registration", () => {
  it("does not create any skill or tool registration while disabled", () => {
    registration.sync(false);
    expect(fs.existsSync(registration.mcpConfig)).toBe(false);
    expect(fs.existsSync(registration.skillsConfig)).toBe(false);
    expect(fs.existsSync(registration.descriptorFile)).toBe(false);
  });

  it("registers idempotently and removes only browser entries on disable", () => {
    const other = { command: "node", args: ["other-server.cjs"], env: { EXAMPLE: "preserved" } };
    writeObject(registration.mcpConfig, { mcpServers: { other }, custom: 7 });
    writeObject(registration.skillsConfig, { entries: [{ path: "C:/other/skills" }], custom: true });
    registration.sync(true); registration.sync(true);
    expect(readObject(registration.mcpConfig)).toMatchObject({ custom: 7, mcpServers: { other, "in-built-browser": { command: "node", args: [registration.serverScript, "--bridge", registration.descriptorFile] } } });
    expect(readObject(registration.skillsConfig).entries).toEqual([{ path: "C:/other/skills" }, { path: registration.skillDirectory }]);
    writeObject(registration.descriptorFile, { url: "http://127.0.0.1:9", token: "fixture" });
    registration.revoke(); registration.sync(false);
    expect(readObject(registration.mcpConfig)).toEqual({ custom: 7, mcpServers: { other } });
    expect(readObject(registration.skillsConfig)).toEqual({ custom: true, entries: [{ path: "C:/other/skills" }] });
    expect(fs.existsSync(registration.descriptorFile)).toBe(false);
  });

  it("validates both configs before mutation and preserves malformed documents", () => {
    writeObject(registration.mcpConfig, { mcpServers: { existing: {} } });
    fs.writeFileSync(registration.skillsConfig, "{invalid");
    expect(() => registration.sync(true)).toThrow();
    expect(readObject(registration.mcpConfig)).toEqual({ mcpServers: { existing: {} } });
    expect(fs.readFileSync(registration.skillsConfig, "utf8")).toBe("{invalid");
  });

  it("does not overwrite a foreign server with the same name", () => {
    writeObject(registration.mcpConfig, { mcpServers: { "in-built-browser": { command: "custom", args: ["foreign"] } } });
    expect(() => registration.sync(true)).toThrow("Another MCP server");
    registration.sync(false);
    expect(readObject(registration.mcpConfig)).toEqual({ mcpServers: { "in-built-browser": { command: "custom", args: ["foreign"] } } });
  });
});

it("authenticates the loopback bridge, rejects webpage requests, and refuses stale calls", async () => {
  const target = { isEnabled: true, tools: () => [{ name: "list_browsers" }], execute: async () => ["owned-browser"] };
  const bridge = new BrowserHttpBridge(target); bridges.push(bridge);
  const url = await bridge.start();
  const headers = { Authorization: `Bearer ${bridge.token}` };
  expect((await fetch(`${url}/tools`)).status).toBe(403);
  expect((await fetch(`${url}/tools`, { headers: { ...headers, Origin: "https://example.com" } })).status).toBe(403);
  const reboundStatus = await new Promise(resolve => http.get(`${url}/tools`, { headers: { ...headers, Host: "attacker.example:80" } }, response => { response.resume(); resolve(response.statusCode); }));
  expect(reboundStatus).toBe(403);
  expect(await (await fetch(`${url}/tools`, { headers })).json()).toEqual({ tools: [{ name: "list_browsers" }] });
  expect(await (await fetch(`${url}/command`, { method: "POST", headers, body: JSON.stringify({ command: "list_browsers", args: {} }) })).json()).toEqual({ value: ["owned-browser"] });
  target.isEnabled = false;
  expect((await fetch(`${url}/command`, { method: "POST", headers, body: JSON.stringify({ command: "list_browsers", args: {} }) })).status).toBe(410);
});

it("normalizes local development URLs and rejects executable schemes and credential URLs", () => {
  expect(browserUrl("localhost:3000/settings")).toBe("http://localhost:3000/settings");
  expect(browserUrl("127.0.0.1:5173")).toBe("http://127.0.0.1:5173/");
  expect(browserUrl("[::1]:8080")).toBe("http://[::1]:8080/");
  expect(browserUrl("example.com")).toBe("https://example.com/");
  expect(browserUrl("layout examples", true)).toBe("https://www.google.com/search?q=layout%20examples");
  for (const url of ["javascript:alert(1)", "data:text/html,<h1>bad</h1>", "chrome://settings", "https://user:secret@example.com", "file:///C:/project/.env", "file:///C:/project/.env.local"]) expect(() => browserUrl(url)).toThrow();
});

it("validates extracted command contracts before reaching native input", () => {
  const schema = { type: "object", required: ["x", "button"], additionalProperties: false, properties: { x: { type: "number", minimum: 0 }, button: { enum: ["left", "right"] } } };
  expect(() => validateSchema(schema, { x: 10, button: "left" })).not.toThrow();
  expect(() => validateSchema(schema, { x: NaN, button: "left" })).toThrow();
  expect(() => validateSchema(schema, { x: 10, button: "wrong" })).toThrow();
  expect(() => validateSchema(schema, { x: 10, button: "left", host: true })).toThrow();
});

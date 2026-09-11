import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/protocol.js";
import { ComputerUseService } from "../src/main/computer-use.js";

let temporary: string;
let service: ComputerUseService;
let skillsConfigFile: string;
let mcpConfigFile: string;

const enabled = { ...DEFAULT_SETTINGS, plugins: { developerMode: true, enabled: ["computer-use"] } };
const disabled = { ...enabled, plugins: { ...enabled.plugins, enabled: [] } };

function json(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bg-cu-test-"));
  const pluginsDir = path.join(temporary, "plugins");
  const homeDir = path.join(temporary, "home");
  service = new ComputerUseService(pluginsDir, homeDir, 51839);
  skillsConfigFile = path.join(homeDir, ".gemini", "config", "skills.json");
  mcpConfigFile = path.join(homeDir, ".gemini", "config", "mcp_config.json");

  // Create plugin files
  fs.mkdirSync(path.join(service.skillDirectory, "computer-use"), { recursive: true });
  fs.writeFileSync(
    path.join(service.skillDirectory, "computer-use", "SKILL.md"),
    "---\nname: computer-use\ndescription: Windows computer use\n---\n"
  );
  fs.mkdirSync(path.dirname(service.mcpServerScript), { recursive: true });
  fs.writeFileSync(service.mcpServerScript, "// mcp server mock\n");
});

afterEach(() => {
  service.dispose();
  fs.rmSync(temporary, { recursive: true, force: true });
});

describe("ComputerUseService registration", () => {
  it("registers once, preserves other skills & servers, and unregisters cleanly", () => {
    const otherSkill = { path: "C:/other/skills" };
    json(skillsConfigFile, { entries: [otherSkill] });

    const otherMcp = { command: "npx", args: ["my-server"] };
    json(mcpConfigFile, { mcpServers: { "existing-mcp": otherMcp } });

    service.sync(enabled);
    service.sync(enabled); // Idempotent

    const skillsData = JSON.parse(fs.readFileSync(skillsConfigFile, "utf8"));
    expect(skillsData.entries).toEqual([otherSkill, { path: service.skillDirectory }]);

    const mcpData = JSON.parse(fs.readFileSync(mcpConfigFile, "utf8"));
    expect(mcpData.mcpServers["existing-mcp"]).toEqual(otherMcp);
    expect(mcpData.mcpServers["computer-use"]).toEqual({
      command: "node",
      args: [service.mcpServerScript]
    });
    expect(service.isEnabled).toBe(true);

    // Unregister
    service.sync(disabled);
    const unregSkills = JSON.parse(fs.readFileSync(skillsConfigFile, "utf8"));
    expect(unregSkills.entries).toEqual([otherSkill]);

    const unregMcp = JSON.parse(fs.readFileSync(mcpConfigFile, "utf8"));
    expect(unregMcp.mcpServers["existing-mcp"]).toEqual(otherMcp);
    expect(unregMcp.mcpServers["computer-use"]).toBeUndefined();
    expect(service.isEnabled).toBe(false);
  });

  it("handles malformed config files gracefully without corrupting them", () => {
    fs.mkdirSync(path.dirname(skillsConfigFile), { recursive: true });
    fs.writeFileSync(skillsConfigFile, "{invalid json");
    fs.writeFileSync(mcpConfigFile, "{invalid mcp json");

    service.sync(enabled);
    expect(fs.readFileSync(skillsConfigFile, "utf8")).toBe("{invalid json");
    expect(fs.readFileSync(mcpConfigFile, "utf8")).toBe("{invalid mcp json");
    expect(service.lastProblem).toBeDefined();
  });

  it("does not register if skill or mcp script is missing", () => {
    fs.rmSync(path.join(service.skillDirectory, "computer-use", "SKILL.md"));
    service.sync(enabled);
    expect(service.lastProblem).toContain("skill is missing");
    expect(fs.existsSync(skillsConfigFile)).toBe(false);
  });

  it("unregisters when developerMode is disabled", () => {
    service.sync(enabled);
    service.sync({ ...enabled, plugins: { developerMode: false, enabled: ["computer-use"] } });

    const skillsData = JSON.parse(fs.readFileSync(skillsConfigFile, "utf8"));
    expect(skillsData.entries).toEqual([]);

    const mcpData = JSON.parse(fs.readFileSync(mcpConfigFile, "utf8"));
    expect(mcpData.mcpServers["computer-use"]).toBeUndefined();
  });

  it("starts HTTP event bridge on port 51839, receives POST /event and serves GET /poll", async () => {
    service.sync(enabled);
    await new Promise((r) => setTimeout(r, 50));
    expect(service.isServerListening).toBe(true);

    // POST an event
    const postRes = await fetch(`http://127.0.0.1:${service.port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "tool_start", toolName: "click", args: { target: [100, 200] } }),
    });
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.ok).toBe(true);

    // GET /poll
    const pollRes = await fetch(`http://127.0.0.1:${service.port}/poll`);
    expect(pollRes.status).toBe(200);
    const events = await pollRes.json();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("tool_start");
    expect(events[0].toolName).toBe("click");
    expect(events[0].args).toEqual({ target: [100, 200] });

    // Subsequent poll is empty
    const pollRes2 = await fetch(`http://127.0.0.1:${service.port}/poll`);
    const events2 = await pollRes2.json();
    expect(events2.length).toBe(0);

    // Multiple events get monotonic event IDs
    await fetch(`http://127.0.0.1:${service.port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "tool_start", toolName: "type_text", args: { text: "hello" } }),
    });
    await fetch(`http://127.0.0.1:${service.port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "tool_complete", toolName: "type_text", args: { text: "hello" }, result: "ok" }),
    });

    const pollRes3 = await fetch(`http://127.0.0.1:${service.port}/poll`);
    const batch = await pollRes3.json();
    expect(batch.length).toBe(2);
    expect(batch[0].id).toBeDefined();
    expect(batch[1].id).toBeDefined();
    expect(batch[1].id).toBeGreaterThan(batch[0].id);

    // Unregister stops server
    service.sync(disabled);
    expect(service.isServerListening).toBe(false);
  });
});


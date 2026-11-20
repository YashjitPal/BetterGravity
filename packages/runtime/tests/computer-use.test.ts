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

  it("manifest generation does not instantiate action handler eagerly", async () => {
    const { ComputerUseToolRegistry } = await import(
      // @ts-ignore -- untyped plugin JS module
      "../../../community/plugins/computer-use/tools/index.js"
    );
    const registry = new ComputerUseToolRegistry();
    expect(registry._handler).toBeNull();
    const manifest = registry.getToolManifest();
    expect(manifest.length).toBeGreaterThan(0);
    expect(registry._handler).toBeNull();
  });
});

describe("WindowsComputerUseActionHandler coordinate and UIA routing", () => {
  it("extractTargetCoords parses arrays, objects, and coordinates", async () => {
    const { extractTargetCoords, extractElementIndex } = await import(
      // @ts-ignore -- untyped plugin JS module
      "../../../community/plugins/computer-use/tools/windows-actions.js"
    );
    expect(extractTargetCoords({ target: [300, 450] })).toEqual([300, 450]);
    expect(extractTargetCoords({ coordinates: [150, 250] })).toEqual([150, 250]);
    expect(extractTargetCoords({ point: [75, 85] })).toEqual([75, 85]);
    expect(extractTargetCoords({ target: { x: 400, y: 500 } })).toEqual([400, 500]);
    expect(extractTargetCoords({ x: 120, y: 340 })).toEqual([120, 340]);
    expect(extractTargetCoords({ target: 5 })).toBeNull();
    expect(extractTargetCoords({})).toBeNull();

    expect(extractElementIndex({ element_index: 7 })).toBe(7);
    expect(extractElementIndex({ target: 3 })).toBe(3);
    expect(extractElementIndex({ target: [100, 200] })).toBeUndefined();
  });

  it("routes element_index and coordinates correctly without defaulting to [100, 100]", async () => {
    const { WindowsComputerUseActionHandler } = await import(
      // @ts-ignore -- untyped plugin JS module
      "../../../community/plugins/computer-use/tools/windows-actions.js"
    );

    const calls: Array<{ action: string; args: any }> = [];
    const mockRunner = {
      click: async (args: any) => { calls.push({ action: "click", args }); return { status: "success" }; },
      drag: async (args: any) => { calls.push({ action: "drag", args }); return { status: "success" }; },
      scroll: async (args: any) => { calls.push({ action: "scroll", args }); return { status: "success" }; },
      typeText: async (args: any) => { calls.push({ action: "typeText", args }); return { status: "success" }; },
      setValue: async (args: any) => { calls.push({ action: "setValue", args }); return { status: "success" }; },
      performAccessibilityAction: async (args: any) => { calls.push({ action: "performAccessibilityAction", args }); return { status: "success" }; },
      pressKey: async (args: any) => { calls.push({ action: "pressKey", args }); return { status: "success" }; },
      getAppState: async (args: any) => { calls.push({ action: "getAppState", args }); return { status: "success" }; },
      listApps: async () => [],
    };

    const handler = new WindowsComputerUseActionHandler({ nativeRunner: mockRunner as any });

    // Click by coordinates
    await handler.click({ target: [450, 600] });
    expect(calls.at(-1)!.args.target).toEqual([450, 600]);
    expect(calls.at(-1)!.args.element_index).toBeUndefined();

    // Click by element_index (should NOT default to [100, 100])
    await handler.click({ element_index: 4 });
    expect(calls.at(-1)!.args.element_index).toBe(4);
    expect(calls.at(-1)!.args.target).toBeNull();

    // Click by target as element index integer
    await handler.click({ target: 2 });
    expect(calls.at(-1)!.args.element_index).toBe(2);
    expect(calls.at(-1)!.args.target).toBeNull();

    // performAccessibilityAction calls runner.performAccessibilityAction with real element_index
    await handler.performAccessibilityAction({ element_index: 3, action: "invoke" });
    expect(calls.at(-1)!.action).toBe("performAccessibilityAction");
    expect(calls.at(-1)!.args.element_index).toBe(3);
    expect(calls.at(-1)!.args.action).toBe("invoke");

    // setValue calls runner.setValue with element_index and value
    await handler.setValue({ element_index: 5, value: "Antigravity" });
    expect(calls.at(-1)!.action).toBe("setValue");
    expect(calls.at(-1)!.args.element_index).toBe(5);
    expect(calls.at(-1)!.args.value).toBe("Antigravity");
  });

  // Regression: without WS_EX_TRANSPARENT on the topmost layered overlay window,
  // WM_NCHITTEST returning HTTRANSPARENT only passes through within the same thread,
  // so the animated Agent Cursor sitting at the target coordinates eats SendInput clicks
  // destined for other processes.
  it("configures the Windows screen overlay HWND with WS_EX_TRANSPARENT for cross-process click-through", () => {
    const overlaySource = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../community/plugins/computer-use/bin/windows-screen-overlay.cs"),
      "utf8"
    );

    expect(overlaySource).toMatch(/SetWindowLong\(\s*hwnd\s*,\s*GWL_EXSTYLE\s*,[^)]*WS_EX_TRANSPARENT/);
  });

  // Regression: calling ShowWindow(SW_SHOW) and deprecated SwitchToThisWindow(hwnd, true)
  // on already-visible RAIL/WSA windows corrupts their DWM composition surface into a blank
  // click-through frame. FocusAppWindow must only restore minimized windows and avoid SwitchToThisWindow.
  it("focuses windows without calling SwitchToThisWindow or SW_SHOW on visible windows", () => {
    const runnerSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../community/plugins/computer-use/bin/windows-native-runner.cs"),
      "utf8"
    );

    const focusMatch = runnerSource.match(/public static IntPtr FocusAppWindow\([\s\S]*?\n        \}/);
    expect(focusMatch).not.toBeNull();
    expect(focusMatch![0]).not.toContain("SwitchToThisWindow");
    expect(focusMatch![0]).not.toMatch(/ShowWindow\([^,]+,\s*5\)/);
  });
});


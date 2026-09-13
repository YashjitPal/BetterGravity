import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BrowserGuidance } from "../src/main/browser/guidance.js";
import { browserCommands } from "../src/main/browser/dispatch.js";

const plugin = path.resolve("community/plugins/in-built-browser");
const source = path.join(plugin, "vendor/codex-instructions");
const read = (file: string) => fs.readFileSync(path.join(source, file), "utf8");
const guidance = new BrowserGuidance(plugin);

describe("Codex browser instructions", () => {
  it("preserves every imported source and the complete skill body", () => {
    const provenance = JSON.parse(read("provenance.json"));
    expect(provenance.version).toBe("26.903.71938");
    expect(provenance.sources).toHaveLength(30);
    for (const item of provenance.sources) expect(createHash("sha256").update(fs.readFileSync(path.join(source, item.file))).digest("hex")).toBe(item.sha256);
    const original = read("skills/control-in-app-browser/SKILL.md").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").replace(/\r\n/g, "\n");
    const active = fs.readFileSync(path.join(plugin, "skills/in-built-browser/SKILL.md"), "utf8");
    expect(active.endsWith(original)).toBe(true);
    expect(active).toContain("# BetterGravity transport compatibility");
    expect(active).toContain("Do not start with `list_browsers`");
  });

  it("serves named original guides and rejects arbitrary paths", () => {
    for (const name of ["browser-safety", "accessibility", "file-uploads", "local-web-development", "browser-troubleshooting"]) {
      expect(guidance.document(name, browserCommands(false)).endsWith(read(`docs/${name}.md`))).toBe(true);
    }
    for (const name of ["../api", "../../../../.env", "file-uploads.md", "unknown"]) expect(() => guidance.document(name, browserCommands(false))).toThrow("Unknown browser documentation");
  });

  it("includes original browsing behavior and advertises only applicable optional guides", () => {
    const core = guidance.browserDocumentation(browserCommands(false));
    expect(core).toContain(read("docs/browser-safety.md"));
    expect(core).toContain(read("docs/confirmations.md"));
    expect(core).toContain(read("docs/api-use-behavior.md"));
    expect(core).toContain(read("docs/accessibility.md"));
    expect(core).toContain("Browser tool calls automatically reveal the pane");
    expect(core).toContain("there is no automatic end-of-turn");
    expect(core).not.toContain("- capabilities/tab/cdp");
    expect(core).not.toContain("# WebMCP");
    expect(core).not.toContain("exportGsuite(");
    expect(guidance.browserDocumentation(browserCommands(true))).toContain("- capabilities/tab/cdp");
    expect(guidance.document("capabilities/tab/cdp", browserCommands(false))).toContain("not available here");
  });

  it("uses original API descriptions with explicitly labeled adapter differences", () => {
    expect(guidance.describe("list_browsers")).toBe("List available browsers.");
    expect(guidance.describe("navigate_tab_url")).toBe("Open a URL in this tab.");
    expect(guidance.describe("cua_click")).toBe("Click at a coordinate in the current viewport.");
    expect(guidance.describe("playwright_evaluate")).toContain("Evaluate JavaScript in a read-only page scope.");
    expect(guidance.describe("playwright_evaluate")).toContain("BetterGravity adapter: script is an async function body");
    for (const command of browserCommands(true)) expect(guidance.describe(command).length).toBeGreaterThan(10);
  });

  it("gives the user's shared-tab selection policy without replacing Codex source guidance", () => {
    const core = guidance.browserDocumentation(browserCommands(false));
    expect(core).toContain("Same browser tabs");
    expect(core).toContain("across all conversations** is enabled by default");
    expect(core).toContain("Otherwise call `create_tab`");
    expect(core).toContain("Do not navigate or repurpose an unrelated");
    expect(core).toContain("Continue using the chosen tab for the same task");
    expect(guidance.describe("get_browser")).toContain("sharedTabsAcrossConversations");
    expect(guidance.describe("list_tabs")).toContain("usedInCurrentConversation");
    expect(guidance.describe("browser_user_open_tabs")).toContain("this conversation's tabs when sharing is off");
  });
});

import fs from "node:fs";
import path from "node:path";

export const BROWSER_PLUGIN_ID = "in-built-browser";
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

export function readObject(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  if (fs.statSync(file).size > MAX_CONFIG_BYTES) throw new Error(`${path.basename(file)} is too large; left unchanged.`);
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path.basename(file)} must contain an object; left unchanged.`);
  return value as Record<string, unknown>;
}

export function writeObject(file: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, text, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Owns only this plugin's entries. It never replaces another server or skill. */
export class BrowserRegistration {
  readonly pluginDirectory: string;
  readonly mcpConfig: string;
  readonly skillsConfig: string;
  readonly skillDirectory: string;
  readonly serverScript: string;
  readonly descriptorFile: string;

  constructor(plugins: string, home: string, data: string) {
    this.pluginDirectory = path.join(plugins, BROWSER_PLUGIN_ID);
    this.serverScript = path.join(this.pluginDirectory, "mcp-server.cjs");
    this.skillDirectory = path.join(this.pluginDirectory, "skills");
    this.mcpConfig = path.join(home, ".gemini", "config", "mcp_config.json");
    this.skillsConfig = path.join(home, ".gemini", "config", "skills.json");
    this.descriptorFile = path.join(data, "bridge.json");
  }

  get installed(): boolean {
    return ["plugin.json", "index.js", "mcp-server.cjs", "vendor/command-contracts.json", "vendor/playwright-injected.js", "skills/in-built-browser/SKILL.md"]
      .every(file => fs.existsSync(path.join(this.pluginDirectory, file)));
  }

  sync(enabled: boolean): void {
    if (enabled && !this.installed) throw new Error("The In Built Browser plugin is incomplete. Reinstall it.");
    // Validate both documents before changing either of them.
    const mcp = readObject(this.mcpConfig);
    const skills = readObject(this.skillsConfig);
    if (mcp.mcpServers !== undefined && (!mcp.mcpServers || typeof mcp.mcpServers !== "object" || Array.isArray(mcp.mcpServers))) {
      throw new Error("mcp_config.json has invalid mcpServers; left unchanged.");
    }
    if (skills.entries !== undefined && !Array.isArray(skills.entries)) throw new Error("skills.json has invalid entries; left unchanged.");
    const servers = { ...(mcp.mcpServers as Record<string, unknown> | undefined) };
    const existing = servers[BROWSER_PLUGIN_ID] as { args?: unknown[] } | undefined;
    const owned = existing && Array.isArray(existing.args) && existing.args[0] === this.serverScript;
    if (existing && !owned && enabled) throw new Error("Another MCP server uses the name in-built-browser; left unchanged.");
    const entries = (skills.entries ?? []) as unknown[];
    const next = entries.filter(entry => !entry || typeof entry !== "object" ||
      typeof (entry as { path?: unknown }).path !== "string" ||
      path.resolve((entry as { path: string }).path) !== path.resolve(this.skillDirectory));
    if (enabled) {
      servers[BROWSER_PLUGIN_ID] = { command: "node", args: [this.serverScript, "--bridge", this.descriptorFile] };
      next.push({ path: this.skillDirectory });
    } else if (owned) delete servers[BROWSER_PLUGIN_ID];
    if (enabled || owned) writeObject(this.mcpConfig, { ...mcp, mcpServers: servers });
    if (JSON.stringify(entries) !== JSON.stringify(next)) writeObject(this.skillsConfig, { ...skills, entries: next });
  }

  revoke(): void {
    fs.rmSync(this.descriptorFile, { force: true });
  }
}

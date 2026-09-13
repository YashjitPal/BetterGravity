import fs from "node:fs";
import path from "node:path";

interface Declaration { text: string; references?: string[] }
interface SourceDescription { text: string; source: string; members: string[]; internal?: boolean }
interface DocumentEntry {
  name: string; mode: "included" | "lookup" | "model"; description?: string; requiredFor?: string[];
  when?: { browserTypes?: string[]; requiredBrowserCapabilities?: string[]; requiredTabCapabilities?: string[]; requiredApiMembers?: string[] };
}

// Host differences and the user's tab-sharing policy are separately labeled.
// The leading description is always the original Codex API comment/declaration.
const ADAPTER_NOTES: Record<string, string> = {
  get_browser: "metadata.sharedTabsAcrossConversations reports the plugin setting (on by default). On first browser use in a conversation, list tabs and reuse an explicitly requested or relevant tab; otherwise create a new tab.",
  list_tabs: "Tabs are shared across conversations by default; when sharing is off this lists only the current conversation's tabs. usedInCurrentConversation identifies tabs already chosen by the agent here. On first use, create a new tab unless an existing one is relevant or explicitly requested; do not repurpose an unrelated user tab.",
  selected_tab: "The selected tab may belong to another conversation. Inspect list_tabs before choosing a tab on first browser use in this conversation.",
  create_tab: "Creates a new tab owned by the current conversation, visible across conversations when tab sharing is on. Continue using the chosen tab within the same task.",
  playwright_evaluate: "script is an async function body; use return for the result. Scoped scripts receive element (or elements for selector_mode all).",
  tab_ax_get_state: "MCP returns the full accessibility state and/or image directly; incremental AX diffs are not implemented.",
  tab_manual_handoff_request: "Pauses this local browser; only the user can resume in the pane.",
  mark_tab: "Tabs persist until closed; no automatic turn-end cleanup runs in this host.",
  browser_user_open_tabs: "Lists this plugin's shared in-app tabs by default, or this conversation's tabs when sharing is off. Reuse only an explicitly requested or relevant tab; otherwise create a new tab.",
  browser_user_claim_tab: "Selects an existing in-app tab; external Chrome/Edge tabs are not available.",
  browser_user_history: "Searches this plugin's separate browser history.",
  tab_content_export: "Exports the current page's visible text to a local Markdown file.",
  tab_cdp_call: "Requires Browser Developer mode and is limited to this plugin's tab and its child targets.",
  tab_cdp_events: "Requires Browser Developer mode."
};

export class BrowserGuidance {
  private readonly documents = new Map<string, string>();
  private readonly catalog: DocumentEntry[];
  private readonly descriptions: Record<string, SourceDescription>;
  private readonly api: { interfaces: Record<string, Record<string, { declarations: Declaration[] }>>; types: Record<string, Declaration> };
  private readonly compatibility: string;

  constructor(pluginDirectory: string) {
    const source = path.join(pluginDirectory, "vendor/codex-instructions");
    const read = (name: string) => fs.readFileSync(path.join(source, name), "utf8");
    this.catalog = JSON.parse(read("docs/documents.json"));
    this.descriptions = JSON.parse(read("tool-descriptions.json"));
    this.api = JSON.parse(read("docs/api.json"));
    this.compatibility = fs.readFileSync(path.join(pluginDirectory, "skills/in-built-browser/COMPATIBILITY.md"), "utf8").trim();
    for (const entry of this.catalog) {
      if (!/^[a-zA-Z0-9_/-]+$/.test(entry.name) || entry.name.split("/").includes("..")) throw new Error("Invalid browser documentation catalog.");
      this.documents.set(entry.name, read(`docs/${entry.name}.md`));
    }
  }

  describe(command: string): string {
    const source = this.descriptions[command];
    if (!source) throw new Error(`Missing Codex description for ${command}.`);
    const text = source.internal ? `Codex transport command: ${source.text}. See the extracted input schema.` : source.text;
    return ADAPTER_NOTES[command] ? `${text}\nBetterGravity adapter: ${ADAPTER_NOTES[command]}` : text;
  }

  document(name: string, commands: readonly string[]): string {
    // Lookup only known extensionless names. Never turn a tool argument into
    // a filesystem read (including traversal or arbitrary local documents).
    const source = this.documents.get(name);
    if (source === undefined) throw new Error(`Unknown browser documentation: ${name}. Read get_browser_documentation for available guides.`);
    const entry = this.catalog.find(doc => doc.name === name)!;
    const supported = this.applicable(entry, commands) && (!name.startsWith("capabilities/") || ["capabilities/browser/visibility", "capabilities/browser/viewport", ...(commands.includes("tab_cdp_call") ? ["capabilities/tab/cdp"] : [])].includes(name));
    const unavailable = !supported || name.includes("chrome") ? "\n\nBetterGravity adapter: this guide is retained as Codex reference material; this backend/capability is not available here. Do not attempt its setup flow.\n" : "\n";
    return `${this.compatibility}${unavailable}\n---\n\n${source}`;
  }

  browserDocumentation(commands: readonly string[]): string {
    const included = this.catalog.filter(doc => doc.mode === "included" && this.applicable(doc, commands));
    const lookup = this.catalog.filter(doc => doc.mode === "lookup" && this.applicable(doc, commands));
    const capabilities = ["capabilities/browser/visibility", "capabilities/browser/viewport", ...(commands.includes("tab_cdp_call") ? ["capabilities/tab/cdp"] : [])];
    const reference = this.apiReference();
    return [this.compatibility, "# Codex Browser guidance", ...included.map(doc => this.documents.get(doc.name)!),
      "# Additional Codex documentation", "Use get_documentation with the extensionless name when its topic applies.",
      "- bootstrap-troubleshooting: read when browser setup succeeds but discovery or selection fails",
      ...lookup.map(doc => `- ${doc.name}: ${doc.description}`), ...capabilities.map(name => `- ${name}`),
      "# Core API reference (Codex declarations)", "The source uses the JavaScript client. Translate to the direct MCP transport using the mapping below.", reference,
      "# MCP transport mapping (BetterGravity adapter)", ...commands.filter(command => this.descriptions[command]).map(command => {
        const item = this.descriptions[command]!;
        return `- ${command}: ${item.members.length ? item.members.join(", ") : item.internal ? "internal Codex command" : item.source.replace(/^docs\/|\.md$/g, "")}${ADAPTER_NOTES[command] ? ` — ${ADAPTER_NOTES[command]}` : ""}`;
      })].join("\n\n");
  }

  private applicable(entry: DocumentEntry, commands: readonly string[]): boolean {
    const when = entry.when;
    // requiredFor records which commands require reading a guide; `when`
    // determines whether the original catalog includes it for this backend.
    return (!when?.browserTypes || when.browserTypes.includes("iab")) &&
      (!when?.requiredBrowserCapabilities || when.requiredBrowserCapabilities.every(id => ["visibility", "viewport"].includes(id))) &&
      (!when?.requiredTabCapabilities || when.requiredTabCapabilities.every(id => id === "cdp" && commands.includes("tab_cdp_call"))) &&
      (!when?.requiredApiMembers || when.requiredApiMembers.every(id => !["ContentAPI.exportGsuite", "ContentAPI.exportYouTubeTranscript"].includes(id)));
  }

  private apiReference(): string {
    const references = new Set<string>();
    const text: string[] = [];
    for (const [owner, members] of Object.entries(this.api.interfaces)) {
      const declarations = Object.entries(members).filter(([key]) => !["ContentAPI.exportGsuite", "ContentAPI.exportYouTubeTranscript"].includes(`${owner}.${key}`)).flatMap(([, member]) => member.declarations);
      if (!declarations.length) continue;
      text.push(`interface ${owner} {\n${declarations.map(d => `  ${d.text}`).join("\n")}\n}`);
      for (const declaration of declarations) for (const name of declaration.references ?? []) references.add(name);
    }
    // Include the original types needed to read the method signatures. Set
    // iteration also visits any newly discovered dependent type exactly once.
    for (const name of references) {
      const type = this.api.types[name];
      if (!type) continue;
      text.push(type.text);
      for (const dependency of type.references ?? []) references.add(dependency);
    }
    return `\`\`\`ts\n${text.join("\n\n")}\n\`\`\``;
  }
}

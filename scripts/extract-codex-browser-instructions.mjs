// Import instruction assets from the installed Codex Browser plugin read-only.
// Keep the originals byte-for-byte and identify our transport notes separately.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const camel = name => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

export async function extractBrowserInstructions(reference, plugin = path.resolve("community/plugins/in-built-browser")) {
  const destination = path.join(plugin, "vendor/codex-instructions");
  const read = name => fs.readFile(path.join(reference, name));
  const manifest = JSON.parse(await read(".codex-plugin/plugin.json"));
  const catalog = JSON.parse(await read("docs/documents.json"));
  const files = ["skills/control-in-app-browser/SKILL.md", "skills/control-in-app-browser/agents/openai.yaml", "docs/documents.json", "docs/api.json",
    ...catalog.map(doc => `docs/${doc.name}.md`)];
  const originals = new Map();
  const sources = [];
  for (const name of files) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.split("/").includes("..")) throw new Error("Unexpected Codex documentation path.");
    const bytes = await read(name);
    originals.set(name, bytes.toString("utf8"));
    const target = path.join(destination, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    sources.push({ file: name, sha256: hash(bytes) });
  }
  const api = JSON.parse(originals.get("docs/api.json"));
  const contracts = JSON.parse(await fs.readFile(path.join(plugin, "vendor/command-contracts.json"), "utf8"));
  const mappings = {
    list_browsers: ["Browsers.list"], get_browser: ["Browsers.get"], get_default_browser: ["Browsers.getDefault"], get_browser_for_url: ["Browsers.getForUrl"],
    get_documentation: ["Documentation.get"], get_browser_documentation: ["Browser.documentation"],
    create_tab: ["Tabs.new"], get_tab: ["Tabs.get"], close_tab: ["Tab.close"], list_tabs: ["Tabs.list"], selected_tab: ["Tabs.selected"], tabs_content: ["Tabs.content"],
    mark_tab: ["Tab.markDeliverable", "Tab.markHandoff"], tab_manual_handoff_request: ["Tab.requestManualHandoff"], name_session: ["Browser.nameSession"],
    navigate_tab_url: ["Tab.goto"], navigate_tab_back: ["Tab.back"], navigate_tab_forward: ["Tab.forward"], navigate_tab_reload: ["Tab.reload"],
    browser_user_claim_tab: ["BrowserUser.claimTab"], browser_user_get_tab_context: ["BrowserUser.getTabContext"], browser_user_open_tabs: ["BrowserUser.openTabs"], browser_user_history: ["Browser.history"],
    tab_dev_logs: ["TabDevAPI.logs"], tab_get_js_dialog: ["Tab.getJsDialog"], tab_handle_js_dialog: ["AlertDialog.dismiss", "ConfirmDialog.accept", "ConfirmDialog.dismiss", "PromptDialog.accept", "PromptDialog.dismiss", "BeforeUnloadDialog.dismiss"],
    tab_content_export: ["ContentAPI.export"], tab_content_export_gsuite: ["ContentAPI.exportGsuite"], tab_content_export_youtube_transcript: ["ContentAPI.exportYouTubeTranscript"],
    tab_screenshot: ["Tab.screenshot"], tab_ax_get_state: ["AXAPI.get", "AXAPI.write"], tab_ax_action: ["AXAPI.click", "AXAPI.drag", "AXAPI.pressKey", "AXAPI.scroll", "AXAPI.selectText", "AXAPI.setValue", "AXAPI.typeText", "AXAPI.performSecondaryAction"],
    playwright_evaluate: ["PlaywrightAPI.evaluate", "PlaywrightLocator.evaluate", "PlaywrightLocator.evaluateAll"],
    playwright_dom_snapshot: ["PlaywrightAPI.domSnapshot"], playwright_wait_for_url: ["PlaywrightAPI.waitForURL"], playwright_wait_for_load_state: ["PlaywrightAPI.waitForLoadState"], playwright_wait_for_timeout: ["PlaywrightAPI.waitForTimeout"],
    playwright_wait_for_download: ["PlaywrightAPI.waitForEvent"], playwright_wait_for_file_chooser: ["PlaywrightAPI.waitForEvent"],
    playwright_download_path: ["PlaywrightDownload.path"], playwright_file_chooser_set_files: ["PlaywrightFileChooser.setFiles"]
  };
  const capabilityMethods = {
    browser_visibility_get: ["capabilities/browser/visibility", "get"], browser_visibility_set: ["capabilities/browser/visibility", "set"],
    browser_viewport_reset: ["capabilities/browser/viewport", "reset"], browser_viewport_set: ["capabilities/browser/viewport", "set"],
    tab_cdp_call: ["capabilities/tab/cdp", "send"], tab_cdp_events: ["capabilities/tab/cdp", "readEvents"]
  };
  const descriptions = {};
  for (const { name } of contracts) {
    let members = mappings[name];
    if (!members) {
      const prefix = [["playwright_locator_", "PlaywrightLocator"], ["dom_cua_", "DomCUAAPI"], ["cua_", "CUAAPI"], ["tab_clipboard_", "TabClipboardAPI"]].find(([start]) => name.startsWith(start));
      if (prefix) {
        const suffix = name.slice(prefix[0].length);
        const member = api.interfaces[prefix[1]]?.[suffix] ? suffix : camel(suffix);
        if (api.interfaces[prefix[1]]?.[member]) members = [`${prefix[1]}.${member}`];
      }
    }
    if (members) {
      const declarations = members.flatMap(member => {
        const [owner, key] = member.split(".");
        const source = api.interfaces[owner]?.[key];
        if (!source) throw new Error(`Codex API member changed: ${member}`);
        return source.declarations.map(declaration => declaration.text);
      });
      const comments = [...new Set(declarations.map(text => text.match(/;\s*\/\/\s*(.*)$/)?.[1]).filter(Boolean))];
      descriptions[name] = { members, source: "docs/api.json", text: comments.length ? comments.join(" ") : declarations.join("\n") };
    } else if (capabilityMethods[name]) {
      const [doc, method] = capabilityMethods[name];
      const source = originals.get(`docs/${doc}.md`);
      const declaration = source.split(/\r?\n/).find(line => line.trimStart().startsWith(`${method}(`));
      const comment = declaration?.match(/;\s*\/\/\s*(.*)$/)?.[1];
      if (!comment) throw new Error(`Codex capability method changed: ${doc}.${method}`);
      descriptions[name] = { members: [], source: `docs/${doc}.md`, text: comment };
    } else {
      // The original client also has internal wire commands without a public
      // API comment. Preserve their names instead of fabricating Codex prose.
      descriptions[name] = { members: [], source: "vendor/command-contracts.json", text: name, internal: true };
    }
  }
  await fs.writeFile(path.join(destination, "tool-descriptions.json"), JSON.stringify(descriptions, null, 2) + "\n");
  const sourceSkill = originals.get("skills/control-in-app-browser/SKILL.md");
  const split = sourceSkill.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
  if (!split) throw new Error("Codex Browser skill front matter changed.");
  const compatibility = await fs.readFile(path.join(plugin, "skills/in-built-browser/COMPATIBILITY.md"), "utf8");
  const activeSkill = split[1].replace("name: control-in-app-browser", "name: in-built-browser") +
    "\n<!-- Generated by scripts/extract-codex-browser-instructions.mjs. -->\n\n" + compatibility.trim() +
    "\n\n---\n\n<!-- Codex Browser skill body below is unmodified. -->\n" + split[2];
  await fs.writeFile(path.join(plugin, "skills/in-built-browser/SKILL.md"), activeSkill.replace(/\r\n/g, "\n"));
  await fs.writeFile(path.join(destination, "provenance.json"), JSON.stringify({ product: "OpenAI Codex", version: manifest.version,
    sources, extraction: "Original Browser skill, agent default prompt, API manifest, document catalog, and all named Markdown guides copied byte-for-byte. API/tool descriptions are original comments or declarations. Active skill changes the registration name, uses LF line endings, and prepends separately labeled BetterGravity transport/capability notes; its Codex wording is unchanged. These are bundled browser instructions, not the full Codex or ChatGPT system prompt.",
    generated: [{ file: "tool-descriptions.json", sha256: hash(await fs.readFile(path.join(destination, "tool-descriptions.json"))) }]
  }, null, 2) + "\n");
  return { documents: catalog.length, descriptions: Object.values(descriptions).filter(item => !item.internal).length, internal: Object.entries(descriptions).filter(([, item]) => item.internal).map(([name]) => name) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Pass Codex's bundled plugins/browser directory.");
  process.stdout.write(JSON.stringify(await extractBrowserInstructions(path.resolve(process.argv[2]))) + "\n");
}

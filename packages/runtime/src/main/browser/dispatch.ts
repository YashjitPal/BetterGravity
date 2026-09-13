import fs from "node:fs";
import path from "node:path";
import type { BrowserHost, InBuiltBrowserService } from "./index.js";
import { TAB_COMMANDS, executeTabCommand, until } from "./commands.js";
import { browserUrl, finiteNumber } from "./url.js";

const BROWSER_COMMANDS = [
  "list_browsers", "get_browser", "get_default_browser", "get_documentation", "get_browser_documentation", "get_browser_for_url",
  "create_tab", "get_tab", "close_tab", "mark_tab", "tab_manual_handoff_request", "runtime_config", "name_session", "selected_tab", "list_tabs", "tabs_content", "navigate_tab_url",
  "browser_user_claim_tab", "browser_user_get_tab_context", "browser_user_open_tabs", "browser_user_history", "tab_content_export",
  "cua_download_media", "dom_cua_download_media", "playwright_locator_download_media", "playwright_wait_for_download", "playwright_download_path",
  "playwright_wait_for_file_chooser", "playwright_file_chooser_set_files",
  "browser_visibility_get", "browser_visibility_set", "browser_viewport_set", "browser_viewport_reset", "tab_clipboard_read", "tab_clipboard_write"
];

export function browserCommands(developerMode: boolean): string[] {
  return [...BROWSER_COMMANDS, ...TAB_COMMANDS, ...(developerMode ? ["tab_cdp_call", "tab_cdp_events"] : [])];
}

export const DISABLED_CLIENT_MEMBERS = [
  "ContentAPI.exportGsuite", "ContentAPI.exportYouTubeTranscript"
];

function info(service: InBuiltBrowserService, host: BrowserHost): Record<string, unknown> {
  return { id: host.id, name: host.name, type: "iab", family: "chromium", profileName: "BetterGravity Browser", metadata: { codexSessionId: host.id, conversationId: host.context, sharedTabsAcrossConversations: service.sharedTabsAcrossConversations },
    capabilities: { browser: [{ id: "visibility", description: "Show or hide the right browser pane." }, { id: "viewport", description: "Set a responsive viewport for page testing." }],
      tab: service.developerMode ? [{ id: "cdp", description: "Tab-scoped Chrome DevTools Protocol." }] : [] },
    apiSupportOverrides: Object.fromEntries(DISABLED_CLIENT_MEMBERS.map(name => [name, false])) };
}

function tabs(service: InBuiltBrowserService, host: BrowserHost): Record<string, unknown>[] {
  return [...host.tabs.values()].map(tab => ({ id: tab.id, providerTabId: tab.id, url: tab.state().url, title: tab.state().title,
    openedInConversationId: service.tabContext(tab), usedInCurrentConversation: host.agentTabIds.has(tab.id) }));
}

export async function dispatchBrowserCommand(service: InBuiltBrowserService, command: string, args: Record<string, any>): Promise<any> {
  service.requireEnabled();
  if (command === "list_browsers") return [...service.hosts.values()].map(host => info(service, host));
  if (["get_browser", "get_default_browser", "get_browser_for_url"].includes(command)) return info(service, service.findHost(args.id));
  if (command === "runtime_config") return { display_truncate_max_chars: 120_000 };
  if (command === "get_documentation") return service.documentation(String(args.name));
  if (command === "get_browser_documentation") return service.documentation();
  const host = service.findHost(args.browser_id);
  const epoch = host.epoch;
  const assert = () => service.assertAgent(host, epoch);
  switch (command) {
    case "list_tabs": return { tabs: tabs(service, host), sharedTabsAcrossConversations: service.sharedTabsAcrossConversations };
    case "browser_user_open_tabs": return { tabs: tabs(service, host), sharedTabsAcrossConversations: service.sharedTabsAcrossConversations };
    case "selected_tab": return host.activeTabId ? { id: host.activeTabId } : {};
    case "create_tab": {
      const tab = service.createTab(host, undefined, host.context, !host.preserveUserSelection);
      service.recordAgentActivity(host, tab);
      host.visible = true; service.changed(host);
      await tab.navigate("about:blank"); assert();
      return { id: tab.id };
    }
    case "get_tab": case "browser_user_claim_tab": {
      const tab = service.findTab(host, args.tab_id);
      return { id: tab.id, title: tab.state().title, url: tab.state().url };
    }
    case "close_tab": service.closeTab(host, service.findTab(host, args.tab_id)); return {};
    case "name_session": host.name = String(args.name).slice(0, 160); service.changed(host); return {};
    case "mark_tab": service.findTab(host, args.tab_id).mark = args.status; return {};
    case "tab_manual_handoff_request": host.visible = true; service.pause(host); return {};
    case "browser_visibility_get": return { visible: host.visible };
    case "browser_visibility_set": host.visible = args.visible; service.changed(host); return {};
    case "browser_annotations": return { annotations: host.annotations };
    case "browser_user_history": {
      const queries = args.queries ?? [];
      const items = service.history.filter(item => (!queries.length || queries.some((q: string) => `${item.url} ${item.title}`.toLowerCase().includes(q.toLowerCase()))) && (!args.from || item.dateVisited >= args.from) && (!args.to || item.dateVisited <= args.to));
      return { items: items.slice(-Math.min(args.limit ?? 50, 300)).reverse() };
    }
    case "browser_viewport_set": case "browser_viewport_reset": {
      host.viewport = command.endsWith("_reset") ? null : { width: finiteNumber(args.width, "width", 200, 3840), height: finiteNumber(args.height, "height", 200, 3840) };
      for (const tab of host.tabs.values()) await tab.cdp(host.viewport ? "Emulation.setDeviceMetricsOverride" : "Emulation.clearDeviceMetricsOverride", host.viewport ? { ...host.viewport, deviceScaleFactor: 1, mobile: false } : {});
      service.changed(host); return {};
    }
    case "tabs_content": {
      const results = [];
      for (const requested of args.urls) {
        assert(); const url = browserUrl(requested); await service.authorize(host, url); assert();
        const existing = [...host.tabs.values()].find(t => t.state().url === url);
        const tab = existing ?? service.createTab(host, undefined, host.context, !host.preserveUserSelection);
        service.recordAgentActivity(host, tab);
        try {
          if (!existing) await tab.navigate(url);
          const content = await tab.driver({ action: args.content_type === "html" ? "html" : args.content_type === "domSnapshot" ? "snapshot" : "pageText" });
          results.push({ url, title: tab.state().title, content: String(content).slice(0, 200_000) });
        } finally { if (!existing) service.closeTab(host, tab); }
      }
      return { results };
    }
  }
  const tab = service.findTab(host, args.tab_id);
  if (command === "navigate_tab_url") {
    const url = browserUrl(args.url);
    await service.authorize(host, url); assert();
    host.visible = true; service.changed(host);
    await tab.navigate(url); assert(); return {};
  }
  await service.authorize(host, tab.state().url); assert();
  host.visible = true; service.changed(host);
  switch (command) {
    case "browser_user_get_tab_context": {
      if (args.expected_url && args.expected_url !== tab.state().url) throw new Error("The mentioned tab has navigated since it was selected.");
      const text = String(await tab.driver({ action: "pageText" }));
      return { kind: "text", text: text.slice(0, 100_000), truncated: text.length > 100_000, title: tab.state().title, url: tab.state().url };
    }
    case "tab_content_export": {
      const text = String(await tab.driver({ action: "pageText" }));
      const directory = path.join(service.dataDirectory, "exports");
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, `${tab.id}-${Date.now()}.md`);
      fs.writeFileSync(file, `# ${tab.state().title}\n\nSource: ${tab.state().url}\n\n${text}\n`);
      return { path: file };
    }
    case "cua_download_media": case "dom_cua_download_media": case "playwright_locator_download_media": {
      const url = browserUrl(await tab.driver({ action: "media", x: args.x, y: args.y, selector: args.node_id ? `aria-ref=${args.node_id}` : args.selector }));
      const before = new Set(service.downloads.keys());
      tab.contents.downloadURL(url);
      await until(async () => { if (![...service.downloads.keys()].some(id => !before.has(id))) throw new Error("Waiting for the download to start."); return true; }, assert, args.timeout_ms ?? 10_000);
      return {};
    }
    case "playwright_wait_for_download": {
      const previous = new Set(service.downloads.keys());
      const download = await until(async () => { const d = [...service.downloads.values()].find(item => item.tabId === tab.id && !previous.has(item.id)); if (!d) throw new Error("Waiting for a new download in this tab."); return d; }, assert, args.timeout_ms ?? 10_000);
      return { download_id: download.id };
    }
    case "playwright_download_path": {
      const download = await until(async () => { const d = service.downloads.get(args.download_id); if (!d || d.tabId !== tab.id) throw new Error("This download does not belong to the tab."); if (d.state === "progressing") throw new Error("The download has not finished."); return d; }, assert, args.timeout_ms ?? 30_000);
      return { path: download.state === "completed" ? download.path : null };
    }
    case "playwright_wait_for_file_chooser": {
      if (tab.waitingForFileChooser) throw new Error("A file chooser wait is already active for this tab.");
      const previous = tab.fileChooser?.id;
      await tab.interceptFileChooser(true);
      try {
        const chooser = await until(async () => { if (!tab.fileChooser || tab.fileChooser.id === previous) throw new Error("Waiting for a file chooser in this tab."); return tab.fileChooser; }, assert, args.timeout_ms ?? 10_000);
        return { file_chooser_id: chooser.id, is_multiple: chooser.multiple };
      } finally { await tab.interceptFileChooser(false); }
    }
    case "playwright_file_chooser_set_files": {
      const chooser = tab.fileChooser;
      if (!chooser || chooser.id !== args.file_chooser_id) throw new Error("This file chooser is no longer open in this tab.");
      if (!chooser.multiple && args.files.length > 1 || args.files.length > 100) throw new Error("The file chooser does not accept that many files.");
      const files = args.files.map((file: string) => {
        if (!path.isAbsolute(file) || /^\.env(?:\.|$)/i.test(path.basename(file))) throw new Error("Use absolute paths to approved upload files. Environment files cannot be uploaded.");
        const resolved = fs.realpathSync(file);
        if (/^\.env(?:\.|$)/i.test(path.basename(resolved)) || !fs.statSync(resolved).isFile()) throw new Error("Choose a regular file, excluding environment files.");
        return resolved;
      });
      assert();
      await tab.cdp("DOM.setFileInputFiles", { files, backendNodeId: chooser.backendNodeId }, chooser.sessionId);
      tab.fileChooser = null; return {};
    }
    case "tab_clipboard_read": {
      const items = await tab.evaluate(`(async()=>{const values=[];for(const item of await navigator.clipboard.read()){const entries=[];for(const mime of item.types){const blob=await item.getType(mime);if(blob.size>1048576)throw new Error('Clipboard item exceeds 1 MB');if(mime.startsWith('text/'))entries.push({mime_type:mime,text:await blob.text()});else{const bytes=new Uint8Array(await blob.arrayBuffer());let value='';for(const byte of bytes)value+=String.fromCharCode(byte);entries.push({mime_type:mime,base64:btoa(value)});}}values.push({entries,presentation_style:item.presentationStyle??'unspecified'});}return values;})()`);
      return { items };
    }
    case "tab_clipboard_write":
      await tab.evaluate(`navigator.clipboard.write(${JSON.stringify(args.items)}.map(item=>new ClipboardItem(Object.fromEntries(item.entries.map(e=>[e.mime_type,new Blob([e.text??Uint8Array.from(atob(e.base64??''),c=>c.charCodeAt(0))],{type:e.mime_type})])))))`); return {};
    case "tab_cdp_call": {
      if (!service.developerMode) throw new Error("Browser Developer mode is disabled.");
      if (!/^(Page|Runtime|DOM|DOMSnapshot|CSS|Network|Performance|Accessibility|Emulation|Log|Input|Debugger|Profiler|HeapProfiler)\./.test(args.method)) throw new Error("CDP access is limited to this browser tab.");
      if (args.method === "Page.navigate") {
        args.params = { ...args.params, url: browserUrl(args.params?.url ?? "") };
        await service.authorize(host, args.params.url); assert();
      }
      const target = args.target?.session_id ?? (args.target?.target_id ? tab.children.get(args.target.target_id) : undefined);
      if (args.target && (!target || !!args.target.session_id === !!args.target.target_id || ![...tab.children.values()].includes(target))) throw new Error("Select exactly one child target of this browser tab.");
      return await tab.cdp(args.method, args.params ?? {}, target, finiteNumber(args.timeout_ms ?? 15_000, "timeout_ms", 1, 60_000));
    }
    case "tab_cdp_events": {
      if (!service.developerMode) throw new Error("Browser Developer mode is disabled.");
      const after = args.after_sequence ?? tab.eventSequence;
      const target = args.target?.session_id ?? (args.target?.target_id ? tab.children.get(args.target.target_id) : undefined);
      if (args.target && (!target || !!args.target.session_id === !!args.target.target_id || ![...tab.children.values()].includes(target))) throw new Error("Select exactly one child target of this browser tab.");
      const read = () => {
        const matching = tab.events.filter(event => event.sequence > after && (!args.methods || args.methods.includes(event.method)) && (!target || target === event.source.sessionId));
        const events = matching.slice(0, args.limit ?? 100);
        const hasMore = matching.length > events.length;
        return { events, cursor: hasMore ? events.at(-1)!.sequence : tab.eventSequence, hasMore, truncated: after < (tab.events[0]?.sequence ?? 1) - 1 };
      };
      const deadline = Date.now() + finiteNumber(args.timeout_ms ?? 0, "timeout_ms", 0, 60_000);
      let result = read();
      while (!result.events.length && !result.truncated && Date.now() < deadline) {
        assert(); await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now()))); result = read();
      }
      assert(); return result;
    }
    default: return executeTabCommand(command, args, tab, assert);
  }
}

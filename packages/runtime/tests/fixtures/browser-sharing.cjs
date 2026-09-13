const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const [directory, sourcePlugins] = process.argv.slice(2);
const plugins = path.join(directory, "plugins");
fs.cpSync(path.join(sourcePlugins, "in-built-browser"), path.join(plugins, "in-built-browser"), { recursive: true, filter: source => !/^\.env(?:\.|$)/i.test(path.basename(source)) });
app.setPath("userData", path.join(directory, "profile"));
app.disableHardwareAcceleration();
const { InBuiltBrowserService, registerBrowserChannels } = require(path.join(directory, "browser.cjs"));
const enabled = { schemaVersion: 1, themes: { enabled: [] }, plugins: { developerMode: true, enabled: ["in-built-browser"] }, reapplyAfterHostUpdate: false };
const disabled = { ...enabled, plugins: { developerMode: true, enabled: [] } };
const root = path.join(directory, "data"), home = path.join(directory, "home");
const service = new InBuiltBrowserService(root, plugins, home);
const windows = [];
let server, base;
const result = { errors: [] };
const report = () => fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
const stage = name => { result.stage = name; report(); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) { const end = Date.now() + 7000; while (!await predicate()) { if (Date.now() > end) throw new Error(label); await delay(25); } }
const watchdog = setTimeout(() => { result.errors.push(`Sharing test timed out during ${result.stage}`); report(); app.exit(1); }, 60_000);
// This renderer acknowledges real native reveal/cursor messages, without
// depending on screenshot timing or the host application's animation speed.
const harness = `<!doctype html><title>Browser sharing host</title><script>
window.latestBrowserState=null;window.browserCursors=[];window.browserShortcuts=[];
window.browserHarness.onStateChanged(state=>{
  if(state.context!==location.pathname.split('/').at(-1))return;
  if(state.frame)return;
  window.latestBrowserState=state;
  if(state.shortcut)window.browserShortcuts.push({context:state.context,shortcut:state.shortcut});
  window.browserHarness.setBounds({context:state.context,x:300,y:60,width:550,height:540,visible:state.visible,composited:true,revealSequence:state.revealSequence});
  if(state.agentCursor){window.browserCursors.push({context:state.context,tabId:state.agentCursor.tabId,sequence:state.agentCursor.sequence});window.browserHarness.request('cursor-arrived',{context:state.context,tabId:state.agentCursor.tabId,sequence:state.agentCursor.sequence});}
});</script>`;
const page = `<!doctype html><title>Shared browser page</title><input id="draft"><button id="count">Count: 0</button><script>window.identity=crypto.randomUUID();window.count=0;document.querySelector('#count').onclick=()=>document.querySelector('#count').textContent='Count: '+(++window.count);</script>`;
async function makeWindow(context) {
  const window = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { preload: path.join(__dirname, "browser-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  windows.push(window); await window.loadURL(`${base}/c/${context}`);
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  window.webContents.debugger.on("message", (_event, method, params) => { if (method === "Page.screencastFrame") void window.webContents.debugger.sendCommand("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {}); });
  await window.webContents.debugger.sendCommand("Page.enable");
  await window.webContents.debugger.sendCommand("Page.startScreencast", { format: "png", maxWidth: 1, maxHeight: 1 });
  return window;
}
async function switchContext(window, context) {
  await window.webContents.executeJavaScript(`history.pushState({},'',${JSON.stringify(`/c/${context}`)})`);
  await service.request(window.webContents, "attach", { context });
  return service.hosts.get(`${window.webContents.id}:${context}`);
}
async function openPage(window, host, name) {
  await service.request(window.webContents, "new-tab", { context: host.context });
  await service.request(window.webContents, "navigate", { context: host.context, url: `${base}/page/${name}` });
  return service.findTab(host);
}

app.whenReady().then(async () => {
  stage("default setting and shared live state");
  const source = fs.readFileSync(path.join(plugins, "in-built-browser/index.js"), "utf8");
  const settingsStart = source.indexOf("const options = plugin.settings.define(");
  const settingsEnd = source.indexOf("\nfunction currentContext", settingsStart);
  const schema = new Function("plugin", source.slice(settingsStart, settingsEnd) + ";return options;")({ settings: { define: schema => schema } });
  assert.equal(schema.sharedTabsAcrossConversations.default, true);
  assert.equal(schema.sharedTabsAcrossConversations.label, "Same browser tabs across all conversations");
  assert.equal(schema.sharedTabsAcrossConversations.type, "boolean");
  assert.equal(service.sharedTabsAcrossConversations, true);
  assert.deepEqual(service.tools(), []);
  server = http.createServer((req, res) => { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(req.url.startsWith("/c/") ? harness : page); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  service.sync(enabled); await service.settled; assert.equal(service.isEnabled, true, service.lastProblem);
  registerBrowserChannels(service);
  const first = await makeWindow("alpha");
  const alpha = service.attach(first.webContents, "alpha");
  const a = await openPage(first, alpha, "a");
  const identity = await a.evaluate("document.querySelector('#draft').value='Unsubmitted draft';window.identity");
  const beta = await switchContext(first, "beta");
  assert.equal(service.findTab(beta, a.id), a);
  assert.equal((await service.request(first.webContents, "preferences", {})).sharedTabsAcrossConversations, true);
  assert.equal(await a.evaluate("document.querySelector('#draft').value"), "Unsubmitted draft");
  assert.equal(await a.evaluate("window.identity"), identity);
  await service.request(first.webContents, "attach", { context: "beta" });
  assert.equal(beta.tabs.size, 1);
  result.defaultOn = result.liveState = true;

  stage("agent tab choice and current conversation callbacks");
  const info = await service.execute("get_browser", { id: "iab" });
  assert.equal(info.id, beta.id); assert.equal(info.metadata.sharedTabsAcrossConversations, true);
  const listed = await service.execute("list_tabs", { browser_id: beta.id });
  assert.equal(listed.tabs[0].usedInCurrentConversation, false);
  assert.equal(listed.tabs[0].openedInConversationId, "alpha");
  const created = await service.execute("create_tab", { browser_id: beta.id });
  const b = service.findTab(beta, created.id);
  await service.execute("navigate_tab_url", { browser_id: beta.id, tab_id: b.id, url: `${base}/page/b` });
  assert.equal((await service.execute("list_tabs", { browser_id: beta.id })).tabs.find(tab => tab.id === b.id).usedInCurrentConversation, true);
  assert.equal(await a.evaluate("document.querySelector('#draft').value"), "Unsubmitted draft");
  result.agentSelection = true;
  await service.request(first.webContents, "select", { context: "beta", tabId: a.id });
  await a.evaluate(`window.open(${JSON.stringify(`${base}/page/popup`)});true`);
  await until(() => beta.tabs.size === 3, "Popup did not join the shared tab list");
  const popup = [...beta.tabs.values()].find(tab => tab !== a && tab !== b);
  assert.equal(service.tabContext(popup), "beta");
  service.closeTab(beta, popup);
  result.popupOwnership = true;
  await service.execute("playwright_locator_click", { browser_id: beta.id, tab_id: a.id, selector: "#count" });
  await until(async () => (await a.evaluate("window.count")) === 1, "Click did not increment count");
  const cursor = await first.webContents.executeJavaScript("window.browserCursors.at(-1)");
  assert.equal(cursor.context, "beta"); assert.equal(cursor.tabId, a.id);
  a.contents.sendInputEvent({ type: "keyDown", keyCode: "L", modifiers: ["control"] });
  await until(async () => (await first.webContents.executeJavaScript("window.browserShortcuts")).some(item => item.context === "beta" && item.shortcut === "address"), "Browser shortcut used its original conversation");
  result.cursorRouting = true;
  await service.request(first.webContents, "present-frame", { context: "alpha", tabId: a.id });
  await service.request(first.webContents, "detach", { context: "alpha" });
  await assert.rejects(service.execute("playwright_locator_click", { browser_id: alpha.id, tab_id: a.id, selector: "#count" }), /another conversation/);
  assert.equal(await a.evaluate("window.count"), 1);
  assert.equal(beta.attachedTab, a);
  result.staleReplies = true;

  stage("opt-out and live setting changes");
  service.setSharedTabsAcrossConversations(false);
  assert.deepEqual([...alpha.tabs.keys()], [a.id]);
  assert.deepEqual([...beta.tabs.keys()], [b.id]);
  assert.equal(beta.activeTabId, b.id);
  assert.equal((await service.execute("list_tabs", { browser_id: beta.id })).sharedTabsAcrossConversations, false);
  const gamma = await switchContext(first, "gamma");
  assert.equal(gamma.tabs.size, 0);
  const c = await openPage(first, gamma, "c");
  assert.equal(alpha.tabs.has(c.id), false); assert.equal(beta.tabs.has(c.id), false);
  result.optOut = true;
  service.setSharedTabsAcrossConversations(true);
  for (const host of [alpha, beta, gamma]) assert.deepEqual([...host.tabs.keys()], [a.id, b.id, c.id]);
  assert.equal(await a.evaluate("window.identity"), identity);
  assert.equal(await a.evaluate("document.querySelector('#draft').value"), "Unsubmitted draft");
  result.togglePreservesPages = true;

  stage("cross-window broadcasts and creator window close");
  const second = await makeWindow("delta");
  const delta = service.attach(second.webContents, "delta");
  await service.request(second.webContents, "select", { context: "delta", tabId: a.id });
  service.closeTab(delta, c);
  assert.equal(c.destroyed, true);
  await until(async () => !(await first.webContents.executeJavaScript("window.latestBrowserState")).tabs.some(tab => tab.id === c.id), "Closing a shared tab left the other window stale");
  await a.evaluate("document.title='Updated shared title'");
  await until(async () => (await second.webContents.executeJavaScript("window.latestBrowserState")).tabs.some(tab => tab.id === a.id && tab.title === "Updated shared title"), "Current window did not receive the shared title");
  service.setBounds(first.webContents, { context: "gamma", x: 10, y: 10, width: 400, height: 400, visible: true, composited: true });
  assert.equal(delta.attachedTab, a, "A background window stole the native view");
  result.crossWindowUpdates = true;
  first.destroy();
  assert.equal(a.destroyed, false); assert.equal(b.destroyed, false);
  assert.equal(await a.evaluate("window.identity"), identity);
  await service.execute("playwright_locator_click", { browser_id: delta.id, tab_id: a.id, selector: "#count" });
  assert.equal(await a.evaluate("window.count"), 2);
  result.windowClose = true;

  stage("persistence with sharing disabled and restored on demand");
  service.setSharedTabsAcrossConversations(false);
  service.sync(disabled);
  assert.equal(a.destroyed, true); assert.equal(b.destroyed, true); assert.deepEqual(service.tools(), []);
  const saved = JSON.parse(fs.readFileSync(path.join(root, "browser/tabs.json"), "utf8"));
  assert.deepEqual(saved.contexts.find(context => context.context === "alpha").urls, [`${base}/page/a`]);
  assert.deepEqual(saved.contexts.find(context => context.context === "beta").urls, [`${base}/page/b`]);
  assert.equal(saved.contexts.flatMap(context => context.urls).length, 2);
  service.sync(enabled); await service.settled;
  assert.equal(service.sharedTabsAcrossConversations, false);
  const restored = await switchContext(second, "alpha");
  assert.equal(restored.tabs.size, 1);
  await until(() => [...restored.tabs.values()].every(tab => tab.state().url === `${base}/page/a` && !tab.state().loading), "Isolated saved tabs did not restore");
  service.setSharedTabsAcrossConversations(true);
  assert.equal(restored.tabs.size, 2);
  await until(() => [...restored.tabs.values()].some(tab => tab.state().url === `${base}/page/b`), "Sharing did not restore the unopened conversation's saved tab");
  await switchContext(second, "beta");
  assert.equal(restored.tabs.size, 2, "Restoring a conversation duplicated shared pages");
  result.persistence = true;

  stage("legacy migration exceeding the shared new-tab limit");
  service.sync(disabled);
  const legacy = Array.from({ length: 25 }, (_, index) => ({ context: `legacy-${index}`, urls: ["about:blank"], activeIndex: 0, visible: false, annotations: [] }));
  fs.writeFileSync(path.join(root, "browser/tabs.json"), JSON.stringify({ contexts: legacy }));
  service.sync(enabled); await service.settled;
  const migrated = await switchContext(second, "migration");
  assert.equal(migrated.tabs.size, 25, "Shared migration dropped existing tabs or conflated identical URLs");
  assert.throws(() => service.createTab(migrated), /24 shared tabs/);
  service.setSharedTabsAcrossConversations(false);
  const legacyZero = await switchContext(second, "legacy-0");
  assert.equal(legacyZero.tabs.size, 1);
  service.setSharedTabsAcrossConversations(true);
  assert.equal(legacyZero.tabs.size, 25);
  const pages = [...legacyZero.tabs.values()];
  result.migration = true;
  service.sync(disabled);
  assert(pages.every(tab => tab.destroyed)); assert.deepEqual(service.tools(), []);
  await assert.rejects(service.execute("list_tabs", { browser_id: legacyZero.id }), /disabled/);
  result.revocation = true;
  stage("complete");
}).catch(error => { result.errors.push(error.stack || String(error)); }).finally(async () => {
  clearTimeout(watchdog);
  for (const window of windows) {
    if (!window.isDestroyed() && window.webContents.debugger.isAttached()) {
      window.webContents.debugger.removeAllListeners("message");
      await window.webContents.debugger.sendCommand("Page.stopScreencast").catch(() => {});
      window.webContents.debugger.detach();
    }
  }
  service.dispose();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  server?.close();
  report();
  await new Promise(resolve => setImmediate(resolve));
  app.exit(result.errors.length ? 1 : 0);
  process.exit(result.errors.length ? 1 : 0);
});

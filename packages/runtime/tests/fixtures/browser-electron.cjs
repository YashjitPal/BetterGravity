const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const [directory, sourcePlugins, scope = "full"] = process.argv.slice(2);
const plugins = path.join(directory, "plugins");
fs.cpSync(path.join(sourcePlugins, "in-built-browser"), path.join(plugins, "in-built-browser"), { recursive: true, filter: source => !/^\.env(?:\.|$)/i.test(path.basename(source)) });
app.setPath("userData", path.join(directory, "profile"));
fs.mkdirSync(path.join(directory, "downloads"));
app.setPath("downloads", path.join(directory, "downloads"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("enable-automation");
const { InBuiltBrowserService, registerBrowserChannels } = require(path.join(directory, "browser.cjs"));
const { installLayout, verifyPaneTabs, verifyPageTabs, verifyLayout, verifyPlayback } = require("./browser-layout.cjs");
const { verifyAgentBrowser } = require("./browser-agent.cjs");
const { verifyAgentTabIsolation } = require("./browser-agent-tabs.cjs");
const service = new InBuiltBrowserService(path.join(directory, "data"), plugins, path.join(directory, "home"));
const enabled = { schemaVersion: 1, themes: { enabled: [] }, plugins: { developerMode: true, enabled: ["in-built-browser"] }, reapplyAfterHostUpdate: false };
const disabled = { ...enabled, plugins: { developerMode: true, enabled: [] } };
const result = { errors: [] };
function stage(name) { result.stage = name; fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2)); }
stage("starting Electron");
const watchdog = setTimeout(() => { result.errors.push(`Browser QA timed out during ${result.stage}`); fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2)); app.exit(1); }, 150_000);
let server, window, mcp;
let requestId = 0;
const requests = new Map(), notifications = [];
function rpc(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 6000);
    requests.set(id, value => { clearTimeout(timer); value.error ? reject(new Error(value.error.message)) : resolve(value.result); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 6000) { const end = Date.now() + timeout; while (!await predicate()) { if (Date.now() > end) throw new Error(label); await delay(35); } }
const pluginDir = path.join(plugins, "in-built-browser");
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Browser QA · Local workspace</title><style>body{font:16px system-ui;margin:0;background:#f6f7fb;color:#18202d}.page{max-width:700px;margin:55px auto;padding:0 38px}small{color:#627187}h1{font-size:34px;letter-spacing:-1px;margin:12px 0}p{line-height:1.6}label{display:block;margin-top:18px}input,select,button{font:inherit;padding:10px 14px;border:1px solid #d6dce6;border-radius:9px}button{background:#1c50cb;color:white;border:0;cursor:pointer}input[type=checkbox]{margin:18px 8px 18px 0}section{height:950px}nav{height:52px;padding:0 28px;background:white;display:flex;align-items:center;border-bottom:1px solid #dfe4ee;font-weight:650}</style></head><body><nav>Local workspace <span style="margin-left:auto;color:#6b778f;font-weight:400">Preview</span></nav><main class="page"><small>BETTERGRAVITY / BROWSER TEST</small><h1>A browser beside your work.</h1><p>One page for you and your model. This is served on localhost and runs inside an isolated Chromium tab.</p><label for="name">Name</label><input id="name" placeholder="Your name"><label><input type="checkbox" id="check">Preview enabled</label><button id="counter">Count: 0</button><button id="dialog">Show dialog</button><p id="output">Ready for interaction</p><label for="theme">Theme</label><select id="theme"><option value="light">Light</option><option value="dark">Dark</option></select><p><a href="/fixture#next" id="next">Next section</a> · <a href="/download" id="download">Download sample</a> · <a href="/popup" target="_blank" id="popup">Open another tab</a></p><iframe title="Nested test" id="frame" src="/frame"></iframe><section></section><p id="bottom">End of page</p></main><script>window.clicks=0;window.trusted=false;counter.onclick=e=>{window.trusted=e.isTrusted;counter.textContent='Count: '+(++window.clicks);output.textContent='Clicked with native browser input'};dialog.onclick=()=>alert('Browser dialog');</script></body></html>`;
const harness = `<!doctype html><html><head><title>BetterGravity Browser QA</title><link rel="stylesheet" href="/browser.css"><style>*{box-sizing:border-box}body{margin:0;background:#101010;color:#ddd;font:14px system-ui}.title{height:44px;background:#171717;border-bottom:1px solid #262626;padding:11px 20px}.layout{height:calc(100vh - 44px);display:flex}.chat{width:40%;display:flex;flex-direction:column;padding:30px;gap:20px;border-right:1px solid #292929}.conversation{display:flex;flex-direction:column;flex:1;min-height:0}.thread{flex:1;min-height:0}.composer{border:1px solid #333;background:#222;padding:18px;border-radius:22px}.pane{width:60%;height:100%}.pane-inner{height:100%;display:flex;flex-direction:column}.toolbar{display:flex;align-items:center;gap:5px;height:40px;border-bottom:1px solid #262626;padding:4px 10px}.toolbar button{color:#a7a7a7;background:transparent;border:0;border-radius:8px;padding:6px;cursor:pointer}.content{flex:1;overflow:hidden;min-height:0}.overview{padding:26px;color:#999}h2{font-size:15px;font-weight:500}p{line-height:1.6}</style></head><body><div class="title">BetterGravity</div><div class="layout"><section class="chat"><h2>Build an in-app browser</h2><div class="conversation" data-testid="conversation-view"><div class="thread"><p>Open localhost, review a website, and work with the model in the same browser pane.</p><p style="color:#868686">The browser lives beside the conversation.</p></div><div class="composer" contenteditable="true" role="textbox">Ask anything…</div></div></section><section class="pane" data-aux-pane-open="true"><div class="pane-inner"><header class="toolbar" data-active-tab-id="overview"><div><button data-tab-id="overview" aria-label="Overview tab">▤</button><button data-tab-id="review" aria-label="Review tab">▧</button><button data-tab-id="terminal" aria-label="Terminal tab">▣</button></div></header><div class="content"><div class="overview">Subagents<br><br>Files Changed<br><br>Artifacts<br><br>Terminals</div></div></div></section></div><script>const disposers=[];window.testDisposers=disposers;window.plugin={browser:{...window.browserHarness,available:true},settings:{define:s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,v.default]))},dom:{observe:(selector,callback)=>document.querySelectorAll(selector).forEach(callback)},patcher:{after:(target,key,callback)=>{const old=target[key];target[key]=function(...args){const result=old.apply(this,args);callback();return result};disposers.push(()=>target[key]=old)}},onDispose:fn=>disposers.push(fn),ui:{toast:()=>{}}};</script><script src="/plugin.js"></script></body></html>`;

async function run() {
  stage("app ready");
  service.sync(disabled); await service.settled;
  assert.equal(service.tools().length, 0); assert.equal(fs.existsSync(service.registration.mcpConfig), false); result.disabledInitially = true;
  mcp = spawn("node", [path.join(pluginDir, "mcp-server.cjs"), "--bridge", service.registration.descriptorFile], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  readline.createInterface({ input: mcp.stdout }).on("line", line => { const value = JSON.parse(line); if (value.id !== undefined) { requests.get(value.id)?.(value); requests.delete(value.id); } else notifications.push(value); });
  assert.equal((await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "browser-qa", version: "1" } })).instructions, undefined);
  assert.deepEqual((await rpc("tools/list")).tools, []);
  server = http.createServer((req, res) => {
    if (req.url === "/browser.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(fs.readFileSync(path.join(pluginDir, "styles/browser.css"))); }
    else if (req.url === "/tooltip.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(fs.readFileSync(path.join(sourcePlugins, "gemini-app/styles/tooltip.css"))); }
    else if (req.url === "/plugin.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(pluginDir, "index.js"))); }
    else if (req.url === "/frame") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end('<!doctype html><label>Frame name<input id="frame-name"></label><button onclick="this.textContent=\'Frame clicked\'">Frame button</button>'); }
    else if (req.url === "/download") { res.writeHead(200, { "content-type": "text/plain", "content-disposition": 'attachment; filename="browser-qa.txt"' }); res.end("Browser download fixture"); }
    else { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(req.url.startsWith("/c/") ? harness : fixture); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  service.sync(enabled); await service.settled;
  stage("service enabled");
  assert.equal(service.isEnabled, true, service.lastProblem);
  result.toolCount = service.tools().length;
  assert(result.toolCount > 65);
  assert(fs.existsSync(service.registration.mcpConfig)); result.registered = true;
  await until(() => notifications.length > 0, "MCP did not announce tool registration");
  assert.equal((await rpc("tools/list")).tools.length, result.toolCount);
  const instructions = (await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "browser-qa-enabled", version: "1" } })).instructions;
  const originalSkill = fs.readFileSync(path.join(pluginDir, "vendor/codex-instructions/skills/control-in-app-browser/SKILL.md"), "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").replace(/\r\n/g, "\n");
  assert(instructions.endsWith(originalSkill.trim()), "MCP initialization lost the original Codex instructions");
  assert(instructions.includes("# BetterGravity transport compatibility"));
  registerBrowserChannels(service);
  window = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { preload: path.join(__dirname, "browser-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  stage("loading host");
  await window.loadURL(`${base}/c/browser-qa`);
  // A hidden test window needs a capturer to advance compositor animations;
  // backgroundThrottling:false alone only keeps its JavaScript timers alive.
  window.webContents.debugger.attach("1.3");
  // Exercise the visible-pane handshake in this hidden test window as well.
  await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  window.webContents.debugger.on("message", (_event, method, params) => { if (method === "Page.screencastFrame") void window.webContents.debugger.sendCommand("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {}); });
  await window.webContents.debugger.sendCommand("Page.enable");
  await window.webContents.debugger.sendCommand("Page.startScreencast", { format: "png", maxWidth: 1, maxHeight: 1 });
  await installLayout(window);
  stage("host loaded");
  await until(() => service.hosts.size === 1, "Renderer did not attach to browser service");
  if (process.argv.includes("--control-only")) {
    const { verifyBrowserControl } = require("./browser-control.cjs");
    const host = [...service.hosts.values()][0];
    await service.request(window.webContents, "open", { context: host.context });
    await service.request(window.webContents, "navigate", { context: host.context, url: `${base}/fixture` });
    stage("browser input ownership and control transitions");
    await verifyBrowserControl(window, service, host, service.findTab(host), directory, result);
    return;
  }
  if (process.argv.includes("--pet-overlay-only")) {
    const { verifyPetOverlay } = require("./browser-pet-overlay.cjs");
    const host = [...service.hosts.values()][0];
    await service.request(window.webContents, "open", { context: host.context });
    await service.request(window.webContents, "navigate", { context: host.context, url: `${base}/fixture` });
    stage("pet and browser overlay handoff");
    await verifyPetOverlay(window, service, host, service.findTab(host), sourcePlugins, directory, result);
    return;
  }
  if (process.argv.includes("--paused-resize-only")) {
    const { verifyPausedResize } = require("./browser-resize.cjs");
    const host = [...service.hosts.values()][0];
    await service.request(window.webContents, "open", { context: host.context });
    await service.request(window.webContents, "navigate", { context: host.context, url: `${base}/fixture` });
    await verifyPausedResize(window, service, host, service.findTab(host), directory, result);
    return;
  }
  if (process.argv.includes("--visibility-only")) {
    const { verifyBrowserVisibility } = require("./browser-visibility.cjs");
    const host = [...service.hosts.values()][0];
    await service.request(window.webContents, "open", { context: host.context });
    await service.request(window.webContents, "navigate", { context: host.context, url: `${base}/fixture` });
    stage("conversation sidebar visibility");
    await verifyBrowserVisibility(window, service, host, service.findTab(host), result);
    return;
  }
  stage("cold tool call with the pane unmounted");
  await window.webContents.executeJavaScript(`window.qaSetPaneOpen(false, true)`);
  await until(() => window.webContents.executeJavaScript(`!document.querySelector('#bg-in-built-browser')`), "Closing the fixture pane did not unmount the browser");
  for (const existing of [...service.hosts.values()]) service.closeHost(existing);
  const browsers = await service.execute("list_browsers", {});
  assert.equal(browsers.length, 1);
  await until(() => window.webContents.executeJavaScript(`!!document.querySelector('#bg-in-built-browser:not([hidden])') && document.querySelector('[data-aux-pane-open]').dataset.auxPaneOpen === 'true'`), "The first browser tool did not open the pane");
  await service.execute("create_tab", { browser_id: browsers[0].id });
  result.coldAutoOpen = true;
  await until(() => [...service.hosts.values()][0].tabs.size === 1, "Browser tool did not open a tab");
  await delay(150);
  const host = [...service.hosts.values()][0];
  stage("capturing empty browser");
  fs.writeFileSync(path.join(directory, "browser-empty.png"), (await window.webContents.capturePage()).toPNG());
  stage("navigating localhost");
  await service.request(window.webContents, "navigate", { context: host.context, url: `${base}/fixture` });
  await until(() => !!host.attachedTab, "Native page was not placed inside pane"); result.nativeViewAttached = true;
  const tab = service.findTab(host);
  tab.contents.debugger.on("message", (_event, method, params) => { if (method === "Page.screencastFrame") tab.qaFrameMeta = params.metadata; });
  if (scope === "full") {
    stage("native tab selection and shared resizer");
    await verifyPaneTabs(window, service, host, tab, result);
    stage("shared file/browser tabs, native + menu and hover alignment");
    await verifyPageTabs(window, service, host, tab, result);
    stage("native layout, resizer and overlay compositing");
    await verifyLayout(window, service, host, tab, directory, result);
  }
  stage("agent auto-open and native cursor animations");
  await verifyAgentBrowser(window, service, host, tab, directory, result);
  if (scope === "agent") {
    // Keep the multi-tab lifecycle in its own Electron case so its page and
    // compositor state cannot contaminate the extracted-client checks below.
    stage("agent tab isolation");
    await verifyAgentTabIsolation(window, service, host, tab, result);
    stage("disabling active browser controls");
    await window.webContents.executeJavaScript(`window.qaSetTaskStatus(2)`);
    const pending = service.execute("playwright_wait_for_timeout", { browser_id: host.id, tab_id: tab.id, timeout_ms: 5000 }).then(() => false, () => true);
    await until(() => !!host.activity, "The browser task did not start before disable");
    service.sync(disabled); result.cancelledAction = await pending;
    assert.equal(service.tools().length, 0); assert.equal(tab.destroyed, true);
    await until(() => window.webContents.executeJavaScript(`document.querySelector('.bg-browser-cursor-layer').hidden && document.querySelector('[data-testid="browser-agent-border"]').hidden && document.querySelector('[data-testid="browser-agent-dock"]').hidden`), "Disabling the plugin left the controls active");
    await window.webContents.executeJavaScript(`window.testDisposers.slice().reverse().forEach(dispose=>dispose())`);
    assert.equal(await window.webContents.executeJavaScript(`window.qaTaskListeners.size`), 0);
    assert.equal(await window.webContents.executeJavaScript(`window.qaResponseListeners.size`), 0);
    assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('#bg-in-built-browser')`), false);
    result.toolsRevoked = true;
    return;
  }
  result.localhost = tab.contents.getURL() === `${base}/fixture`;
  assert.notEqual(tab.contents.session, window.webContents.session);
  assert.equal(await tab.evaluate("typeof require"), "undefined");
  assert.equal(await tab.evaluate("typeof window.__betterGravityBridge"), "undefined");
  assert.equal(await tab.evaluate("/Electron\\/|Antigravity\\//.test(navigator.userAgent)"), false);
  assert.equal(await tab.evaluate("navigator.webdriver"), false);
  assert.equal(await window.webContents.executeJavaScript("navigator.webdriver"), true, "Browser preferences changed the host shell");
  const { setupBrowserRuntime } = await import(pathToFileURL(path.join(pluginDir, "scripts/browser-client.mjs")).href);
  const agent = await setupBrowserRuntime({ bridgeFile: service.registration.descriptorFile });
  stage("using extracted client");
  const browser = await agent.browsers.get(host.id);
  const documentation = await browser.documentation();
  assert(documentation.includes(fs.readFileSync(path.join(pluginDir, "vendor/codex-instructions/docs/api-use-behavior.md"), "utf8")));
  const localGuide = await agent.documentation.get("local-web-development");
  assert(localGuide.endsWith(fs.readFileSync(path.join(pluginDir, "vendor/codex-instructions/docs/local-web-development.md"), "utf8")));
  await assert.rejects(() => agent.documentation.get("../api"), /Unknown browser documentation/);
  result.codexInstructions = true;
  stage("selected browser through client");
  const shared = await browser.tabs.get(tab.id);
  stage("selected tab through client");
  await shared.playwright.getByLabel("Name", { exact: true }).fill("Shared browser");
  stage("filled name");
  await shared.playwright.getByRole("button", { name: "Count: 0", exact: true }).click();
  stage("clicked button");
  assert.equal(await tab.evaluate("document.querySelector('#name').value"), "Shared browser");
  await until(async () => (await tab.evaluate("window.clicks")) === 1, "Native button click was not received by page", 5000);
  assert.equal(await tab.evaluate("window.clicks"), 1);
  result.trustedClick = await tab.evaluate("window.trusted");
  await shared.playwright.getByLabel("Preview enabled").check();
  assert.equal(await tab.evaluate("document.querySelector('#check').checked"), true);
  await shared.playwright.getByLabel("Theme", { exact: true }).selectOption("dark");
  assert.equal(await tab.evaluate("document.querySelector('#theme').value"), "dark");
  const snapshot = await shared.playwright.domSnapshot(); assert(snapshot.includes("Count: 1"));
  assert.equal(await shared.playwright.getByRole("button", { name: "Count: 1" }).count(), 1);
  result.extractedClient = true;
  stage("evaluating through original client");
  assert.equal(await shared.playwright.evaluate(() => document.querySelector("#name").value), "Shared browser");
  assert.equal(await shared.playwright.getByLabel("Name", { exact: true }).evaluate((element, suffix) => element.value + suffix, "!"), "Shared browser!");
  assert.equal((await shared.playwright.getByRole("button").evaluateAll(elements => elements.map(e => e.textContent))).length, 2);
  await shared.playwright.evaluate(() => { window.scrollTo(0, 0); const marker = document.createElement("div"); marker.id = "fresh-paint"; marker.style.cssText = "position:fixed;top:8px;left:8px;width:20px;height:20px;background:rgb(255,0,0);z-index:99"; document.body.append(marker); });
  await shared.screenshot();
  await shared.playwright.evaluate(() => document.querySelector("#fresh-paint").style.backgroundColor = "rgb(0,255,0)");
  stage("capturing fresh full and cropped screenshots");
  const cropped = await shared.screenshot({ clip: { x: 8, y: 8, width: 20, height: 20 } });
  const cropImage = nativeImage.createFromBuffer(Buffer.from(cropped));
  const pixel = cropImage.resize({ width: 1, height: 1 }).toBitmap();
  assert(pixel[1] > 240 && pixel[0] < 15 && pixel[2] < 15, `Screenshot contains stale pixels: ${[...pixel]}`);
  const full = await shared.screenshot({ fullPage: true });
  assert(nativeImage.createFromBuffer(Buffer.from(full)).getSize().height > 1500);
  fs.writeFileSync(path.join(directory, "browser-full.png"), Buffer.from(full)); result.fullScreenshot = true; result.freshScreenshot = true;
  await shared.playwright.evaluate(() => document.querySelector("#fresh-paint").remove());
  const shot = await shared.screenshot({ fullPage: false });
  assert(shot instanceof Uint8Array); assert(shot.byteLength > 1000); result.screenshot = true;
  fs.writeFileSync(path.join(directory, "browser-page.png"), Buffer.from(shot));
  // Snapshot browser chrome separately: native child views are separate surfaces.
  await service.request(window.webContents, "history", { context: host.context, query: "fixture" });
  fs.writeFileSync(path.join(directory, "browser-chrome.png"), (await window.webContents.capturePage()).toPNG());
  const layout = await window.webContents.executeJavaScript(`(()=>{const c=document.querySelector('[data-testid="conversation-view"]');return {display:getComputedStyle(c).display,height:c.firstElementChild.getBoundingClientRect().height}})()`);
  assert.equal(layout.display, "flex"); assert(layout.height > 300); result.layoutPreserved = true;
  stage("concurrent download and navigation waits");
  const downloading = shared.playwright.waitForEvent("download", { timeoutMs: 8000 });
  await delay(80);
  const [downloaded] = await Promise.all([downloading, shared.playwright.getByRole("link", { name: "Download sample" }).click()]);
  assert.equal(fs.readFileSync(await downloaded.path(), "utf8"), "Browser download fixture");
  await Promise.all([shared.playwright.waitForURL("**/fixture#next", { timeoutMs: 8000 }), shared.playwright.getByRole("link", { name: "Next section" }).click()]);
  result.concurrentWaits = true;
  stage("file chooser through the extracted client");
  const uploadPath = path.join(directory, "browser-upload.txt"); fs.writeFileSync(uploadPath, "Only this selected file");
  await shared.playwright.evaluate(() => { const label = document.createElement("label"); label.textContent = "Upload sample"; const input = document.createElement("input"); input.type = "file"; input.id = "upload"; label.append(input); document.querySelector("main").prepend(label); });
  const choosing = shared.playwright.waitForEvent("filechooser", { timeoutMs: 8000 });
  await until(() => tab.waitingForFileChooser, "File chooser interception was not armed");
  await shared.playwright.getByLabel("Upload sample").click();
  const chooser = await choosing; assert.equal(chooser.isMultiple(), false);
  await assert.rejects(() => chooser.setFiles([path.join(directory, ".env")]), /Environment files/);
  await chooser.setFiles([uploadPath]);
  assert.equal(await shared.playwright.evaluate(() => document.querySelector("#upload").files[0].text()), "Only this selected file"); result.fileUpload = true;
  stage("frame locators and native popups");
  await shared.playwright.frameLocator("#frame").getByLabel("Frame name").fill("Nested frame");
  await shared.playwright.frameLocator("#frame").getByRole("button", { name: "Frame button" }).click();
  assert.equal(await shared.playwright.frameLocator("#frame").getByRole("button", { name: "Frame clicked" }).count(), 1);
  stage("opening a native popup tab");
  await shared.playwright.getByRole("link", { name: "Open another tab" }).click();
  await until(() => host.tabs.size === 2, "Popup did not open in a native browser tab");
  await service.request(window.webContents, "select", { context: host.context, tabId: tab.id }); result.framesAndPopups = true;
  stage("dialogs without blocked action queue");
  const clickingDialog = shared.playwright.getByRole("button", { name: "Show dialog" }).click();
  await until(() => !!tab.dialog, "Page dialog was not intercepted");
  const jsDialog = await service.execute("tab_get_js_dialog", { browser_id: host.id, tab_id: tab.id });
  await service.execute("tab_handle_js_dialog", { browser_id: host.id, tab_id: tab.id, dialog_id: jsDialog.dialog.id, action: "accept" });
  await clickingDialog; await until(() => !tab.dialog, "Dialog was not dismissed");
  await until(() => host.bounds?.visible && host.attachedTab === tab, "Closing the dialog did not restore the page"); result.dialogs = true;
  stage("annotations and live style preview");
  const finishAnnotationPaint = await tab.keepPainting();
  stage("scrolling the annotation target into view");
  await shared.playwright.getByRole("button", { name: "Count: 1" }).evaluate(element => element.scrollIntoView({ block: "center" }));
  // Let the hidden test window paint the scroll before sending pointer input.
  stage("waiting for the annotation target's frame");
  try { await tab.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))"); }
  catch (error) { result.annotationFrameDebug = { mode:tab.paintMode,count:tab.paintCount,composited:tab.composited,bounds:host.bounds,view:tab.view.getBounds(),frame:tab.frameSequence,dialog:!!tab.dialog,tabError:tab.error }; throw error; }
  stage("selecting a page annotation");
  await service.request(window.webContents, "annotate", { context: host.context, enabled: true });
  const counter = await tab.driver({ action: "bounds", selector: "#counter" });
  await tab.click(counter.x, counter.y);
  try { await until(() => !!host.selection, "Selecting a page element did not create a comment"); }
  catch (error) {
    result.annotationDebug = { counter, bounds:host.bounds, view:tab.view.getBounds(), attached:host.attachedTab===tab, tabError:tab.error,
      page:await tab.evaluate(`({width:innerWidth,height:innerHeight,scroll:scrollY,clicks:window.clicks,hit:document.elementFromPoint(${counter.x},${counter.y})?.outerHTML?.slice(0,200),counter:document.querySelector('#counter').getBoundingClientRect().toJSON()})`),
      host:await window.webContents.executeJavaScript(`({open,compositing,overlay:overlay?.dataset.kind,stateDialog:state?.dialog,rootHidden:root.hidden})`) };
    throw error;
  }
  assert.equal(await tab.evaluate("window.clicks"), 1, "Annotation selection clicked the page button");
  await until(() => host.bounds?.visible === true && host.attachedTab === tab, "Annotation hid the live page");
  const preview = await service.request(window.webContents, "style-preview", { context: host.context, tabId: tab.id, selector: "#counter", styles: { color: "rgb(1, 2, 3)" } });
  assert.equal(await tab.evaluate("getComputedStyle(document.querySelector('#counter')).color"), "rgb(1, 2, 3)");
  await service.request(window.webContents, "style-restore", { context: host.context, tabId: tab.id, selector: "#counter", original: preview.original });
  assert.notEqual(await tab.evaluate("getComputedStyle(document.querySelector('#counter')).color"), "rgb(1, 2, 3)");
  await service.request(window.webContents, "save-annotation", { context: host.context, comment: "Keep this button visible" });
  assert.equal((await service.execute("browser_annotations", { browser_id: host.id })).annotations.length, 1); result.annotations = true;
  await finishAnnotationPaint();
  stage("original CDP capability and MCP manifest updates");
  await service.request(window.webContents, "configure", { context: host.context, developerMode: true });
  assert.equal((await rpc("tools/list")).tools.length, result.toolCount + 2);
  const developerBrowser = await agent.browsers.get(host.id), developerTab = await developerBrowser.tabs.get(tab.id);
  const cdp = await developerTab.capabilities.get("cdp");
  const version = await cdp.send("Runtime.evaluate", { expression: "2+2", returnByValue: true });
  assert.equal(version.result.value, 4);
  const baseline = await cdp.readEvents();
  await cdp.send("Runtime.evaluate", { expression: "performance.mark('browser-qa')" });
  await cdp.send("Page.navigate", { url: `${base}/fixture?cdp=1` });
  await shared.playwright.waitForLoadState();
  const events = await cdp.readEvents({ afterSequence: baseline.cursor, limit: 1 });
  assert(events.events.length === 1 && events.hasMore && events.cursor > baseline.cursor);
  const nextEvents = await cdp.readEvents({ afterSequence: events.cursor, limit: 1000 });
  assert(nextEvents.events.every(event => event.sequence > events.cursor));
  const beforeBurst = tab.eventSequence;
  await tab.cdp("Runtime.addBinding", { name: "bgQaEvent" });
  await tab.cdp("Runtime.evaluate", { expression: "for(let n=0;n<510;n++)bgQaEvent('{}')" });
  await until(() => tab.eventSequence >= beforeBurst + 510, "CDP event burst was not recorded");
  // Existing events keep their monotonic identity when the bounded buffer evicts.
  assert(tab.events.every((event, i) => !i || event.sequence > tab.events[i - 1].sequence));
  assert.equal((await cdp.readEvents({ afterSequence: beforeBurst })).truncated, true);
  await tab.cdp("Runtime.removeBinding", { name: "bgQaEvent" });
  await service.request(window.webContents, "viewport", { context: host.context, width: 390, height: 844 });
  assert.equal(await tab.evaluate("innerWidth"), 390);
  await service.request(window.webContents, "viewport", { context: host.context, width: null, height: null });
  result.cdpAndViewport = true;
  stage("pausing a pending JavaScript action");
  const evaluating = shared.playwright.evaluate(() => new Promise(() => {})).then(() => false, () => true);
  await delay(120); await service.request(window.webContents, "pause", { context: host.context });
  assert.equal(await evaluating, true); assert.equal(host.paused, true);
  await service.request(window.webContents, "resume", { context: host.context });
  assert.equal(await shared.playwright.evaluate(() => 7), 7); result.pausedAction = true;
  // The user takes control before the manual native/composited playback check.
  await service.request(window.webContents, "pause", { context: host.context });
  await service.request(window.webContents, "resume", { context: host.context });
  await until(() => !host.bounds.composited, "Idle browser controls did not finish fading before playback");
  await verifyPlayback(window, service, host, tab, result, stage);
  await service.request(window.webContents, "resume", { context: host.context });
  await window.webContents.executeJavaScript(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();const tip=document.createElement('div');tip.setAttribute('role','tooltip');tip.style.cssText='position:fixed;width:80px;height:40px;left:'+(r.x+10)+'px;top:'+(r.y+10)+'px';document.body.append(tip)})()`);
  await until(() => host.bounds?.composited && tab.frameSequence > 0, "Live compositor was not running before disable");
  const descriptor = JSON.parse(fs.readFileSync(service.registration.descriptorFile, "utf8"));
  const notificationCount = notifications.length;
  const pending = service.execute("playwright_wait_for_timeout", { browser_id: host.id, tab_id: tab.id, timeout_ms: 5000 }).then(() => false, () => true);
  await delay(70); service.sync(disabled);
  result.cancelledAction = await pending;
  assert.equal(service.tools().length, 0); assert.equal(service.hosts.size, 0); assert.equal(tab.destroyed, true); assert.equal(fs.existsSync(service.registration.descriptorFile), false);
  const config = JSON.parse(fs.readFileSync(service.registration.mcpConfig, "utf8")); assert.equal(config.mcpServers["in-built-browser"], undefined);
  await assert.rejects(() => shared.playwright.domSnapshot(), /disabled|not running/);
  await assert.rejects(() => fetch(`${descriptor.url}/tools`, { headers: { Authorization: `Bearer ${descriptor.token}` } }));
  await until(() => notifications.length > notificationCount, "MCP did not announce tool removal");
  assert.deepEqual((await rpc("tools/list")).tools, []);
  assert.equal((await rpc("initialize", {})).instructions, undefined, "Disabled MCP advertised browser instructions");
  assert.equal((await rpc("tools/call", { name: "list_browsers", arguments: {} })).isError, true);
  result.toolsRevoked = true;
  await until(() => window.webContents.executeJavaScript(`document.querySelector('.bg-browser-cursor-layer').hidden && document.querySelector('[data-testid="browser-agent-border"]').hidden`), "Disabling the browser left the agent indicators active");
  await window.webContents.executeJavaScript(`window.testDisposers.slice().reverse().forEach(dispose=>dispose())`);
  assert.equal(await window.webContents.executeJavaScript(`window.qaTaskListeners.size`), 0, "Disabling the plugin leaked the host task subscription");
  assert.equal(await window.webContents.executeJavaScript(`window.qaResponseListeners.size`), 0, "Disabling the plugin leaked the live response subscription");
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('#bg-in-built-browser, [data-bg-browser-resize-handle], [data-bg-browser-split], [data-bg-browser-page-tab], [data-bg-browser-new-tab], [data-bg-browser-tab-host]')`), false);
  assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('[data-testid="conversation-view"]')).display`), "flex");
  service.sync(enabled); await service.settled; assert.equal(service.isEnabled, true, service.lastProblem); result.reenabled = true;
  const restored = await service.request(window.webContents, "attach", { context: host.context });
  assert.equal(restored.tabs.length, 2); assert.equal(restored.annotations.length, 1); result.tabsRestored = true;
  const serverScript = path.join(pluginDir, "mcp-server.cjs");
  fs.renameSync(serverScript, `${serverScript}.disabled`); service.sync(enabled);
  assert.equal(service.isEnabled, false); assert.equal(service.tools().length, 0); result.uninstallRevokes = true;
  fs.renameSync(`${serverScript}.disabled`, serverScript); service.sync(enabled); await service.settled;
  assert.equal(service.isEnabled, true, service.lastProblem);
  service.sync({ ...enabled, plugins: { developerMode: false, enabled: ["in-built-browser"] } }); assert.equal(service.isEnabled, false); assert.equal(service.tools().length, 0);
}

app.whenReady().then(run).catch(error => { result.errors.push(error.stack || String(error)); }).finally(async () => {
  clearTimeout(watchdog);
  // This hidden-window harness owns a keep-alive screencast. Stop its callback
  // before destroying the window; Electron 38 can otherwise acknowledge a late
  // frame during V8 shutdown and crash after every assertion has passed.
  if (window && !window.isDestroyed() && window.webContents.debugger.isAttached()) {
    window.webContents.debugger.removeAllListeners("message");
    await window.webContents.debugger.sendCommand("Page.stopScreencast").catch(() => {});
    window.webContents.debugger.detach();
  }
  service.dispose();
  try { mcp?.stdin.end(); mcp?.kill(); } catch {}
  if (window && !window.isDestroyed()) window.destroy();
  server?.close();
  fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  await new Promise(resolve => setImmediate(resolve));
  app.exit(result.errors.length ? 1 : 0);
});

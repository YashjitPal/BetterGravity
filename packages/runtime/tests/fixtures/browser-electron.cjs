const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const [directory, plugins] = process.argv.slice(2);
app.setPath("userData", path.join(directory, "profile"));
app.disableHardwareAcceleration();
const { InBuiltBrowserService, registerBrowserChannels } = require(path.join(directory, "browser.cjs"));
const service = new InBuiltBrowserService(path.join(directory, "data"), plugins, path.join(directory, "home"));
const enabled = { schemaVersion: 1, themes: { enabled: [] }, plugins: { developerMode: true, enabled: ["in-built-browser"] }, reapplyAfterHostUpdate: false };
const disabled = { ...enabled, plugins: { developerMode: true, enabled: [] } };
const result = { errors: [] };
function stage(name) { result.stage = name; fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2)); }
stage("starting Electron");
const watchdog = setTimeout(() => { result.errors.push(`Browser QA timed out during ${result.stage}`); fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2)); app.exit(1); }, 55_000);
let server, window;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 6000) { const end = Date.now() + timeout; while (!await predicate()) { if (Date.now() > end) throw new Error(label); await delay(35); } }
const pluginDir = path.join(plugins, "in-built-browser");
const fixture = `<!doctype html><html><head><title>Browser QA · Local workspace</title><style>body{font:16px system-ui;margin:0;background:#f6f7fb;color:#18202d}.page{max-width:700px;margin:55px auto;padding:0 38px}small{color:#627187}h1{font-size:34px;letter-spacing:-1px;margin:12px 0}p{line-height:1.6}label{display:block;margin-top:18px}input,select,button{font:inherit;padding:10px 14px;border:1px solid #d6dce6;border-radius:9px}button{background:#1c50cb;color:white;border:0;cursor:pointer}input[type=checkbox]{margin:18px 8px 18px 0}section{height:950px}nav{height:52px;padding:0 28px;background:white;display:flex;align-items:center;border-bottom:1px solid #dfe4ee;font-weight:650}</style></head><body><nav>Local workspace <span style="margin-left:auto;color:#6b778f;font-weight:400">Preview</span></nav><main class="page"><small>BETTERGRAVITY / BROWSER TEST</small><h1>A browser beside your work.</h1><p>One page for you and your model. This is served on localhost and runs inside an isolated Chromium tab.</p><label for="name">Name</label><input id="name" placeholder="Your name"><label><input type="checkbox" id="check">Preview enabled</label><button id="counter">Count: 0</button><button id="dialog">Show dialog</button><p id="output">Ready for interaction</p><label for="theme">Theme</label><select id="theme"><option value="light">Light</option><option value="dark">Dark</option></select><section></section><p id="bottom">End of page</p></main><script>window.clicks=0;window.trusted=false;counter.onclick=e=>{window.trusted=e.isTrusted;counter.textContent='Count: '+(++window.clicks);output.textContent='Clicked with native browser input'};dialog.onclick=()=>alert('Browser dialog');</script></body></html>`;
const harness = `<!doctype html><html><head><title>BetterGravity Browser QA</title><link rel="stylesheet" href="/browser.css"><style>*{box-sizing:border-box}body{margin:0;background:#101010;color:#ddd;font:14px system-ui}.title{height:44px;background:#171717;border-bottom:1px solid #262626;padding:11px 20px}.layout{height:calc(100vh - 44px);display:flex}.chat{width:40%;display:flex;flex-direction:column;padding:30px;gap:20px;border-right:1px solid #292929}.conversation{display:flex;flex-direction:column;flex:1;min-height:0}.thread{flex:1;min-height:0}.composer{border:1px solid #333;background:#222;padding:18px;border-radius:22px}.pane{width:60%;height:100%}.pane-inner{height:100%;display:flex;flex-direction:column}.toolbar{display:flex;align-items:center;gap:5px;height:40px;border-bottom:1px solid #262626;padding:4px 10px}.toolbar button{color:#a7a7a7;background:transparent;border:0;border-radius:8px;padding:6px;cursor:pointer}.content{flex:1;overflow:hidden;min-height:0}.overview{padding:26px;color:#999}h2{font-size:15px;font-weight:500}p{line-height:1.6}</style></head><body><div class="title">BetterGravity</div><div class="layout"><section class="chat"><h2>Build an in-app browser</h2><div class="conversation" data-testid="conversation-view"><div class="thread"><p>Open localhost, review a website, and work with the model in the same browser pane.</p><p style="color:#868686">The browser lives beside the conversation.</p></div><div class="composer" contenteditable="true" role="textbox">Ask anything…</div></div></section><section class="pane" data-aux-pane-open="true"><div class="pane-inner"><header class="toolbar" data-active-tab-id="overview"><div><button data-tab-id="overview" aria-label="Overview tab">▤</button><button data-tab-id="review" aria-label="Review tab">▧</button><button data-tab-id="terminal" aria-label="Terminal tab">▣</button></div></header><div class="content"><div class="overview">Subagents<br><br>Files Changed<br><br>Artifacts<br><br>Terminals</div></div></div></section></div><script>const disposers=[];window.testDisposers=disposers;window.plugin={browser:{...window.browserHarness,available:true},settings:{define:s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,v.default]))},dom:{observe:(selector,callback)=>document.querySelectorAll(selector).forEach(callback)},patcher:{after:(target,key,callback)=>{const old=target[key];target[key]=function(...args){const result=old.apply(this,args);callback();return result};disposers.push(()=>target[key]=old)}},onDispose:fn=>disposers.push(fn),ui:{toast:()=>{}}};</script><script src="/plugin.js"></script></body></html>`;

async function run() {
  stage("app ready");
  service.sync(disabled); await service.settled;
  assert.equal(service.tools().length, 0); assert.equal(fs.existsSync(service.registration.mcpConfig), false); result.disabledInitially = true;
  server = http.createServer((req, res) => {
    if (req.url === "/browser.css") { res.writeHead(200, { "content-type": "text/css" }); res.end(fs.readFileSync(path.join(pluginDir, "styles/browser.css"))); }
    else if (req.url === "/plugin.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(fs.readFileSync(path.join(pluginDir, "index.js"))); }
    else { res.writeHead(200, { "content-type": "text/html" }); res.end(req.url.startsWith("/c/") ? harness : fixture); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  service.sync(enabled); await service.settled;
  stage("service enabled");
  assert.equal(service.isEnabled, true, service.lastProblem);
  result.toolCount = service.tools().length;
  assert(result.toolCount > 65);
  assert(fs.existsSync(service.registration.mcpConfig)); result.registered = true;
  registerBrowserChannels(service);
  window = new BrowserWindow({ show: false, width: 1300, height: 850, webPreferences: { preload: path.join(__dirname, "browser-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  stage("loading host");
  await window.loadURL(`${base}/c/browser-qa`);
  stage("host loaded");
  await until(() => service.hosts.size === 1, "Renderer did not attach to browser service");
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Browser tab"]').click()`);
  stage("browser button clicked");
  await until(() => [...service.hosts.values()][0].tabs.size === 1, "Browser button did not open a tab");
  await delay(150);
  const host = [...service.hosts.values()][0];
  result.buttonPosition = await window.webContents.executeJavaScript(`document.querySelector('[data-tab-id="terminal"]').nextElementSibling?.getAttribute('aria-label') === 'Browser tab'`);
  stage("capturing empty browser");
  fs.writeFileSync(path.join(directory, "browser-empty.png"), (await window.webContents.capturePage()).toPNG());
  stage("navigating localhost");
  await service.request(window.webContents, "navigate", { context: host.context, url: `${base}/fixture` });
  await until(() => !!host.attachedTab, "Native page was not placed inside pane"); result.nativeViewAttached = true;
  const tab = service.findTab(host);
  result.localhost = tab.contents.getURL() === `${base}/fixture`;
  assert.notEqual(tab.contents.session, window.webContents.session);
  assert.equal(await tab.evaluate("typeof require"), "undefined");
  assert.equal(await tab.evaluate("typeof window.__betterGravityBridge"), "undefined");
  const { setupBrowserRuntime } = await import(pathToFileURL(path.join(pluginDir, "scripts/browser-client.mjs")).href);
  const agent = await setupBrowserRuntime({ bridgeFile: service.registration.descriptorFile });
  stage("using extracted client");
  const browser = await agent.browsers.get(host.id);
  stage("selected browser through client");
  const shared = await browser.tabs.get(tab.id);
  stage("selected tab through client");
  await shared.playwright.getByLabel("Name", { exact: true }).fill("Shared browser");
  stage("filled name");
  await shared.playwright.getByRole("button", { name: "Count: 0", exact: true }).click();
  stage("clicked button");
  assert.equal(await tab.evaluate("document.querySelector('#name').value"), "Shared browser");
  assert.equal(await tab.evaluate("window.clicks"), 1);
  result.trustedClick = await tab.evaluate("window.trusted");
  await shared.playwright.getByLabel("Preview enabled").check();
  assert.equal(await tab.evaluate("document.querySelector('#check').checked"), true);
  await shared.playwright.getByLabel("Theme", { exact: true }).selectOption("dark");
  assert.equal(await tab.evaluate("document.querySelector('#theme').value"), "dark");
  const snapshot = await shared.playwright.domSnapshot(); assert(snapshot.includes("Count: 1"));
  assert.equal(await shared.playwright.getByRole("button", { name: "Count: 1" }).count(), 1);
  result.extractedClient = true;
  const shot = await shared.screenshot({ fullPage: false });
  assert(shot instanceof Uint8Array); assert(shot.byteLength > 1000); result.screenshot = true;
  fs.writeFileSync(path.join(directory, "browser-page.png"), Buffer.from(shot));
  // Snapshot browser chrome separately: native child views are separate surfaces.
  await service.request(window.webContents, "history", { context: host.context, query: "fixture" });
  fs.writeFileSync(path.join(directory, "browser-chrome.png"), (await window.webContents.capturePage()).toPNG());
  const layout = await window.webContents.executeJavaScript(`(()=>{const c=document.querySelector('[data-testid="conversation-view"]');return {display:getComputedStyle(c).display,height:c.firstElementChild.getBoundingClientRect().height}})()`);
  assert.equal(layout.display, "flex"); assert(layout.height > 300); result.layoutPreserved = true;
  const descriptor = JSON.parse(fs.readFileSync(service.registration.descriptorFile, "utf8"));
  const pending = service.execute("playwright_wait_for_timeout", { browser_id: host.id, tab_id: tab.id, timeout_ms: 5000 }).then(() => false, () => true);
  await delay(70); service.sync(disabled);
  result.cancelledAction = await pending;
  assert.equal(service.tools().length, 0); assert.equal(service.hosts.size, 0); assert.equal(tab.destroyed, true); assert.equal(fs.existsSync(service.registration.descriptorFile), false);
  const config = JSON.parse(fs.readFileSync(service.registration.mcpConfig, "utf8")); assert.equal(config.mcpServers["in-built-browser"], undefined);
  await assert.rejects(() => shared.playwright.domSnapshot(), /disabled|not running/);
  await assert.rejects(() => fetch(`${descriptor.url}/tools`, { headers: { Authorization: `Bearer ${descriptor.token}` } }));
  result.toolsRevoked = true;
  service.sync(enabled); await service.settled; assert.equal(service.isEnabled, true, service.lastProblem); result.reenabled = true;
  service.sync({ ...enabled, plugins: { developerMode: false, enabled: ["in-built-browser"] } }); assert.equal(service.isEnabled, false); assert.equal(service.tools().length, 0);
}

app.whenReady().then(run).catch(error => { result.errors.push(error.stack || String(error)); }).finally(() => {
  clearTimeout(watchdog);
  service.dispose(); if (window && !window.isDestroyed()) window.destroy(); server?.close();
  fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  app.exit(result.errors.length ? 1 : 0);
});

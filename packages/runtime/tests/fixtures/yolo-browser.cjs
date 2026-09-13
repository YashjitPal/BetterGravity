const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const [directory, sourcePlugins] = process.argv.slice(2);
const plugins = path.join(directory, "plugins");
fs.cpSync(path.join(sourcePlugins, "in-built-browser"), path.join(plugins, "in-built-browser"), {
  recursive: true, filter: source => !/^\.env(?:\.|$)/i.test(path.basename(source))
});
app.setPath("userData", path.join(directory, "profile"));
app.disableHardwareAcceleration();
const { InBuiltBrowserService } = require(path.join(directory, "browser.cjs"));
const service = new InBuiltBrowserService(path.join(directory, "data"), plugins, path.join(directory, "home"));
const normal = { schemaVersion: 1, themes: { enabled: [] }, plugins: { developerMode: true, enabled: ["in-built-browser"] }, reapplyAfterHostUpdate: false };
const yolo = { ...normal, plugins: { developerMode: true, enabled: ["in-built-browser", "yolo"] } };
const result = { errors: [] };
const report = () => fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw new Error("Expected native dialog did not appear"); await delay(20); }
}
let window, server;
const watchdog = setTimeout(() => { result.errors.push("Native browser policy test timed out"); report(); app.exit(1); }, 25_000);

app.whenReady().then(async () => {
  service.sync(yolo); await service.settled;
  assert.equal(service.isEnabled, true, service.lastProblem);
  server = http.createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>YOLO native policy test</title><p>Local fixture</p>"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(`${origin}/c/yolo-policy-fixture`);
  const host = service.attach(window.webContents, "yolo-policy-fixture");
  const tab = service.createTab(host);
  let prompts = 0;
  const changed = service.changed.bind(service);
  service.changed = current => { if (current.permission || [...current.tabs.values()].some(item => item.dialog)) prompts++; changed(current); };

  await service.authorize(host, origin);
  assert.equal(host.permission, null);
  assert.equal(service.allowedOrigins.size, 0);
  result.origin = true;
  await tab.navigate(origin);
  const permission = await tab.evaluate("navigator.permissions.query({name:'geolocation'}).then(permission => permission.state)");
  assert.equal(permission, "granted");
  assert.equal(service.permissionGrants.size, 0);
  result.devicePermission = true;
  try { assert.equal(await tab.evaluate('confirm("YOLO fixture confirmation")'), true); }
  catch (error) {
    result.dialogDebug = { yolo: service.yoloEnabled, dialog: tab.dialog, events: tab.events.filter(event => event.method.includes("Dialog")) };
    throw error;
  }
  assert.equal(await tab.evaluate('alert("YOLO fixture alert"); true'), true);
  assert.equal(tab.dialog, null);
  assert.equal(prompts, 0);
  result.dialogs = true;

  service.sync(normal); await service.settled;
  assert.equal(service.isEnabled, true);
  assert.equal(service.yoloEnabled, false);
  assert.equal(service.hosts.get(host.id), host);
  const blockedOrigin = service.authorize(host, origin).then(() => false, () => true);
  assert.ok(host.permission);
  host.permission.deny();
  assert.equal(await blockedOrigin, true);
  const confirmation = tab.evaluate('confirm("Normal fixture confirmation")');
  await until(() => tab.dialog);
  assert.equal(tab.dialog.type, "confirm");
  await tab.cdp("Page.handleJavaScriptDialog", { accept: false });
  assert.equal(await confirmation, false);
  const next = service.createTab(host); await next.navigate(origin);
  assert.notEqual(await next.evaluate("navigator.permissions.query({name:'geolocation'}).then(permission => permission.state)"), "granted");
  result.restored = true;

  assert.equal(service.requireApproval, true);
  assert.equal(service.allowedOrigins.size, 0);
  assert.equal(service.permissionGrants.size, 0);
  assert.equal(service.persistentOrigins.size, 0);
  result.preferencesUnchanged = true;
  service.sync(yolo);
  assert.equal(service.yoloEnabled, true);
  service.sync({ ...yolo, plugins: { developerMode: true, enabled: ["yolo"] } });
  assert.equal(service.isEnabled, false);
  await assert.rejects(service.authorize(host, origin), /disabled/);
  result.disabled = true;
}).catch(error => { result.errors.push(error.stack || String(error)); }).finally(() => {
  clearTimeout(watchdog);
  service.dispose();
  if (window && !window.isDestroyed()) window.destroy();
  server?.close();
  report();
  setTimeout(() => app.exit(result.errors.length ? 1 : 0), 50);
});

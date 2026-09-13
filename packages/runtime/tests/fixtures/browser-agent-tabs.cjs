const assert = require("node:assert/strict");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 6500) {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= end) throw new Error(message); await delay(25); }
}

async function verifyAgentTabIsolation(window, service, host, agentTab, result) {
  const evaluate = source => window.webContents.executeJavaScript(source);
  const request = (action, args = {}) => service.request(window.webContents, action, { context: host.context, ...args });
  const execute = (command, args = {}) => service.execute(command, { browser_id: host.id, tab_id: agentTab.id, ...args });
  const hidden = () => evaluate(`document.querySelector('.bg-browser-cursor-layer').hidden && document.querySelector('[data-testid="browser-agent-border"]').hidden && document.querySelector('[data-testid="browser-agent-dock"]').hidden`);
  const shown = () => evaluate(`!document.querySelector('.bg-browser-cursor-layer').hidden && document.querySelector('[data-testid="browser-agent-border"]').dataset.visible==='true'`);
  const url = agentTab.state().url;
  await evaluate(`window.qaSetTaskStatus(2)`);
  await until(() => host.agentResponseId, "The native browser did not bind the response");
  await execute("cua_move", { x: 90, y: 110 });
  await until(shown, "The AI tab did not display the cursor and glow");

  await request("new-tab");
  const userTab = service.findTab(host);
  await request("navigate", { tabId: userTab.id, url });
  await until(() => host.attachedTab === userTab && hidden(), "The AI indicators followed the user to a different tab");
  await userTab.evaluate(`document.body.innerHTML='<input id="user-input" style="position:fixed;left:30px;top:30px;width:230px;height:35px">';window.qaUserClicks=0;document.addEventListener('click',()=>window.qaUserClicks++)`);
  await agentTab.evaluate(`(() => {const button=document.createElement('button');button.id='qa-background-button';button.textContent='AI target';button.style.cssText='position:fixed;left:30px;top:30px';const ready=document.createElement('div');ready.id='qa-background-ready';ready.hidden=true;ready.textContent='Ready';button.onclick=()=>{window.qaBackgroundClicked=true;ready.hidden=false};document.body.append(button,ready)})()`);
  // Force the same compositor used by tooltips/pets so forwarded user input is
  // covered too, while the AI's page remains detached in the background.
  await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect(),node=document.createElement('div');node.id='qa-user-tooltip';node.setAttribute('role','tooltip');node.style.cssText='position:fixed;z-index:99999;width:10px;height:10px;background:red;left:'+(r.left+10)+'px;top:'+(r.top+10)+'px';document.body.append(node)})()`);
  await until(() => host.bounds.composited, "The tooltip did not overlap the user's page");
  await until(() => host.frameReadyFor === userTab.id, "The user's tab did not present a composited frame");
  const waiting = execute("playwright_locator_wait_for", { selector: "#qa-background-ready", state: "visible", timeout_ms: 10_000 });
  await until(() => host.operations.size > 0, "The background wait did not start");
  assert.equal(host.activeTabId, userTab.id);
  const input = (type, args = {}) => request("input", { tabId: userTab.id, type, ...args });
  await input("mouseDown", { x: 80, y: 48, button: "left", buttons: 1 });
  await input("mouseUp", { x: 80, y: 48, button: "left", buttons: 0 });
  await input("text", { text: "The user is typing" });
  await input("keyDown", { key: "Escape", code: "Escape", keyCode: 27 });
  await input("keyUp", { key: "Escape", code: "Escape", keyCode: 27 });
  assert.equal(host.paused, false, "Escape in the user's separate tab paused AI work");
  await execute("playwright_locator_click", { selector: "#qa-background-button" });
  await waiting;
  assert.equal(await agentTab.evaluate("window.qaBackgroundClicked"), true);
  assert.equal(await userTab.evaluate("document.querySelector('#user-input').value"), "The user is typing");
  assert.equal(await userTab.evaluate("window.qaUserClicks"), 1, "An AI click leaked into the user's tab");
  assert.equal(host.activeTabId, userTab.id); assert.equal(host.attachedTab, userTab);
  assert(await hidden());
  // A queued packet from the previously selected AI tab is ignored, never
  // redirected to either live page after the tab switch.
  await request("input", { tabId: agentTab.id, type: "text", text: "stale packet" });
  assert.equal(await userTab.evaluate("document.querySelector('#user-input').value"), "The user is typing");
  await execute("navigate_tab_url", { url: url.split("#")[0] + "#background-agent" });
  assert.equal(host.activeTabId, userTab.id, "Navigation pulled the user back to the AI tab");
  const created = await service.execute("create_tab", { browser_id: host.id });
  const secondAgentTab = service.findTab(host, created.id);
  await execute("navigate_tab_url", { tab_id: secondAgentTab.id, url });
  await execute("cua_move", { tab_id: secondAgentTab.id, x: 160, y: 180 });
  assert.equal(host.activeTabId, userTab.id, "An AI-created tab stole the user's selection");
  assert(await hidden());
  const beforePopup = new Set(host.tabs.keys());
  await secondAgentTab.evaluate(`window.open(${JSON.stringify(url)}, '_blank'); true`);
  await until(() => [...host.tabs.keys()].some(id => !beforePopup.has(id)), "The background popup did not open");
  const popup = [...host.tabs.values()].find(tab => !beforePopup.has(tab.id));
  assert.equal(host.activeTabId, userTab.id, "A popup from the AI's background tab stole focus");
  assert(await hidden());
  service.closeTab(host, popup);
  result.agentBackgroundTabs = true; result.independentUserInput = true;

  await evaluate(`document.querySelector('#qa-user-tooltip').remove()`);
  for (const tab of [agentTab, secondAgentTab]) {
    await request("select", { tabId: tab.id });
    await until(shown, "Returning to an AI-used tab did not restore its session indicators");
    assert.equal(await evaluate(`agentPoints.get(${JSON.stringify(tab.id)})?.tabId`), tab.id);
  }
  await request("select", { tabId: userTab.id });
  await until(hidden, "An unused tab retained the glow");
  await request("select", { tabId: agentTab.id }); await until(shown, "AI tab lost the response");
  await evaluate(`window.qaSetComposerStatus(1)`);
  await until(() => !host.agentResponseId && hidden(), "Composer completion did not end the browser session");
  assert.equal(await evaluate("window.qaResponseState.status"), 2, "The raw provider must remain stale for this regression");
  assert.equal(host.agentSessionTabIds.size, 0);
  result.composerCompletion = true; result.agentTabIndicators = true;

  await evaluate(`window.qaSetTaskStatus(2)`);
  await until(() => host.agentResponseId, "The next response did not bind");
  await execute("cua_move", { tab_id: secondAgentTab.id, x: 40, y: 60 });
  assert.equal(host.activeTabId, secondAgentTab.id, "The new response inherited the old selection lock");
  await request("select", { tabId: agentTab.id }); await until(hidden, "The new response inherited previously used tabs");
  const cancelled = execute("playwright_locator_wait_for", { tab_id: secondAgentTab.id, selector: "#never-created", state: "visible", timeout_ms: 10_000 }).then(() => false, () => true);
  await until(() => host.operations.size > 0, "The cancellable action did not start");
  await evaluate(`window.qaSetComposerStatus(3)`);
  assert.equal(await cancelled, true, "Ending generation left its browser action running");
  await until(() => !host.operations.size && hidden(), "Cancellation left browser effects or work running");
  result.agentResponseIsolation = true;

  await evaluate(`window.qaSetTaskStatus(1)`);
  service.closeTab(host, secondAgentTab); service.closeTab(host, userTab);
  await request("select", { tabId: agentTab.id });
  await until(() => host.attachedTab === agentTab && !host.bounds.composited, "Tab isolation cleanup did not restore the native page");
  await agentTab.evaluate(`document.querySelector('#qa-background-button')?.remove();document.querySelector('#qa-background-ready')?.remove()`);
  if (agentTab.state().url !== url) await agentTab.navigate(url);
}

module.exports = { verifyAgentTabIsolation };

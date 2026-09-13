const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) {
  const end = Date.now() + 6500;
  while (!await predicate()) { if (Date.now() > end) throw new Error(message); await delay(20); }
}

async function verifyBrowserControl(window, service, host, tab, directory, result) {
  const evaluate = source => window.webContents.executeJavaScript(source);
  const request = (action, args = {}) => service.request(window.webContents, action, { context: host.context, ...args });
  const execute = (command, args = {}) => service.execute(command, { browser_id: host.id, tab_id: tab.id, ...args });
  const input = (type, args = {}) => request("input", { tabId: tab.id, type, ...args });
  const values = () => tab.evaluate(`({clicks:window.qaClicks,wheels:window.qaWheels,value:document.querySelector('#qa-control-input').value,scroll:scrollY})`);
  const effects = () => evaluate(`(() => {
    const page=document.querySelector('.bg-browser-viewport'),border=document.querySelector('.bg-browser-agent-border'),cursor=document.querySelector('.bg-browser-cursor-layer'),dock=document.querySelector('.bg-browser-agent-dock');
    return {locked:page.hasAttribute('data-agent-control'),borderHidden:border.hidden,cursorHidden:cursor.hidden,dockHidden:dock.hidden,border:Number(getComputedStyle(border).opacity),cursor:Number(getComputedStyle(cursor).opacity)};
  })()`);
  const fadeFrame = async () => {
    // Drive Chromium's real transitions to an intermediate frame. A hidden
    // test window can defer the compositor clock even while JS timers run.
    const transitions = await evaluate(`(() => {
      return ['.bg-browser-agent-border','.bg-browser-cursor-layer'].map(selector=>{
        const node=document.querySelector(selector);
        if(!node) return false;
        getComputedStyle(node).opacity;
        const animation=node.getAnimations().find(value=>value.transitionProperty==='opacity');
        if(!animation)return false;
        animation.pause();animation.currentTime=150;return true;
      });
    })()`);
    if (transitions.every(Boolean)) {
      const frame = await effects();
      await evaluate(`document.querySelectorAll('.bg-browser-agent-border,.bg-browser-cursor-layer').forEach(node=>node.getAnimations().forEach(animation=>animation.play()));true`);
      return frame;
    }
    return effects();
  };
  const hostInput = (method, args) => window.webContents.debugger.sendCommand(method, args);
  const clickControl = async () => {
    const point = await evaluate(`(() => {const r=document.querySelector('[data-testid="browser-agent-control"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await hostInput("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await hostInput("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  await tab.evaluate(`document.body.innerHTML='<input id="qa-control-input" aria-label="Control test" style="position:fixed;left:30px;top:20px;width:220px;height:35px"><button id="qa-control-button" style="position:fixed;left:30px;top:80px;width:180px;height:40px">Page button</button><div style="height:3000px"></div>';window.qaClicks=0;window.qaWheels=0;document.querySelector('#qa-control-button').onclick=()=>window.qaClicks++;document.addEventListener('wheel',()=>window.qaWheels++)`);
  // Initialize the child compositor in this deliberately hidden test window.
  await tab.screenshot();
  await evaluate("window.qaSetTaskStatus(2)");
  await until(() => host.agentResponseId, "The response did not bind");
  await execute("playwright_dom_snapshot");
  await until(() => host.bounds.composited && host.frameReadyFor === tab.id, "The controlled page did not reach the host compositor");
  await until(async () => (await effects()).border > .99, "The border did not finish entering");
  await execute("cua_click", { x: 70, y: 100 });
  await execute("cua_click", { x: 70, y: 35 });
  await execute("cua_type", { text: "agent" });
  await execute("cua_keypress", { keys: ["A"] });
  assert.equal((await values()).clicks, 1);
  assert.equal((await values()).value.toLowerCase(), "agenta");
  result.agentInputWorks = true;
  const before = await values();
  for (const [type, args] of [
    ["mouseDown", { x: 70, y: 100, button: "left", buttons: 1 }], ["mouseUp", { x: 70, y: 100, button: "left", buttons: 0 }],
    ["mouseWheel", { x: 70, y: 160, deltaX: 0, deltaY: -150 }], ["text", { text: "blocked" }],
    ["keyDown", { key: "x", code: "KeyX", keyCode: 88, text: "x" }], ["keyUp", { key: "x", code: "KeyX", keyCode: 88 }],
    ["paste", {}], ["cut", {}], ["selectAll", {}]
  ]) await input(type, args);
  const point = await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();return {x:r.x+70,y:r.y+100}})()`);
  await hostInput("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await hostInput("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  await hostInput("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: 150 });
  await hostInput("Input.dispatchKeyEvent", { type: "keyDown", key: "x", code: "KeyX", windowsVirtualKeyCode: 88, text: "x" });
  await hostInput("Input.dispatchKeyEvent", { type: "keyUp", key: "x", code: "KeyX", windowsVirtualKeyCode: 88 });
  const url = tab.state().url;
  await request("navigate", { url: url + "#blocked" });
  await delay(100);
  assert.deepEqual(await values(), before, "User input reached the AI's page");
  assert.equal(tab.state().url, url, "User navigation replaced the AI's page");
  assert.equal(host.paused, false, "Blocked input implicitly took over the task");
  result.blockedUserInput = true;
  tab.contents.focus();
  for (const type of ["keyDown", "char", "keyUp"]) tab.contents.sendInputEvent({ type, keyCode: "z" });
  await delay(100);
  assert.deepEqual(await values(), before, "Retained native focus bypassed the page lock");
  result.nativeKeyboardBlocked = true;
  fs.writeFileSync(path.join(directory, "control-active.png"), (await window.webContents.capturePage()).toPNG());

  await request("new-tab");
  const userTab = service.findTab(host);
  await request("navigate", { url });
  await until(() => host.attachedTab === userTab, "The independent user tab did not attach");
  await userTab.evaluate(`document.querySelector('#name').focus()`);
  await userTab.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (const type of ["keyDown", "char", "keyUp"]) userTab.contents.sendInputEvent({ type, keyCode: "u" });
  await until(() => userTab.evaluate(`document.querySelector('#name').value==='u'`), "An unrelated tab inherited the AI input lock");
  assert.equal(host.paused, false);
  result.inputOnOtherTab = true;
  await request("select", { tabId: tab.id });
  try { await until(async () => host.frameReadyFor === tab.id && (await effects()).border > .99, "The AI tab did not restore its controls"); }
  catch (error) {
    result.returnState = { effects: await effects(), bounds: host.bounds, ready: host.frameReadyFor, active: host.activeTabId, expected: tab.id,
      ui: await evaluate(`({agentSession,taskRunning,tabs:[...agentTabs],key:agentPresentationKey,open,context,taskContext,frameGeneration,compositing})`),
      page: await tab.evaluate("({width:innerWidth,height:innerHeight})"), view: tab.view.getBounds(), paint: tab.paintMode, error: tab.error };
    throw error;
  }
  service.closeTab(host, userTab);

  await clickControl();
  await until(async () => host.paused && !(await effects()).locked, "Take over did not release input");
  result.pauseEffects = await fadeFrame();
  assert(result.pauseEffects.border > 0 && result.pauseEffects.border < 1 && !result.pauseEffects.borderHidden, "Take over skipped the border fade");
  assert(result.pauseEffects.cursor > 0 && result.pauseEffects.cursor < 1 && !result.pauseEffects.cursorHidden, "Take over skipped the cursor fade");
  await input("mouseDown", { x: 70, y: 35, button: "left", buttons: 1 });
  await input("mouseUp", { x: 70, y: 35, button: "left", buttons: 0 });
  await input("text", { text: " user" });
  assert((await values()).value.includes("user"), "The fading effects still blocked input after Take over");
  fs.writeFileSync(path.join(directory, "control-pause.png"), (await window.webContents.capturePage()).toPNG());
  result.releasedOnPause = true;
  await until(async () => (await effects()).borderHidden, "The paused border did not finish exiting");
  await clickControl();
  await until(async () => !host.paused && (await effects()).locked, "Resume did not restore AI ownership");
  await until(() => evaluate(`document.querySelector('.bg-browser-cursor-layer').dataset.visible==='true'`), "Resume did not start its appearance animation");
  result.entryEffects = await fadeFrame();
  assert(result.entryEffects.border > 0 && result.entryEffects.border <= 1, "Resume skipped the border entrance");
  assert(result.entryEffects.cursor > 0 && result.entryEffects.cursor <= 1, "Resume skipped the cursor entrance");
  await until(async () => (await effects()).border > .99, "The resumed border did not finish entering");
  const resumed = await values();
  await input("text", { text: "blocked after resume" });
  assert.deepEqual(await values(), resumed, "Resume failed to restore the input lock");
  await evaluate("window.qaSetTaskStatus(1)");
  await until(async () => !host.agentResponseId && !(await effects()).locked, "Response completion did not release control");
  result.endEffects = await fadeFrame();
  assert(result.endEffects.border >= 0 && result.endEffects.border <= 1 && !result.endEffects.borderHidden, "Response completion skipped the border fade");
  assert(result.endEffects.cursor >= 0 && result.endEffects.cursor <= 1 && !result.endEffects.cursorHidden, "Response completion skipped the cursor fade");
  await input("text", { text: " done" });
  assert((await values()).value.includes("done"), "The completed response left user input blocked");
  fs.writeFileSync(path.join(directory, "control-ending.png"), (await window.webContents.capturePage()).toPNG());
  await until(async () => { const state = await effects(); return state.borderHidden && state.cursorHidden && state.dockHidden && !host.bounds.composited; }, "The completed response retained its overlay");
  result.smoothEntryExit = true; result.completedUnlock = true;
}

module.exports = { verifyBrowserControl };

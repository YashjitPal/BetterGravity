const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { nativeImage } = require("electron");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 6500) {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= end) throw new Error(message); await delay(25); }
}

async function verifyAgentBrowser(window, service, host, tab, directory, result) {
  const evaluate = source => window.webContents.executeJavaScript(source);
  const execute = (command, args = {}) => service.execute(command, { browser_id: host.id, tab_id: tab.id, ...args });
  const opened = () => evaluate(`!!document.querySelector('#bg-in-built-browser:not([hidden])') && document.querySelector('[data-aux-pane-open]').dataset.auxPaneOpen === 'true'`);
  await evaluate(`window.qaSetTaskStatus(2)`);
  await evaluate(`window.qaSetPaneOpen(false)`);
  await until(() => !host.bounds?.visible, "Collapsing the pane did not hide its native view");
  const screenshot = await execute("tab_screenshot");
  assert(screenshot.data.length > 1000);
  assert(await opened(), "A screenshot tool did not reopen the collapsed side pane");
  assert(host.revealReady >= host.revealSequence, "The tool ran before the opening animation finished");
  result.collapsedAutoOpen = true;
  // The inner browser can remain open while the user collapses the outer
  // auxiliary pane. Metadata tools must reveal it too, before page actions.
  for (const [command, args] of [["list_browsers", {}], ["get_browser_documentation", { browser_id: host.id }]]) {
    await evaluate(`window.qaSetPaneOpen(false)`);
    await until(() => !host.bounds?.visible, "The auxiliary pane did not finish collapsing");
    await service.execute(command, args);
    assert(await opened(), command + " stayed in the background with the outer pane closed");
    assert(host.revealReady >= host.revealSequence);
    assert(await evaluate(`!document.querySelector('.bg-browser-cursor-layer').hidden`), command + " did not start the response's browser session");
  }
  result.metadataAutoOpen = true;
  await evaluate(`window.qaSetPaneOpen(false)`);
  await until(() => !host.bounds?.visible, "Legacy activity check did not collapse the pane");
  await evaluate(`render({...state,visible:true,activity:'Click page',revealSequence:undefined})`);
  await until(() => opened(), "An older runtime's activity did not reveal the outer sidebar");
  await service.request(window.webContents, "state", { context: host.context });
  result.legacyActivityAutoOpen = true;

  await evaluate(`document.querySelector('[data-tab-id="overview"]').click()`);
  await until(() => !host.visible, "Selecting Overview did not close the browser");
  const snapshot = await execute("playwright_dom_snapshot");
  assert(snapshot.dom_snapshot.includes("A browser beside your work"));
  assert(await opened(), "DOM inspection did not select the browser tab");
  result.nativeTabAutoOpen = true;

  await tab.evaluate(`(() => {
    const button=document.createElement('button');button.id='qa-auto-open';button.textContent='Open tool target';
    button.style.cssText='position:fixed;bottom:20px;right:20px;z-index:600';
    button.onclick=event=>window.qaAutoOpenClicked=event.isTrusted;document.body.append(button);
  })()`);
  await evaluate(`window.qaSetPaneOpen(false, true)`);
  await until(() => evaluate(`!document.querySelector('#bg-in-built-browser')`), "The browser pane was not unmounted");
  await execute("playwright_locator_click", { selector: "#qa-auto-open" });
  assert(await opened(), "A page action did not remount and open the browser");
  assert.equal(await tab.evaluate("window.qaAutoOpenClicked"), true);
  assert(await evaluate(`(() => {const layer=document.querySelector('.bg-browser-cursor-layer'),cursor=document.querySelector('[data-testid="browser-agent-cursor"]'),asset=cursor?.querySelector('img');return !layer.hidden&&Number(getComputedStyle(cursor).opacity)>.95&&asset.complete&&asset.naturalWidth===46})()`), "The first locator click showed a border without its cursor");
  assert.equal(host.frameReadyFor, tab.id, "The clicking cursor was covered by the native page");
  assert.equal(host.tabs.size, 1, "Reopening created a duplicate browser tab");
  result.unmountedAutoOpen = true;
  result.cursorOnClick = true;

  await tab.evaluate(`document.querySelector('#qa-auto-open').remove();scrollTo(0,0)`);
  const size = await tab.evaluate("({width:innerWidth,height:innerHeight})");
  const target = { x: Math.min(size.width - 80, 600), y: Math.min(size.height - 80, 450) };
  await tab.evaluate(`(() => {
    const patch=document.createElement('div');patch.id='qa-cursor-patch';
    patch.style.cssText='position:fixed;width:100px;height:100px;background:#27415c;z-index:600;left:${target.x - 40}px;top:${target.y - 40}px';document.body.append(patch);
    window.qaAgentClicks=0;const click=()=>window.qaAgentClicks++;const move=e=>window.qaAgentMouse={x:e.clientX,y:e.clientY};
    document.addEventListener('click',click,true);document.addEventListener('mousemove',move,true);
    window.qaAgentCleanup=()=>{patch.remove();document.removeEventListener('click',click,true);document.removeEventListener('mousemove',move,true)};
  })()`);
  const crop = { cropX: target.x - 10, cropY: target.y - 10, cropWidth: 32, cropHeight: 32 };
  const before = nativeImage.createFromBuffer(Buffer.from(await tab.screenshot(crop), "base64")).toBitmap();
  const edgeCrop = { cropX: 0, cropY: 100, cropWidth: 12, cropHeight: 40 };
  const edgeBefore = nativeImage.createFromBuffer(Buffer.from(await tab.screenshot(edgeCrop), "base64")).toBitmap();
  await execute("cua_move", { x: 30, y: 50 });
  await evaluate(`(() => {window.qaCursorTrace=[];window.qaCursorTraceDone=false;const sample=()=>{const cursor=document.querySelector('[data-testid="browser-agent-cursor"]');if(cursor)window.qaCursorTrace.push(cursor.style.transform);if(!window.qaCursorTraceDone)requestAnimationFrame(sample)};sample()})()`);
  await execute("cua_move", target);
  await evaluate(`window.qaCursorTraceDone=true`);
  const trace = await evaluate("window.qaCursorTrace");
  assert(new Set(trace).size > 1, "The agent cursor teleported instead of animating");
  const pointer = await tab.evaluate("window.qaAgentMouse");
  assert(Math.abs(pointer.x - target.x) < 2 && Math.abs(pointer.y - target.y) < 2, "Page input missed the animated cursor's destination");
  await until(() => host.bounds?.composited && host.frameReadyFor === tab.id, "The agent cursor did not appear above the native page");
  const cursor = await evaluate(`(() => {const node=document.querySelector('[data-testid="browser-agent-cursor"]'),asset=node.querySelector('img');return {opacity:Number(getComputedStyle(node).opacity),pointerEvents:getComputedStyle(node.parentElement).pointerEvents,assetWidth:asset.naturalWidth,assetHeight:asset.naturalHeight,filter:asset.style.filter}})()`);
  assert(cursor.opacity > .95 && cursor.pointerEvents === "none");
  assert.equal(cursor.assetWidth, 46); assert.equal(cursor.assetHeight, 48); assert(cursor.filter.includes("drop-shadow"));
  const holding = execute("playwright_wait_for_timeout", { timeout_ms: 1400 });
  await until(() => evaluate(`!document.querySelector('[data-testid="browser-agent-border"]').hidden && !document.querySelector('[data-testid="browser-agent-control"]').hidden`), "The model activity border or Take over button did not appear");
  const borderBefore = await evaluate(`(() => {
    const border=document.querySelector('[data-testid="browser-agent-border"]'),glow=border.querySelector('.bg-browser-agent-glow');
    window.qaAgentControl=document.querySelector('[data-testid="browser-agent-control"]');
    const box=border.getBoundingClientRect(),page=document.querySelector('.bg-browser-viewport').getBoundingClientRect();
    return {opacity:getComputedStyle(glow).opacity,shadow:getComputedStyle(glow).boxShadow,duration:getComputedStyle(glow).animationDuration,pointerEvents:getComputedStyle(border).pointerEvents,width:box.width,height:box.height,pageWidth:page.width,pageHeight:page.height,label:window.qaAgentControl.textContent};
  })()`);
  assert.equal(borderBefore.pointerEvents, "none");
  assert.equal(borderBefore.width, borderBefore.pageWidth); assert.equal(borderBefore.height, borderBefore.pageHeight);
  assert.equal(borderBefore.label, "Take over task");
  assert(await evaluate(`(() => {const button=document.querySelector('[data-testid="browser-agent-control"]'),icon=button.querySelector('.bg-browser-control-stop'),style=getComputedStyle(button),box=button.getBoundingClientRect();return box.width===26&&box.height===26&&style.color==='rgb(59, 130, 246)'&&style.borderRadius==='8px'&&icon&&getComputedStyle(icon).width==='10px'&&getComputedStyle(icon).backgroundColor==='rgb(59, 130, 246)'&&button.title==='Take over task'})()`), "The handoff button does not match Willow's compact blue stop control");
  assert.equal(borderBefore.duration, "3s");
  assert(borderBefore.shadow.includes("59, 130, 246") && borderBefore.shadow.includes("120px 30px"), "The glow does not use Willow's original blue inset shadows");
  await delay(120);
  const borderAfter = await evaluate(`getComputedStyle(document.querySelector('.bg-browser-agent-glow')).opacity`);
  assert.notEqual(borderAfter, borderBefore.opacity, "The blue glow did not breathe");
  assert(await evaluate(`(() => {const dock=document.querySelector('.bg-browser-agent-dock'),panel=dock.querySelector('.bg-browser-agent-panel'),page=document.querySelector('.bg-browser-viewport');return dock.parentElement===page&&getComputedStyle(dock).bottom==='32px'&&getComputedStyle(panel).backdropFilter==='blur(12px)'})()`), "The handoff did not use Willow's floating control layout");
  fs.writeFileSync(path.join(directory, "browser-agent-cursor.png"), (await window.webContents.capturePage()).toPNG());
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bg-browser-agent-glow')).animationName`), "none");
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
  await holding;
  result.activityBorder = true;
  result.agentCursor = true;

  // Model reasoning and response boundaries have no browser activity events.
  // Keep watching the real renderer beyond the former 1.5s hold + 0.5s exit.
  await evaluate(`(() => {
    window.qaAgentGapFailures=[];window.qaAgentGapDone=false;
    const cursor=document.querySelector('[data-testid="browser-agent-cursor"]');
    const sample=()=>{
      const layer=document.querySelector('.bg-browser-cursor-layer'),border=document.querySelector('[data-testid="browser-agent-border"]'),control=document.querySelector('[data-testid="browser-agent-control"]');
      if(layer.hidden||border.hidden||control.hidden||control.dataset.mode!=='takeover'||Number(getComputedStyle(cursor).opacity)<.95||!cursor.isConnected)window.qaAgentGapFailures.push('Indicators disappeared between calls');
      if(!window.qaAgentGapDone)requestAnimationFrame(sample);
    };sample();
  })()`);
  try {
    for (let gap = 0; gap < 2; gap++) {
      assert.equal(host.activity, null, "The gap must have no running browser tool");
      await delay(2300);
      assert.deepEqual(await evaluate("window.qaAgentGapFailures"), [], "Cursor, glow or Take over disappeared during a tool gap");
      assert(host.bounds.composited && host.frameReadyFor === tab.id, "The native page covered the idle agent cursor");
      if (!gap) await execute("playwright_dom_snapshot");
    }
    fs.writeFileSync(path.join(directory, "browser-agent-idle.png"), (await window.webContents.capturePage()).toPNG());
  } finally { await evaluate("window.qaAgentGapDone=true"); }
  result.agentIndicatorsPersist = true;

  const after = nativeImage.createFromBuffer(Buffer.from((await execute("tab_screenshot", crop)).data, "base64")).toBitmap();
  assert.deepEqual(after, before, "The cursor overlay leaked into a model screenshot");
  const edgeAfter = nativeImage.createFromBuffer(Buffer.from((await execute("tab_screenshot", edgeCrop)).data, "base64")).toBitmap();
  assert.deepEqual(edgeAfter, edgeBefore, "The activity border leaked into a model screenshot");
  assert(!(await execute("playwright_dom_snapshot")).dom_snapshot.includes("browser-agent-cursor"));
  result.cursorScreenshotClean = true;

  const clicks = await tab.evaluate("window.qaAgentClicks");
  const clicking = execute("cua_click", { x: 30, y: 50 }).then(() => false, () => true);
  await until(() => host.cursorWaiters.size > 0, "Click did not wait for cursor arrival");
  assert(await evaluate(`window.qaAgentControl === document.querySelector('[data-testid="browser-agent-control"]')`), "Browser state updates replaced the Take over button");
  const handoffPoint = await evaluate(`(() => {const r=document.querySelector('[data-testid="browser-agent-control"][data-mode="takeover"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const handoffZoom = window.webContents.getZoomFactor();
  const handoffInput = { x: Math.round(handoffPoint.x * handoffZoom), y: Math.round(handoffPoint.y * handoffZoom) };
  window.webContents.sendInputEvent({ type: "mouseMove", ...handoffInput });
  window.webContents.sendInputEvent({ type: "mouseDown", ...handoffInput, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", ...handoffInput, button: "left", clickCount: 1 });
  await until(() => host.paused, "Take over did not pause model control");
  assert.equal(await clicking, true, "Pausing did not cancel a moving cursor's click");
  assert.equal(await tab.evaluate("window.qaAgentClicks"), clicks, "A cancelled cursor movement still clicked the page");
  await until(() => !host.cursorWaiters.size && evaluate(`document.querySelector('.bg-browser-cursor-layer').hidden`), "Cursor did not clear after pause");
  await until(() => evaluate(`document.querySelector('[data-testid="browser-agent-border"]').hidden`), "Take over left the activity border running");
  await assert.rejects(execute("cua_click", target), /paused/);
  await evaluate(`document.querySelector('[data-testid="browser-agent-control"][data-mode="resume"]').click()`);
  await until(() => !host.paused, "Resume did not return control to the model");
  await until(() => evaluate(`!document.querySelector('.bg-browser-cursor-layer').hidden && document.querySelector('[data-testid="browser-agent-border"]').hasAttribute('data-visible')`), "Resume did not return the running response's cursor and control");
  result.takeOverControl = true;
  result.cursorCancellation = true;

  await tab.evaluate(`(() => {
    window.qaDragDown=false;window.qaDragUp=null;
    const down=()=>window.qaDragDown=true;const up=event=>window.qaDragUp={x:event.clientX,y:event.clientY,buttons:event.buttons,trusted:event.isTrusted};
    document.addEventListener('mousedown',down,true);document.addEventListener('mouseup',up,true);
    window.qaDragCleanup=()=>{document.removeEventListener('mousedown',down,true);document.removeEventListener('mouseup',up,true)};
  })()`);
  const dragPath = Array.from({ length: 25 }, (_, index) => ({ x: target.x + (30 - target.x) * index / 24, y: target.y + (50 - target.y) * index / 24 }));
  const dragging = execute("cua_drag", { path: dragPath }).then(() => false, () => true);
  await until(() => tab.evaluate("window.qaDragDown && !window.qaDragUp"), "The drag never pressed the mouse button");
  await service.request(window.webContents, "pause", { context: host.context });
  assert.equal(await dragging, true, "Pausing did not cancel the active drag");
  await until(() => tab.evaluate("window.qaDragUp !== null"), "The cancelled drag left the mouse button held down");
  const released = await tab.evaluate("window.qaDragUp");
  assert.equal(released.buttons, 0); assert.equal(released.trusted, true);
  assert(released.x !== 30 || released.y !== 50, "The cancelled drag jumped to its intended destination");
  await tab.evaluate("window.qaDragCleanup()");
  await service.request(window.webContents, "resume", { context: host.context });
  result.dragCancellation = true;
  await tab.evaluate("window.qaAgentCleanup();scrollTo(0,0)");
  await until(() => host.bounds.composited, "Resume did not retain the running response's presentation");

  const indicatorsHidden = () => evaluate(`document.querySelector('.bg-browser-cursor-layer').hidden && document.querySelector('[data-testid="browser-agent-border"]').hidden && document.querySelector('[data-testid="browser-agent-dock"]').hidden`);
  await execute("cua_move", target);
  await evaluate(`window.qaSetPaneOpen(false)`);
  await until(() => !host.bounds.visible && !host.bounds.composited && indicatorsHidden(), "Collapsing the auxiliary pane left agent indicators active");
  await evaluate(`window.qaSetPaneOpen(true)`);
  await until(() => host.bounds.visible, "The auxiliary pane did not reopen");
  await evaluate(`request('state')`);
  assert(!await indicatorsHidden(), "Reopening the pane lost the running response's controls");
  await execute("cua_move", { x: 30, y: 50 });
  assert(!await indicatorsHidden(), "The next browser action did not restart the cursor");
  await evaluate(`document.querySelector('[data-tab-id="overview"]').click()`);
  await until(() => !host.visible && indicatorsHidden(), "Switching to Overview left the agent cursor active");
  await evaluate(`document.querySelector('[data-bg-browser-page-tab]').click()`);
  await until(() => host.visible && host.bounds.visible && host.bounds.composited, "Reopening the browser did not restore the response's presentation");
  assert(!await indicatorsHidden(), "Selecting the browser tab lost the running response's controls");
  result.agentIndicatorsClearOnClose = true;

  for (const status of [1, 3]) {
    await evaluate(`window.qaSetTaskStatus(2)`);
    await execute("cua_move", target);
    assert(!await indicatorsHidden(), "A new browser action did not start its indicators");
    // Only the live response provider changes: no browser event, Redux update,
    // or DOM mutation can help hide these indicators after the response ends.
    await evaluate(`window.qaSetTaskStatus(${status})`);
    await until(() => indicatorsHidden(), "Finishing or cancelling the task left the cursor or glow running");
    await until(() => !host.bounds.composited, "Task completion did not release browser compositing");
    await evaluate(`window.qaSetTaskStatus(2)`);
    await delay(150);
    assert(await indicatorsHidden(), "An unrelated new task restored stale browser indicators");
  }
  await evaluate(`window.qaSetTaskStatus(1)`);
  result.agentIndicatorsEndWithTask = true;
}

module.exports = { verifyAgentBrowser };

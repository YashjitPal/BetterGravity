const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= end) throw new Error(message); await delay(25); }
}

async function verifyPausedResize(window, service, host, tab, directory, result) {
  const evaluate = source => window.webContents.executeJavaScript(source);
  const screenshot = name => window.webContents.capturePage().then(image => fs.writeFileSync(path.join(directory, name), image.toPNG()));
  const sample = () => evaluate(`(() => {
    const image=document.querySelector('.bg-browser-surface'),view=document.querySelector('.bg-browser-viewport'),r=image.getBoundingClientRect(),v=view.getBoundingClientRect();
    return {hidden:image.hidden,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:r.width,height:r.height,viewportWidth:v.width,viewportHeight:v.height,distortion:image.naturalWidth?Math.abs(r.width/r.height/(image.naturalWidth/image.naturalHeight)-1):null};
  })()`);
  const aligned = async () => {
    const s = await sample(), bounds = host.bounds, scale = window.webContents.getZoomFactor();
    return !s.hidden && s.distortion < .006 && Math.abs(s.width - bounds.width) < 2 && Math.abs(s.height - bounds.height) < 2 &&
      Math.abs(tab.view.getBounds().width - bounds.width * scale) < 2;
  };
  let latestFrame;
  const record = (_event, method, params) => { if (method === "Page.screencastFrame" && params.data?.startsWith("/9j/")) latestFrame = params; };
  tab.contents.debugger.on("message", record);
  try {
    await tab.evaluate(`(() => {
      document.title='Paused browser resize';
      document.body.innerHTML='<main style="padding:32px;font:16px system-ui"><h1>Browser under your control</h1><p>The circles stay round when the pane changes size.</p><div style="display:flex;gap:24px"><div style="width:100px;height:100px;border-radius:50%;background:#3b82f6"></div><div style="width:100px;height:100px;background:#e89836"></div></div><label style="display:block;margin-top:28px">Type here <input id="resize-input" style="height:32px;width:200px"></label><p id="size"></p></main>';
      const size=()=>document.querySelector('#size').textContent=innerWidth+' × '+innerHeight;addEventListener('resize',size);size();
    })()`);
    await evaluate(`window.qaSetTaskStatus(2)`);
    await service.execute("cua_move", { browser_id: host.id, tab_id: tab.id, x: 70, y: 150 });
    await evaluate(`document.querySelector('[data-testid="browser-agent-control"]').click()`);
    await until(() => host.paused && host.bounds?.composited && host.frameReadyFor === tab.id, "Take over did not keep the page composited");
    await until(() => tab.view.getBounds().x >= window.getContentSize()[0], "The native page covers the control bar");
    await until(aligned, "The initial paused page is distorted");
    await until(() => !!latestFrame, "The paused page produced no frame");
    const oldFrame = latestFrame;
    const oldPreview = await evaluate(`(() => {const image=document.querySelector('.bg-browser-surface');return {data:image.src,bounds:{x:parseFloat(image.style.left)+document.querySelector('.bg-browser-viewport').getBoundingClientRect().x,y:parseFloat(image.style.top)+document.querySelector('.bg-browser-viewport').getBoundingClientRect().y,width:parseFloat(image.style.width),height:parseFloat(image.style.height)}}})()`);
    result.beforeResize = await sample();
    await screenshot("paused-before.png");
    await evaluate(`(() => {
      window.qaResizeFrames=[];window.qaSampleResize=true;
      const sample=()=>{const image=document.querySelector('.bg-browser-surface'),r=image.getBoundingClientRect();if(!image.hidden&&image.naturalWidth)window.qaResizeFrames.push({width:r.width,height:r.height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,distortion:Math.abs(r.width/r.height/(image.naturalWidth/image.naturalHeight)-1)});if(window.qaSampleResize)requestAnimationFrame(sample)};sample();
      document.querySelector('[data-testid="toggle-maximize-pane"]').click();
    })()`);
    await until(() => host.bounds.width > result.beforeResize.width * 1.5, "The pane did not maximize");
    await delay(350);
    await until(aligned, "Maximizing left the paused page stretched");
    result.maximized = await sample();
    assert.equal(host.paused, true, "Maximizing resumed the AI");
    assert(tab.view.getBounds().x >= window.getContentSize()[0], "Maximizing put the native page above overlays");
    await screenshot("paused-maximized.png");
    result.pausedMaximize = true;

    // The renderer/IPC queue may deliver the old viewport after the resize.
    // A static page may not paint again, so the last late frame must be rejected.
    tab.contents.debugger.emit("message", {}, "Page.screencastFrame", oldFrame);
    await delay(150);
    result.afterLateFrame = await sample();
    assert(result.afterLateFrame.distortion < .006, "An old frame was stretched to the new pane size");
    assert(await aligned(), "A late old-size frame replaced the resized page");
    // Also cover frames already in IPC or image decoding when layout changed,
    // including an older sender that labeled old pixels with the new bounds.
    for (const bounds of [oldPreview.bounds, { ...host.bounds }]) {
      window.webContents.send("bettergravity:browser-state", { ...service.state(host), frame: { ...oldPreview, bounds, tabId: tab.id, sequence: 9999, needsAck: false } });
      await delay(100);
      assert(await aligned(), "A delayed preview replaced the correctly resized page");
    }
    result.lateFramesRejected = true;
    await evaluate(`document.querySelector('[data-testid="toggle-maximize-pane"]').click()`);
    await delay(350); await until(aligned, "Restoring left the paused page stretched");
    assert(host.bounds.width < result.maximized.width * .85);
    result.pausedRestore = true;
    await screenshot("paused-restored.png");

    window.webContents.setZoomFactor(1.25);
    await delay(150);
    await evaluate(`document.querySelector('[data-testid="qa-collapse-sidebar"]').click()`);
    await delay(350); await until(aligned, "Collapsing the sidebar at 125% zoom distorted the page");
    await evaluate(`window.qaResize(-100)`);
    await delay(350); await until(aligned, "Dragging the paused pane at 125% zoom distorted the page");
    result.zoomedResize = true;
    tab.contents.setZoomFactor(1.25);
    await delay(200); await until(aligned, "Page zoom distorted the paused preview");
    result.pageZoom = true;
    await evaluate(`window.qaSampleResize=false`);
    result.distortedFrames = await evaluate(`window.qaResizeFrames.filter(frame=>frame.distortion>.01)`);
    assert.deepEqual(result.distortedFrames, [], "The page was stretched during the resize animation");
    const beforeViewport = tab.frameSequence;
    await service.request(window.webContents, "viewport", { context: host.context, width: 500, height: 400 });
    await until(async () => { const s = await sample(); return tab.frameSequence > beforeViewport && Math.abs(s.naturalWidth / s.naturalHeight - 500 / 400) < .006; }, "Responsive viewport stopped painting under the control bar");
    result.responsiveViewport = true;
    await service.request(window.webContents, "viewport", { context: host.context });
    await until(aligned, "Resetting the responsive viewport distorted the preview");
    await tab.screenshot({ cropWidth: 300, cropHeight: 180 });
    await until(aligned, "Taking a cropped screenshot left the paused preview distorted");
    await tab.screenshot({ fullPage: true });
    await until(aligned, "Taking a full-page screenshot left the paused preview distorted");
    result.captureResize = true;

    const point = await tab.evaluate(`(() => {const r=document.querySelector('#resize-input').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const tabScale = tab.contents.getZoomFactor(), hostScale = window.webContents.getZoomFactor();
    const input = { context: host.context, tabId: tab.id, x: point.x * tabScale / hostScale, y: point.y * tabScale / hostScale, button: "left" };
    await service.request(window.webContents, "input", { ...input, type: "mouseDown", buttons: 1 });
    await service.request(window.webContents, "input", { ...input, type: "mouseUp", buttons: 0 });
    await until(() => tab.evaluate("document.activeElement.id === 'resize-input'"), "The resized preview sent the pointer to the wrong place");
    await service.request(window.webContents, "input", { context: host.context, tabId: tab.id, type: "text", text: "Still in control" });
    assert.equal(await tab.evaluate("document.querySelector('#resize-input').value"), "Still in control");
    assert.equal(host.paused, true); result.userInputAligned = true;
    const beforeResume = await tab.evaluate("({width:innerWidth,height:innerHeight})");
    await evaluate(`document.querySelector('[data-testid="browser-agent-control"]').click()`);
    await until(() => !host.paused && host.bounds.composited, "Resume did not restore the running response's controls");
    await until(() => !tab.resizingPresentation, "Resume left a resize running");
    await tab.paintReady;
    assert.deepEqual(await tab.evaluate("({width:innerWidth,height:innerHeight})"), beforeResume);
    result.resumePreservesLayout = true;
    await evaluate(`window.qaSetTaskStatus(1)`);
    await until(() => !host.bounds.composited && tab.paintMode === "none", "Completion did not release the resize capture");
  } catch (error) {
    result.resizeDebug = { surface: await sample(), bounds: host.bounds, view: tab.view.getBounds(), page: await tab.evaluate('({width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio})'), frameReady: host.frameReadyFor, metadata: latestFrame?.metadata, encodedSize: latestFrame?.data ? require('electron').nativeImage.createFromDataURL('data:image/jpeg;base64,'+latestFrame.data).getSize() : null, mode: tab.paintMode, paused: host.paused };
    await screenshot("paused-resize-failed.png");
    throw error;
  } finally { tab.contents.debugger.removeListener("message", record); }
}

module.exports = { verifyPausedResize };

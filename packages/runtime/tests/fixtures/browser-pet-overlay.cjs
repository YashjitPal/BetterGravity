const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error(message); await delay(25); }
}

async function verifyPetOverlay(window, service, host, tab, sourcePlugins, directory, result) {
  const evaluate = source => window.webContents.executeJavaScript(source);
  const petSource = fs.readFileSync(path.join(sourcePlugins, "pets/index.js"), "utf8");
  const petSurface = petSource.slice(0, petSource.indexOf("/* ═══ PART TWO"));
  const sheet = "data:image/webp;base64," + fs.readFileSync(path.join(sourcePlugins, "pets/assets/rocky.webp")).toString("base64");
  const css = ["pet.css", "hud.css"].map(name => fs.readFileSync(path.join(sourcePlugins, "pets/styles", name), "utf8")).join("\n").replaceAll("../assets/rocky.webp", sheet);
  const point = () => evaluate(`(() => {const r=document.querySelector('.bettergravity-pet').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const pointer = async (type, p, buttons) => {
    window.webContents.sendInputEvent({ type, ...p, button: "left", clickCount: 1, modifiers: buttons ? ["leftButtonDown"] : [] });
    await delay(50);
  };
  const pagePoint = async selector => {
    const p = await tab.evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const scale = tab.contents.getZoomFactor() / window.webContents.getZoomFactor();
    return { x: Math.round(host.bounds.x + p.x * scale), y: Math.round(host.bounds.y + p.y * scale) };
  };
  const clickPage = async selector => { const p = await pagePoint(selector); await pointer("mouseMove", p, 0); await pointer("mouseDown", p, 1); await pointer("mouseUp", p, 0); };
  const holdDecodes = () => evaluate(`(() => {window.qaImageDecode=Image.prototype.decode;window.qaPendingDecodes=[];Image.prototype.decode=function(){return window.qaImageDecode.call(this).then(()=>new Promise(resolve=>window.qaPendingDecodes.push(resolve)))}})()`);
  const releaseDecodes = () => evaluate(`Image.prototype.decode=window.qaImageDecode;window.qaPendingDecodes.splice(0).forEach(resolve=>resolve())`);
  const originalRequest = service.request;
  const pendingAcknowledgements = [];
  const setDesktopOccluded = value => evaluate(`(() => {
    window.qaDocumentVisibility ??= {hidden:Object.getOwnPropertyDescriptor(document,'hidden'),visibilityState:Object.getOwnPropertyDescriptor(document,'visibilityState')};
    Object.defineProperty(document,'hidden',{configurable:true,value:${value}});
    Object.defineProperty(document,'visibilityState',{configurable:true,value:${value}?'hidden':'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  const snapshot = async () => ({ bounds: host.bounds, native: tab.view.getBounds(), ready: host.frameReadyFor, mode: tab.paintMode, sequence: tab.frameSequence,
    dom: await evaluate(`(() => {const image=document.querySelector('.bg-browser-surface'),pet=document.querySelector('.bettergravity-pet');return {hidden:image.hidden,width:image.naturalWidth,height:image.naturalHeight,petDragging:pet?.dataset.petDragging,focus:document.activeElement.className}})()`) });
  try {
    await until(() => host.attachedTab === tab && !host.bounds.composited, "The initial page is not native");
    // A full-screen transparent desktop pet becomes an occluding window when
    // Windows removes click-through. The host reports hidden while its pane
    // remains visible. Neither that event nor later layout work may remove it.
    const beforeOcclusion = tab.view.getBounds();
    await setDesktopOccluded(true);
    await delay(80);
    assert(host.attachedTab === tab, "Hovering the desktop pet detached the visible browser page");
    service.changed(host);
    await delay(80);
    assert(host.attachedTab === tab, "A layout update during desktop pet hover detached the page");
    assert.deepEqual(tab.view.getBounds(), beforeOcclusion);
    await evaluate(`window.qaSetPaneOpen(false)`);
    await until(() => !host.attachedTab, "Closing the pane while covered by the desktop pet left its page attached");
    await evaluate(`window.qaSetPaneOpen(true)`);
    await until(() => host.attachedTab === tab, "Reopening the pane under the desktop pet did not restore the page");
    await setDesktopOccluded(false);
    result.desktopPetHoverKeepsPage = true;
    await evaluate(`(() => {
      const style=document.createElement('style');style.id='qa-pet-css';style.textContent=${JSON.stringify(css)};document.head.append(style);
      ${petSurface}
      window.qaPetMessages=[];
      window.qaMountPet = (x,y) => {
        window.qaReceivePet?.({t:'bye'});
        petSurface({send:message=>{window.qaPetMessages.push(message);if(message.t==='poke'){window.focus();document.querySelector('.composer').focus()}},onMessage:listener=>{window.qaReceivePet=listener;return ()=>{window.qaReceivePet=null}},setInteractive(){},setFocusable(){}}, {desktop:false,at:{x,y},config:{size:80,bounce:false,sheet:${JSON.stringify(sheet)}},entries:[]});
      };
      const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();window.qaMountPet(r.x+40,r.y+40);
    })()`);
    await until(async () => host.frameReadyFor === tab.id && !(await snapshot()).dom.hidden, "The pet's first preview never became ready");
    await setDesktopOccluded(true);
    service.changed(host);
    await delay(80);
    assert(host.attachedTab === tab, "Desktop pet hover detached a composited page");
    assert.equal((await snapshot()).dom.hidden, false, "Desktop pet hover hid the composited preview");
    await setDesktopOccluded(false);
    result.desktopPetHoverKeepsPreview = true;
    let p = await point();
    await pointer("mouseMove", p, 0); await pointer("mouseDown", p, 1);
    await until(() => host.bounds.hostDragging, "Pressing the pet did not enter the real drag path");
    await pointer("mouseUp", p, 0);
    await until(() => !host.bounds.hostDragging, "Releasing the pet left a drag active");
    await until(() => evaluate(`window.qaPetMessages.some(message=>message.t==='poke')`), "Pet click did not focus the composer");
    result.petClick = await snapshot();
    assert.equal(result.petClick.dom.hidden, false, "Clicking the pet hid the live page");
    assert.equal(result.petClick.dom.focus, "composer");
    result.petClickKeepsPreview = true;
    await clickPage("#counter");
    await until(() => tab.evaluate("window.clicks === 1 && window.trusted"), "The browser stopped accepting clicks after the pet was pressed");
    await clickPage("#name");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "A" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "A" });
    await until(() => tab.evaluate("document.querySelector('#name').value.toLowerCase() === 'a'"), "The browser stopped accepting text after the pet focused the composer");
    result.petClickKeepsInput = true;

    // A held pet can cross into the browser before its first image is decoded.
    // Hold that real decode to make a busy host renderer deterministic.
    await evaluate(`window.qaMountPet(200,160)`);
    await until(() => !host.bounds.composited && tab.paintMode === "none", "Moving the pet away did not restore the native page");
    await holdDecodes();
    p = await point();
    await pointer("mouseMove", p, 0); await pointer("mouseDown", p, 1);
    const target = await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();return {x:Math.round(r.x+90),y:Math.round(r.y+90)}})()`);
    await pointer("mouseMove", target, 1);
    await until(() => host.bounds.composited && host.bounds.hostDragging, "Dragging the pet into the page did not start the overlay handoff");
    await until(() => evaluate(`window.qaPendingDecodes.length>0`), "The browser produced no preview to decode");
    result.pendingPetHandoff = await snapshot();
    assert.equal(result.pendingPetHandoff.dom.hidden, true, "The delayed preview should not be ready yet");
    assert(tab.view.getBounds().x < window.getContentSize()[0], "Picking up the pet hid the native page before its preview was decoded");
    result.noBlankHandoff = true;
    await releaseDecodes();
    await until(() => host.frameReadyFor === tab.id, "The pet handoff never completed after decoding resumed");
    await pointer("mouseUp", target, 0);
    await until(() => !host.bounds.hostDragging, "Releasing the dragged pet left the page blocked");
    result.petDrag = await snapshot();
    result.petDragKeepsPreview = !result.petDrag.dom.hidden;
    await clickPage("#counter");
    await until(() => tab.evaluate("window.clicks === 2"), "Dragging the pet left the browser unresponsive");

    // Keep changing real page pixels while repeatedly clicking the pet.
    await tab.evaluate(`window.qaPageTicks=0;window.qaPageTimer=setInterval(()=>{document.querySelector('#output').textContent='Frame '+(++window.qaPageTicks)},40)`);
    const beforeSource = await evaluate(`document.querySelector('.bg-browser-surface').src`);
    for (let i = 0; i < 5; i++) { p = await point(); await pointer("mouseMove", p, 0); await pointer("mouseDown", p, 1); await pointer("mouseUp", p, 0); }
    await until(() => evaluate(`!document.querySelector('.bg-browser-surface').hidden && document.querySelector('.bg-browser-surface').src!==${JSON.stringify(beforeSource)}`), "Pet clicks froze the live preview");
    assert(await tab.evaluate("window.qaPageTicks > 5"), "Pet clicks stopped the page animation");
    result.livePageKeepsPainting = true;
    await tab.evaluate(`clearInterval(window.qaPageTimer)`);

    p = await point(); await pointer("mouseDown", p, 1);
    await evaluate(`window.dispatchEvent(new Event('blur'))`);
    await until(() => !host.bounds.hostDragging, "Losing focus left the pet holding the page");
    await pointer("mouseUp", p, 0);
    await clickPage("#counter");
    await until(() => tab.evaluate("window.clicks === 3"), "Cancelling a pet press left the browser unresponsive");
    result.cancelledPetKeepsInput = true;

    // A previous overlay's acknowledgement can arrive after the pet has left
    // and entered again. It must not hide the page for the new, unready image.
    await evaluate(`window.qaMountPet(200,160)`);
    await until(() => !host.bounds.composited && tab.paintMode === "none", "The browser did not return to native presentation");
    service.request = function(owner, action, args) {
      if (action !== "present-frame") return originalRequest.call(this, owner, action, args);
      return new Promise((resolve, reject) => pendingAcknowledgements.push(() => originalRequest.call(this, owner, action, args).then(resolve, reject)));
    };
    await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();window.qaMountPet(r.x+40,r.y+40)})()`);
    await until(() => pendingAcknowledgements.length > 0, "The first pet overlay did not acknowledge its image");
    await evaluate(`window.qaMountPet(200,160)`);
    await until(() => !host.bounds.composited && tab.paintMode === "none", "The previous pet overlay did not close");
    await holdDecodes();
    await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();window.qaMountPet(r.x+40,r.y+40)})()`);
    await until(() => evaluate(`window.qaPendingDecodes.length>0`), "The replacement pet overlay did not decode a frame");
    service.request = originalRequest;
    await Promise.all(pendingAcknowledgements.splice(0).map(release => release()));
    result.afterLateAcknowledgement = await snapshot();
    assert.equal(result.afterLateAcknowledgement.dom.hidden, true);
    assert(tab.view.getBounds().x < window.getContentSize()[0], "An old pet overlay acknowledgement hid the page before its replacement was ready");
    result.lateAcknowledgementsRejected = true;
    await releaseDecodes();
    await until(() => host.frameReadyFor === tab.id, "The current pet overlay did not finish its handoff");
    fs.writeFileSync(path.join(directory, "pet-browser.png"), (await window.webContents.capturePage()).toPNG());
  } catch (error) {
    result.petDebug = await snapshot();
    fs.writeFileSync(path.join(directory, "pet-browser-failed.png"), (await window.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    service.request = originalRequest;
    await Promise.all(pendingAcknowledgements.splice(0).map(release => release()));
    await tab.evaluate(`clearInterval(window.qaPageTimer)`);
    await evaluate(`(() => {if(window.qaImageDecode)Image.prototype.decode=window.qaImageDecode;window.qaPendingDecodes?.splice(0).forEach(resolve=>resolve());window.qaReceivePet?.({t:'bye'});document.querySelector('#qa-pet-css')?.remove();for(const [key,saved] of Object.entries(window.qaDocumentVisibility??{})){if(saved)Object.defineProperty(document,key,saved);else delete document[key]}document.dispatchEvent(new Event('visibilitychange'))})()`);
  }
}

module.exports = { verifyPetOverlay };

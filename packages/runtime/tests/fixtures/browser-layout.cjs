const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() >= deadline) throw new Error(message); await delay(25); }
}

// Match the host's animated outer clip and independently sized cqw inner pane.
// In particular, maximizing moves the inner pane without resizing it again.
async function installLayout(window) {
  await window.webContents.executeJavaScript(`new Promise(resolve => { const style=document.createElement('link');style.rel='stylesheet';style.href='/tooltip.css';style.onload=()=>resolve(true);document.head.append(style); })`);
  await window.webContents.executeJavaScript(`(() => {
    // Antigravity can display a different conversation from the address bar.
    // Its list summary may also lag behind the live response. Keep both idle
    // so only the real response subscription can hold/finish this session.
    const taskListeners = new Set(), responseListeners = new Set(), optimisticListeners = new Set();
    const displayedConversation = 'qa-displayed-response';
    window.qaResponseState = {conversationId:displayedConversation,status:1,fullyIdle:true};
    const responseProvider = {
      getState: () => window.qaResponseState,
      onDidChange: listener => {responseListeners.add(listener);return {dispose:()=>responseListeners.delete(listener)}}
    };
    const responseManager = {peek:id=>id===displayedConversation?responseProvider:undefined,getAgentStates:()=>new Map([[displayedConversation,{provider:responseProvider}]])};
    const entry = {
      optimisticState: {getState:()=>window.qaOptimisticResponse,onDidChange:listener=>{optimisticListeners.add(listener);return {dispose:()=>optimisticListeners.delete(listener)}}},
      trueState: {getState:()=>({agentState:window.qaResponseState}),onDidChange:responseProvider.onDidChange}
    };
    const registry = {peek:id=>id===displayedConversation?entry:undefined,listen:(_id,listener)=>{listener();return ()=>{}}};
    const idle = {status:1,notFullyIdle:false,hasActiveChildren:false,waitingSteps:[]};
    const taskStore = {
      getState: () => ({conversation:{convoState:{type:'active',cascadeId:displayedConversation}},trajectorySummaries:{summaries:{[location.pathname.split('/').pop()]:idle,[displayedConversation]:idle}}}),
      subscribe: listener => {taskListeners.add(listener);return () => taskListeners.delete(listener)}
    };
    window.qaTaskListeners = taskListeners; window.qaResponseListeners = responseListeners;
    plugin.react = {getFiber: () => ({memoizedProps:{value:{store:taskStore}},return:{dependencies:{firstContext:{memoizedValue:responseManager,next:{memoizedValue:{registry}}}}}})};
    window.qaSetTaskStatus = status => {window.qaOptimisticResponse=undefined;window.qaResponseState={conversationId:displayedConversation,status,fullyIdle:status===1};for(const listener of [...responseListeners,...optimisticListeners])listener()};
    window.qaSetComposerStatus = status => {window.qaOptimisticResponse={agentState:{conversationId:displayedConversation,status,fullyIdle:status===1}};for(const listener of [...optimisticListeners])listener()};
    const layout = document.querySelector('.layout'), chat = layout.querySelector('.chat'), pane = layout.querySelector('.pane');
    const shell = document.createElement('div'); shell.style.cssText = 'display:flex;height:calc(100vh - 44px)';
    layout.before(shell);
    const sidebar = document.createElement('aside'); sidebar.id = 'qa-sidebar'; sidebar.textContent = 'Sidebar'; sidebar.style.cssText = 'width:160px;flex-shrink:0;overflow:hidden;transition:width 250ms linear;background:#202020';
    shell.append(sidebar, layout); layout.style.cssText = 'container-type:size;position:relative;flex:1;min-width:0;height:100%';
    chat.style.cssText = 'width:auto;flex:1;min-width:300px';
    const clip = document.createElement('div'); clip.id = 'qa-pane-clip'; clip.style.cssText = 'position:relative;width:60%;height:100%;flex-shrink:0;overflow:hidden;transition:width 250ms linear';
    const inner = document.createElement('div'); inner.id = 'qa-pane-inner'; inner.style.cssText = 'position:absolute;width:60cqw;height:100%;top:0;left:0;display:flex';
    const divider = document.createElement('div'); divider.className = 'bg-border flex-shrink-0 w-[1px]'; divider.style.cssText = 'position:relative;z-index:30;height:100%';
    const handle = document.createElement('div'); handle.className = 'cursor-col-resize'; handle.style.cssText = 'position:absolute;left:-4px;width:8px;top:0;height:100%;cursor:col-resize'; divider.append(handle);
    layout.append(divider, clip); clip.append(inner); inner.append(pane); pane.style.width = '100%';
    const style = document.createElement('style'); style.textContent = 'div.bg-border.w-\\\\[1px\\\\], div.bg-border.flex-shrink-0.w-\\\\[1px\\\\]{display:none!important}'; document.head.append(style);
    const tabStyle = document.createElement('style'); tabStyle.textContent = '.toolbar .qa-pane-tab{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:28px;height:24px;padding:4px 6px;line-height:16px}.toolbar .bg-secondary{background:rgb(48,48,48);color:rgb(238,238,238)}.toolbar .bg-transparent{background:transparent;color:rgb(167,167,167)}'; document.head.append(tabStyle);
    const toolbar = document.querySelector('.toolbar');
    toolbar.style.flexShrink = '0'; toolbar.firstElementChild.style.cssText = 'display:flex;gap:2px;flex-shrink:0';
    const fileTabs = document.createElement('div'); fileTabs.className = 'overflow-x-auto qa-file-tabs'; fileTabs.style.cssText = 'display:flex;align-items:center;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;gap:1px';
    const file = document.createElement('button'); file.dataset.tabId = 'file:fixture'; file.textContent = 'fixture.ts'; file.setAttribute('aria-label','fixture.ts file tab'); fileTabs.append(file); toolbar.append(fileTabs);
    const plus = document.createElement('button'); plus.id = 'qa-plus'; plus.dataset.testid = 'aux-panel-plus-dropdown-trigger'; plus.setAttribute('aria-label','Add'); plus.setAttribute('aria-haspopup','menu'); plus.setAttribute('aria-expanded','false'); plus.textContent = '+'; plus.style.flexShrink = '0'; toolbar.append(plus);
    plus.addEventListener('click', () => {
      const previous = document.querySelector('#qa-plus-menu');
      if (previous) { previous.remove(); plus.setAttribute('aria-expanded','false'); plus.focus(); return; }
      const menu = document.createElement('div'); menu.id = 'qa-plus-menu'; menu.setAttribute('role','menu'); menu.setAttribute('aria-labelledby',plus.id); menu.style.cssText = 'position:fixed;top:84px;right:10px;z-index:1000;background:#242424;padding:5px';
      const entries = ['Open File','New Terminal'].map(title => {const entry=document.createElement('div');entry.setAttribute('role','menuitem');entry.tabIndex=-1;entry.textContent=title;entry.style.padding='6px';menu.append(entry);return entry});
      menu.addEventListener('keydown',event=>{const index=entries.indexOf(document.activeElement);if(index>=0&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();entries[(index+(event.key==='ArrowDown'?1:-1)+entries.length)%entries.length].focus()}if(event.key==='Escape')plus.click()});
      document.body.append(menu); plus.setAttribute('aria-expanded','true'); entries[0].focus();
    });
    const nativeTabs = [...toolbar.querySelectorAll('[data-tab-id]')].filter(tab => !tab.hasAttribute('data-bg-browser-page-tab'));
    const selectPane = id => {toolbar.dataset.activeTabId=id;for(const tab of nativeTabs)tab.className=(tab===file?'qa-file-tab ':'qa-pane-tab ')+(tab.dataset.tabId===id?'bg-secondary text-foreground':'bg-transparent text-secondary-foreground')};
    for (const tab of nativeTabs) tab.addEventListener('click',()=>selectPane(tab.dataset.tabId));
    selectPane('terminal');
    let percent = 60, maximized = false, paneOpen = true;
    const size = value => { percent = value; clip.style.width = paneOpen ? value + '%' : '0px'; inner.style.width = value + 'cqw'; };
    window.qaSetPaneOpen = (open, unmount = false) => {
      paneOpen = open; pane.dataset.auxPaneOpen = String(open);
      clip.style.visibility = open ? 'visible' : 'hidden';
      clip.style.width = open ? (maximized ? '100%' : percent + '%') : '0px';
      if (!open && unmount) pane.remove();
      if (open && !pane.isConnected) inner.append(pane);
    };
    const togglePane = document.createElement('button'); togglePane.dataset.testid = 'toggle-aux-sidebar'; togglePane.textContent = 'Toggle pane';
    togglePane.addEventListener('click', () => window.qaSetPaneOpen(!paneOpen));
    document.querySelector('.title').append(togglePane);
    handle.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); let previous = event.screenX;
      const cursor = document.body.style.cursor; document.body.style.cursor = 'col-resize'; clip.style.transition = 'none';
      const move = next => { const width = layout.clientWidth; size(Math.max(300 / width * 100, Math.min((width - 300) / width * 100, percent - (next.screenX - previous) / width * 100))); previous = next.screenX; };
      const up = () => { document.body.removeEventListener('mousemove', move); document.body.removeEventListener('mouseup', up); document.body.style.cursor = cursor; clip.style.transition = 'width 250ms linear'; };
      document.body.addEventListener('mousemove', move); document.body.addEventListener('mouseup', up);
    });
    handle.addEventListener('dblclick', () => size(60));
    const maximize = document.createElement('button'); maximize.dataset.testid = 'toggle-maximize-pane'; maximize.textContent = 'Maximize Pane';
    maximize.addEventListener('click', () => { maximized = !maximized; clip.style.width = maximized ? '100%' : percent + '%'; inner.style.width = maximized ? '100cqw' : percent + 'cqw'; chat.style.minWidth = maximized ? '0' : '300px'; chat.style.padding = maximized ? '0' : '30px'; maximize.textContent = maximized ? 'Restore Pane' : 'Maximize Pane'; });
    const collapse = document.createElement('button'); collapse.dataset.testid = 'qa-collapse-sidebar'; collapse.textContent = 'Toggle sidebar'; collapse.addEventListener('click', () => sidebar.style.width = sidebar.style.width === '0px' ? '160px' : '0px');
    document.querySelector('.title').append(maximize, collapse);
    window.qaResize = delta => {
      const activeHandle = document.querySelector('[data-bg-browser-resize-handle]') || handle;
      const x = activeHandle.getBoundingClientRect().x, y = 200;
      const fire = (target, type, at, buttons) => target.dispatchEvent(new MouseEvent(type, {bubbles:true,cancelable:true,view:window,button:0,buttons,clientX:at,clientY:y,screenX:at,screenY:y}));
      fire(activeHandle, 'mousedown', x, 1); fire(document.body, 'mousemove', x + delta, 1); fire(document.body, 'mouseup', x + delta, 0);
    };
  })()`);
}

async function verifyPageTabs(window, service, host, tab, result) {
  const evaluate = async expression => {
    const response = await window.webContents.debugger.sendCommand("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error((response.exceptionDetails.exception?.description || response.exceptionDetails.text) + "\n" + expression);
    return response.result.value;
  };
  const selectOriginal = () => evaluate(`[...document.querySelectorAll('[data-bg-browser-page-tab]')].find(node=>node.dataset.bgBrowserPageTab===${JSON.stringify(tab.id)}).click()`);
  await until(() => evaluate(`!!document.querySelector('.qa-file-tabs .bg-browser-tabs')`), "Browser tabs did not join the native file-tab scroller");
  assert.equal(await evaluate(`!!document.querySelector('.bg-browser-trigger, .bg-browser-strip, [aria-label="Close browser pane"]')`), false, "A redundant browser control remains");
  assert(await evaluate(`(() => {const header=document.querySelector('[data-active-tab-id]').getBoundingClientRect(),tab=document.querySelector('[data-bg-browser-page-tab]').getBoundingClientRect(),navigation=document.querySelector('.bg-browser-navigation').getBoundingClientRect();return tab.y>=header.y&&tab.bottom<=header.bottom&&Math.abs(navigation.y-header.bottom)<1})()`), "Page tabs occupy a separate vertical row");
  await evaluate(`document.querySelector('[data-tab-id="file:fixture"]').click()`);
  await until(() => !host.visible, "Selecting a file did not reveal the native content");
  assert(await evaluate(`![...document.querySelectorAll('[data-bg-browser-page-tab]')].some(node=>node.getAttribute('aria-selected')==='true')`), "A browser page stayed selected while viewing a file");
  await selectOriginal();
  await until(() => host.visible && host.attachedTab === tab, "A browser page tab could not reopen the browser from a file");
  assert(await evaluate(`!!document.querySelector('[data-bg-browser-page-tab][aria-selected="true"]')`));
  await evaluate(`document.querySelector('[data-testid="aux-panel-plus-dropdown-trigger"]').click()`);
  await until(() => evaluate(`!!document.querySelector('[data-bg-browser-new-tab]')`), "The native + menu has no Browser tab option");
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#qa-plus-menu [role="menuitem"]')].map(node=>node.textContent)`), ['Open File','New Terminal','Browser tab']);
  await evaluate(`(() => {const entries=document.querySelectorAll('#qa-plus-menu [role="menuitem"]');entries[1].focus();entries[1].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))})()`);
  assert(await evaluate(`document.activeElement.hasAttribute('data-bg-browser-new-tab')`), "Keyboard navigation skipped the new browser entry");
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);
  await until(() => host.tabs.size === 2 && evaluate(`document.querySelectorAll('[data-bg-browser-page-tab]').length===2 && !document.querySelector('#qa-plus-menu')`), "The shared + menu did not create exactly one browser tab and close");
  const added = service.findTab(host);
  await selectOriginal();
  await until(() => host.activeTabId === tab.id && host.attachedTab === tab, "Top browser tabs did not select the intended page");
  await evaluate(`window.qaStablePageTab=[...document.querySelectorAll('[data-bg-browser-page-tab]')].find(node=>node.dataset.bgBrowserPageTab===${JSON.stringify(tab.id)})`);
  await tab.evaluate(`document.title='Browser QA · Updated title'`);
  await until(() => evaluate(`window.qaStablePageTab.textContent.includes('Updated title')`), "Tab title updates did not reach the top bar");
  assert(await evaluate(`window.qaStablePageTab.isConnected`), "A title update replaced the hovered browser tab node");
  await evaluate(`[...document.querySelectorAll('[data-bg-browser-page-tab]')].find(node=>node.dataset.bgBrowserPageTab===${JSON.stringify(added.id)}).querySelector('button').click()`);
  await until(() => host.tabs.size === 1 && evaluate(`document.querySelectorAll('[data-bg-browser-page-tab]').length===1`), "The page close button did not close its own tab");
  assert(host.visible && host.activeTabId === tab.id, "Closing a background page hid the pane or selected the wrong tab");
  result.sharedPageTabs = true; result.nativePlusMenu = true;

  const zoom = window.webContents.getZoomFactor();
  await evaluate(`document.querySelector('#qa-pane-clip').style.transform='translateX(.35px)'`); await delay(100);
  await until(() => host.attachedTab === tab && !host.bounds.composited, "Hover check did not start in native rendering");
  const native = tab.view.getBounds(), pageSize = await tab.evaluate('({width:innerWidth,height:innerHeight})');
  const viewport = await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const hover = await evaluate(`(() => {const node=document.querySelector('[data-bg-browser-page-tab]');node.scrollIntoView({block:'nearest',inline:'nearest'});const r=node.getBoundingClientRect();return {x:r.x+20,y:r.y+r.height/2}})()`);
  window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(hover.x*zoom),y:Math.round(hover.y*zoom)});
  // A two-line title tooltip can overlap the page and trigger the compositor.
  await evaluate(`(() => {const tip=document.createElement('div');tip.id='qa-tab-title-tooltip';tip.setAttribute('role','tooltip');tip.style.cssText='position:fixed;z-index:1000;background:#333;width:180px;height:50px;left:${viewport.x+20}px;top:${viewport.y-15}px';tip.textContent='Page title and URL';document.body.append(tip)})()`);
  await until(() => host.frameReadyFor === tab.id && evaluate(`!document.querySelector('.bg-browser-surface').hidden`), "Hover tooltip did not paint the page in the host");
  const painted = await evaluate(`(() => {const r=document.querySelector('.bg-browser-surface').getBoundingClientRect();return {x:r.x*${zoom},y:r.y*${zoom},width:r.width*${zoom},height:r.height*${zoom}}})()`);
  for (const key of ['x','y','width','height']) assert(Math.abs(painted[key]-native[key])<.05, `Hover moved the page's ${key}: native ${native[key]}, composited ${painted[key]}`);
  assert.deepEqual(await tab.evaluate('({width:innerWidth,height:innerHeight})'), pageSize, "Tab hover resized the actual webpage");
  await evaluate(`document.querySelector('#qa-tab-title-tooltip').remove()`);
  await until(() => !host.bounds.composited, "The page did not return to native rendering after tab hover");
  assert.deepEqual(tab.view.getBounds(), native, "Leaving the tab changed the page bounds");
  window.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});
  await evaluate(`document.querySelector('#qa-pane-clip').style.transform=''`);
  await delay(100);
  result.tabHoverStable = true;
}

async function verifyPaneTabs(window, service, host, tab, result) {
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const controls = () => evaluate(`(() => {const header=document.querySelector('[data-active-tab-id]');return [...header.querySelectorAll('[data-tab-id]')].map(b=>({id:b.dataset.tabId,selected:b.getAttribute('aria-selected'),height:b.getBoundingClientRect().height,background:getComputedStyle(b).backgroundColor}))})()`);
  const initial = await controls(), browser = initial.find(button => button.id === `in-built-browser:${tab.id}`), native = initial.find(button => button.id === 'terminal');
  assert.equal(browser.height, native.height, "Browser indicator is taller than the native tabs");
  assert.notEqual(browser.background, 'rgba(0, 0, 0, 0)', "The active browser has no selected indicator");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bg-browser-viewport')).marginLeft`), '0px', "The website has a permanent resize gutter");
  const lineColor = () => evaluate(`getComputedStyle(document.querySelector('[data-bg-browser-resize-handle]'),'::after').backgroundColor`);
  const hover = await evaluate(`(() => {const r=document.querySelector('[data-bg-browser-resize-handle]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+150}})()`);
  const scale = window.webContents.getZoomFactor();
  window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(hover.x*scale),y:Math.round(hover.y*scale)});
  await until(async () => await lineColor() === 'rgb(168, 199, 250)', "The resize indicator did not appear on hover");
  window.webContents.sendInputEvent({type:'mouseMove',x:2,y:2});
  await until(async () => await lineColor() === 'rgba(0, 0, 0, 0)', "The resize indicator remained visible after hover ended");
  for (const id of ['overview', 'review', 'terminal']) {
    await evaluate(`document.querySelector('button[data-tab-id="${id}"]').click()`);
    await until(() => !host.visible && !host.attachedTab, "Selecting a native pane left the browser visible: " + id);
    const buttons = await controls();
    assert.equal(buttons.find(button => button.id === `in-built-browser:${tab.id}`).selected, 'false');
    assert.deepEqual(buttons.filter(button => button.background !== 'rgba(0, 0, 0, 0)').map(button => button.id), [id], "The wrong tab keeps its selected indicator");
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-bg-browser-resize-divider]')).display`), 'flex', "A native tab lost the pane resizer");
    const width = await evaluate(`document.querySelector('#qa-pane-clip').getBoundingClientRect().width`);
    await evaluate(`window.qaResize(-25)`);
    await until(() => evaluate(`document.querySelector('#qa-pane-clip').getBoundingClientRect().width > ${width + 20}`), "The native pane did not resize: " + id);
    await evaluate(`window.qaResize(25)`);
    await until(() => evaluate(`Math.abs(document.querySelector('#qa-pane-clip').getBoundingClientRect().width - ${width}) < 1`), "The native pane did not return to its original width: " + id);
  }
  await evaluate(`document.querySelector('[data-testid="toggle-maximize-pane"]').click()`); await delay(300);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-bg-browser-resize-divider]')).display`), 'none');
  await evaluate(`document.querySelector('[data-testid="toggle-maximize-pane"]').click()`); await delay(300);
  await until(() => evaluate(`getComputedStyle(document.querySelector('[data-bg-browser-resize-divider]')).display==='flex'`), "Restoring a native tab did not restore its resizer");
  await evaluate(`(() => {window.qaDetachedDivider=document.querySelector('[data-bg-browser-resize-divider]');window.qaDetachedDivider.remove()})()`);
  await until(() => evaluate(`!document.querySelector('[data-bg-browser-split]')`), "A removed native divider retained its bindings");
  await evaluate(`document.querySelector('#qa-pane-clip').before(window.qaDetachedDivider);delete window.qaDetachedDivider`);
  await until(() => evaluate(`!!document.querySelector('[data-bg-browser-resize-handle]')`), "The resizer did not reconnect while the browser was closed");
  await evaluate(`(() => {const old=document.querySelector('[data-bg-browser-container]'),replacement=document.createElement('div');replacement.className=old.className;replacement.textContent='Terminal pane';old.replaceWith(replacement)})()`);
  await until(() => evaluate(`!!document.querySelector('#bg-in-built-browser[hidden]')`), "Remounting a native pane reopened the browser");
  await until(() => evaluate(`!!document.querySelector('[data-bg-browser-page-tab]')`), "Remounting lost the browser page tabs");
  assert.equal((await controls()).find(button => button.id === `in-built-browser:${tab.id}`).background, 'rgba(0, 0, 0, 0)', "The browser inherited the selected Terminal indicator on remount");
  await evaluate(`document.querySelector('[data-bg-browser-page-tab]').click()`);
  await until(() => host.visible && host.attachedTab === tab, "The browser could not be reselected after native tabs");
  result.paneTabs = true;
}

async function verifyLayout(window, service, host, tab, directory, result) {
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const rect = () => evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const aligned = async () => {
    const box = await rect(), native = tab.view.getBounds(), scale = window.webContents.getZoomFactor();
    return Math.abs(native.x - box.x * scale) < 2 && Math.abs(native.y - box.y * scale) < 2;
  };
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Expand browser"]')`), false);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-bg-browser-resize-divider]')).display`), "flex");
  // The host can remove and reinsert its splitter in separate render commits.
  // The viewport's ancestor chain stays identical throughout.
  await evaluate(`(() => {window.qaDetachedDivider=document.querySelector('[data-bg-browser-resize-divider]');window.qaDetachedDivider.remove()})()`);
  await until(() => evaluate(`!document.querySelector('[data-bg-browser-split]')`), "Removing the native splitter did not release resize bindings");
  await evaluate(`document.querySelector('#qa-pane-clip').before(window.qaDetachedDivider);delete window.qaDetachedDivider`);
  await until(() => evaluate(`!!document.querySelector('[data-bg-browser-resize-handle]')`), "The resizer did not reconnect when the host restored its splitter");
  await until(aligned, "Restoring the splitter did not update native page bounds");
  const resizeHitArea = await evaluate(`(() => {const handle=document.querySelector('[data-bg-browser-resize-handle]'),r=handle.getBoundingClientRect(),v=document.querySelector('.bg-browser-viewport').getBoundingClientRect();return {right:r.right,width:r.width,cursor:getComputedStyle(handle).cursor,hit:handle.contains(document.elementFromPoint(v.left-1,v.top+80))}})()`);
  assert(resizeHitArea.width >= 12 && resizeHitArea.hit, "The browser edge has no usable resize hover area");
  assert(resizeHitArea.right * window.webContents.getZoomFactor() <= tab.view.getBounds().x + 0.6, "The native page covers part of the resize hover area");
  assert.equal(resizeHitArea.cursor, "col-resize");
  result.resizeHover = true;
  const narrow = await rect();
  await evaluate(`window.qaResize(-120)`); await until(async () => (await rect()).width > narrow.width + 110, "Dragging left did not widen the native pane");
  await evaluate(`document.querySelector('[data-testid="qa-collapse-sidebar"]').click()`); await delay(300);
  const collapsed = await rect(); assert(collapsed.width > narrow.width + 150, JSON.stringify({narrow,collapsed,host:await evaluate(`({sidebar:document.querySelector('#qa-sidebar').getBoundingClientRect().width,layout:document.querySelector('.layout').getBoundingClientRect().width,clip:document.querySelector('#qa-pane-clip').style.cssText})`)}));
  await evaluate(`document.querySelector('[data-bg-browser-resize-handle]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))`);
  await until(async () => (await rect()).width > collapsed.width + 25, "Keyboard resizing did not reach the native splitter");
  result.leftResize = true;
  for (let cycle = 0; cycle < 2; cycle++) {
    await evaluate(`document.querySelector('[data-testid="toggle-maximize-pane"]').click()`);
    await delay(350); await until(aligned, "Native browser stayed at the old position after maximize/restore");
  }
  // Pure transform motion never triggers ResizeObserver.
  await evaluate(`(() => {const node=document.querySelector('#qa-pane-clip');node.style.transition='transform 160ms linear';node.style.transform='translateX(-55px)'})()`);
  await delay(230); await until(aligned, "Browser missed a position-only animation");
  await evaluate(`document.querySelector('#qa-pane-clip').style.transform=''`); await delay(230);
  await until(aligned, "Browser did not realign when an animation was cancelled");
  await evaluate(`document.querySelector('#qa-pane-clip').style.transition='width 250ms linear'`);
  result.animationAlignment = true;
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`);
  await until(() => !host.attachedTab, "Closing the pane left the native page visible");
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`);
  await until(() => host.attachedTab === tab && host.bounds.visible, "Reopening identical bounds left the native page hidden");
  result.reopenAlignment = true;

  // Willow paints title tooltips in an aria-hidden wrapper without role=tooltip.
  // Its full-window container remains after a tooltip closes.
  await evaluate(`(() => {const container=document.createElement('div');container.className='willow-tooltip-container';container.id='qa-tooltip-container';document.body.append(container)})()`);
  await delay(80);
  assert.equal(host.bounds.composited, false, "An empty tooltip container covered the page");
  await evaluate(`(() => {const pane=document.createElement('div');pane.id='qa-tooltip';pane.className='willow-tooltip-pane willow-tooltip-pane--below';pane.style.cssText='left:5px;top:5px';const wrapper=document.createElement('div');wrapper.className='willow-tooltip willow-tooltip--show';wrapper.setAttribute('aria-hidden','true');const surface=document.createElement('div');surface.className='willow-tooltip-surface';surface.textContent='Tooltip above the page';wrapper.append(surface);pane.append(wrapper);document.querySelector('#qa-tooltip-container').append(pane)})()`);
  await delay(180);
  assert.equal(host.bounds.composited, false, "A tooltip outside the page enabled compositing");
  await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect(),pane=document.querySelector('#qa-tooltip');pane.style.left=(r.x+10)+'px';pane.style.top=(r.y+10)+'px'})()`);
  await until(() => host.bounds?.composited, "Willow tooltip did not enable compositing when it moved over the page");
  try { await until(() => evaluate(`!document.querySelector('.bg-browser-surface').hidden`), "No live browser frame reached the host DOM"); }
  catch (error) { result.compositorDebug = { mode:tab.paintMode,count:tab.paintCount,composited:tab.composited,sequence:tab.frameSequence,error:tab.error,bounds:host.bounds,view:tab.view.getBounds(),renderer:await evaluate(`({compositing,decodingFrame,frameGeneration,active:state.activeTabId,source:surface.src.slice(0,60),hidden:surface.hidden})`)}; throw error; }
  await until(() => tab.view.getBounds().x >= window.getContentSize()[0], "Native page still covers host tooltip");
  const frame = await evaluate(`document.querySelector('.bg-browser-surface').src`);
  assert(frame.startsWith("data:image/jpeg;base64,"));
  await until(() => evaluate(`(() => {const image=document.querySelector('.bg-browser-surface'),box=document.querySelector('.bg-browser-viewport').getBoundingClientRect();return Math.abs(image.naturalWidth/image.naturalHeight-box.width/box.height)<0.015})()`), "Compositor did not paint the complete viewport");
  const dimensions = await evaluate(`(() => {const image=document.querySelector('.bg-browser-surface'),box=document.querySelector('.bg-browser-viewport').getBoundingClientRect();return {imageWidth:image.naturalWidth,imageHeight:image.naturalHeight,width:box.width,height:box.height}})()`);
  assert(Math.abs(dimensions.imageWidth / dimensions.imageHeight - dimensions.width / dimensions.height) < 0.015, 'Composited page was stretched: ' + JSON.stringify({dimensions,meta:tab.qaFrameMeta,view:tab.view.getBounds(),host:window.getContentSize(),page:await tab.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})')}));
  fs.writeFileSync(path.join(directory, "browser-overlay.png"), (await window.webContents.capturePage()).toPNG());
  await tab.evaluate(`(() => {const button=document.createElement('button');button.id='qa-composite-click';button.textContent='Overlay input';button.style.cssText='position:fixed;bottom:20px;right:20px;z-index:200';button.onclick=e=>window.qaCompositeTrusted=e.isTrusted;document.body.append(button)})()`);
  const point = await tab.driver({ action: "bounds", selector: "#qa-composite-click" }), box = await rect();
  const scale = window.webContents.getZoomFactor();
  const coords = { x: Math.round((box.x + point.x) * scale), y: Math.round((box.y + point.y) * scale) };
  window.webContents.sendInputEvent({ type: "mouseMove", ...coords });
  window.webContents.sendInputEvent({ type: "mouseDown", ...coords, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", ...coords, button: "left", clickCount: 1 });
  await until(() => tab.evaluate("window.qaCompositeTrusted === true"), "Composited page did not receive a trusted click");
  await tab.evaluate(`document.querySelector('#qa-composite-click').remove()`);
  await tab.evaluate(`document.querySelector('#name').focus()`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Q" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Q" });
  await until(() => tab.evaluate(`/q/i.test(document.querySelector('#name').value)`), "Composited page did not receive keyboard input");
  await evaluate(`document.querySelector('.bg-browser-viewport').dispatchEvent(new CompositionEvent('compositionend',{data:'é',bubbles:true}))`);
  await until(() => tab.evaluate(`document.querySelector('#name').value.endsWith('é')`), "Composited page lost composed text input");
  await tab.evaluate("scrollTo(0,0)");
  window.webContents.sendInputEvent({ type: "mouseWheel", ...coords, deltaX: 0, deltaY: -160, canScroll: true });
  await until(() => tab.evaluate("scrollY > 50"), "Composited page did not scroll");
  await tab.evaluate("scrollTo(0,0)");
  await evaluate(`(() => {const pane=document.querySelector('#qa-tooltip'),wrapper=pane.firstElementChild;wrapper.classList.replace('willow-tooltip--show','willow-tooltip--hide');wrapper.addEventListener('animationend',()=>pane.remove(),{once:true});setTimeout(()=>pane.remove(),125)})()`);
  await until(() => !host.bounds.composited && window.contentView.children.includes(tab.view), "Native rendering did not resume after the Willow tooltip faded out");
  assert.equal(await evaluate(`!!document.querySelector('#qa-tooltip-container')`), true);
  await evaluate(`document.querySelector('#qa-tooltip-container').remove()`);
  result.willowTooltip = true;
  // Keep coverage of standard host tooltips and Base UI's popup markup too.
  for (const attribute of ['role="tooltip"', 'data-base-ui-tooltip-popup=""', 'data-radix-tooltip-content=""']) {
    await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect(),tip=document.createElement('div');tip.id='qa-standard-tooltip';tip.setAttribute(${JSON.stringify(attribute.split('=')[0])},${JSON.stringify(attribute.startsWith('role=') ? 'tooltip' : '')});tip.style.cssText='position:fixed;width:80px;height:40px;left:'+(r.x+10)+'px;top:'+(r.y+10)+'px';document.body.append(tip)})()`);
    await until(() => host.bounds.composited, "Host tooltip markup did not enable compositing: " + attribute);
    await evaluate(`document.querySelector('#qa-standard-tooltip').remove()`);
    await until(() => !host.bounds.composited, "Closing a standard tooltip left the page composited");
  }
  await evaluate(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();const pet=document.createElement('div');pet.id='qa-pet';pet.className='bettergravity-pet';pet.style.cssText='position:fixed;z-index:2147483000;width:80px;height:80px;background:#df945e;left:'+(r.x+40)+'px;top:'+(r.y+40)+'px';document.body.append(pet)})()`);
  await until(() => host.bounds.composited, "Pet did not stay above the page");
  await evaluate(`document.querySelector('button[data-tab-id="overview"]').click()`);
  await until(() => !host.attachedTab, "Pet overlay kept a closed page attached");
  await evaluate(`document.querySelector('[data-bg-browser-page-tab]').click()`);
  await until(() => host.frameReadyFor === tab.id && tab.view.getBounds().x >= window.getContentSize()[0], "Reopening lost the overlay handoff");
  await evaluate(`document.querySelector('#qa-pet').style.left='5px'`);
  await until(() => !host.bounds.composited, "Moving the pet away left the compositor running");
  await evaluate(`document.querySelector('#qa-pet').remove()`);
  result.overlayCompositing = true;
  // A replaced pane body must immediately release old bounds and remount.
  await evaluate(`(() => {const old=document.querySelector('[data-bg-browser-container]'), replacement=document.createElement('div');replacement.className=old.className;const native=document.createElement('div');native.className='overview';native.textContent='Native pane';replacement.append(native);old.replaceWith(replacement)})()`);
  await until(() => evaluate(`!!document.querySelector('#bg-in-built-browser:not([hidden])')`), "Replacing the pane body did not remount the open browser");
  await until(aligned, "Remount left the browser at stale coordinates");
  result.remountAlignment = true;
  await evaluate(`document.querySelector('[data-testid="qa-collapse-sidebar"]').click()`); await delay(300);
}

async function verifyPlayback(window, service, host, tab, result, stage) {
  stage("starting sustained video playback");
  await tab.evaluate(`(async () => {
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const context=canvas.getContext('2d');let count=0;
    const paint=()=>{context.fillStyle=count++%2?'#2476d0':'#2760ac';context.fillRect(0,0,320,180);context.fillStyle='white';context.font='24px sans-serif';context.fillText('Playback '+count,20,95)};
    paint();window.qaVideoTimer=setInterval(paint,40);
    const video=document.createElement('video');video.id='qa-video';video.muted=true;video.style.cssText='position:fixed;bottom:12px;left:12px;width:320px;height:180px;z-index:500';video.srcObject=canvas.captureStream(25);document.body.append(video);await video.play();
  })()`);
  result.playbackSamples = [];
  for (let step = 1; step <= 5; step++) {
    await delay(10_000);
    const sample = await tab.evaluate(`(() => {const video=document.querySelector('#qa-video');return {time:video.currentTime,paused:video.paused,ready:video.readyState,error:video.error?.message}})()`);
    result.playbackSamples.push(sample); stage(`sustained video playback ${step * 10}/50 seconds`);
    assert.equal(sample.paused, false); assert.equal(sample.error, undefined); assert(sample.time > step * 10 - 2);
    assert.equal(tab.contents.getBackgroundThrottling(), false, "Active media was background-throttled");
    if (step === 1) {
      await window.webContents.executeJavaScript(`(() => {const r=document.querySelector('.bg-browser-viewport').getBoundingClientRect();const pet=document.createElement('div');pet.id='qa-media-pet';pet.className='bettergravity-pet';pet.style.cssText='position:fixed;z-index:200000;width:60px;height:60px;background:#df945e;left:'+(r.x+10)+'px;top:'+(r.y+10)+'px';document.body.append(pet)})()`);
      await until(() => host.bounds.composited, "Video did not enter the host compositor");
    }
    if (step === 2) {
      const before = tab.frameSequence;
      await window.webContents.executeJavaScript(`(() => {window.qaBadFrames=[];const image=document.querySelector('.bg-browser-surface');window.qaCheckFrame=()=>{const box=document.querySelector('.bg-browser-viewport').getBoundingClientRect();if(!image.hidden&&Math.abs(image.naturalWidth/image.naturalHeight-box.width/box.height)>0.015)window.qaBadFrames.push([image.naturalWidth,image.naturalHeight])};image.addEventListener('load',window.qaCheckFrame)})()`);
      try {
        await tab.screenshot();
        await tab.screenshot({ cropX: 0, cropY: 0, cropWidth: 20, cropHeight: 20 });
        await tab.screenshot({ fullPage: true });
      }
      catch (error) {
        result.playbackCaptureDebug = { before, sequence: tab.frameSequence, mode: tab.paintMode, count: tab.paintCount, composited: tab.composited,
          bounds: host.bounds, view: tab.view.getBounds(), frameReady: host.frameReadyFor === tab.id, meta: tab.qaFrameMeta, tabError: tab.error,
          page: await tab.evaluate(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,video:document.querySelector('#qa-video').currentTime})`),
          surface: await window.webContents.executeJavaScript(`(() => {const i=document.querySelector('.bg-browser-surface');return {width:i.naturalWidth,height:i.naturalHeight,hidden:i.hidden}})()`) };
        throw error;
      }
      await until(() => tab.frameSequence > before + 1, "Finishing a screenshot stopped the live video stream");
      await delay(150);
      assert.deepEqual(await window.webContents.executeJavaScript(`window.qaBadFrames`), [], "A screenshot crop leaked into the live browser preview");
      await window.webContents.executeJavaScript(`document.querySelector('.bg-browser-surface').removeEventListener('load',window.qaCheckFrame)`);
    }
    if (step === 4) {
      await window.webContents.executeJavaScript(`document.querySelector('#qa-media-pet').remove()`);
      await until(() => !host.bounds.composited, "Video did not return to native rendering");
    }
  }
  await tab.evaluate(`(() => {const video=document.querySelector('#qa-video');video.pause();video.srcObject.getTracks().forEach(track=>track.stop());video.remove();clearInterval(window.qaVideoTimer)})()`);
  result.sustainedPlayback = true;
}

module.exports = { installLayout, verifyPaneTabs, verifyPageTabs, verifyLayout, verifyPlayback };

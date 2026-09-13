const assert = require("node:assert/strict");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 6000;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error(message); await delay(25); }
}

async function verifyBrowserVisibility(window, service, host, tab, result) {
  const evaluate = source => window.webContents.executeJavaScript(source);
  const paneOpen = () => evaluate(`document.querySelector('[data-aux-pane-open]')?.getAttribute('data-aux-pane-open') === 'true'`);
  const route = async name => {
    await evaluate(`history.pushState({}, '', ${JSON.stringify(`/c/${name}`)})`);
    await until(() => service.hosts.has(`${window.webContents.id}:${name}`), "The new conversation did not attach");
  };
  await service.execute("get_browser_documentation", { browser_id: host.id });
  assert(await paneOpen());
  const identity = await tab.evaluate("window.qaVisibilityIdentity = Math.random(); window.qaVisibilityIdentity");
  const originalContext = host.context;
  const secondContext = "browser-visibility-closed";
  await route(secondContext);
  await until(async () => !await paneOpen(), "An open sidebar leaked into a new conversation");
  const second = service.hosts.get(`${window.webContents.id}:${secondContext}`);
  assert(second.tabs.has(tab.id), "Hiding the sidebar removed a shared browser tab");
  await evaluate(`window.qaSetPaneOpen(true)`);
  await until(paneOpen, "Manual sidebar opening stopped working");
  await evaluate(`document.querySelector('[data-tab-id="terminal"]').click()`);
  await evaluate(`window.qaSetPaneOpen(false)`);
  await delay(80);
  await route(originalContext);
  await until(paneOpen, "The original conversation did not retain its open sidebar");
  await route(secondContext);
  await until(async () => !await paneOpen(), "The closed conversation inherited another conversation's open sidebar");
  result.conversationPaneVisibility = true;

  // Browser selection and the outer sidebar are different state. This chat
  // has a historical reveal sequence and a selected browser, then is collapsed.
  await route(originalContext);
  await until(paneOpen, "Original sidebar did not restore");
  await evaluate(`window.qaSetPaneOpen(false, true)`);
  await until(() => evaluate(`!document.querySelector('#bg-in-built-browser')`), "Collapsed fixture did not unmount");
  await route(secondContext);
  await route(originalContext);
  await delay(150);
  assert.equal(await paneOpen(), false, "An old browser reveal reopened a collapsed conversation");
  service.changed(host);
  await tab.evaluate("document.title='Background title update'");
  await delay(100);
  assert.equal(await paneOpen(), false, "A page-state update reopened the sidebar");
  result.staleRevealDoesNotOpen = true;
  await service.execute("get_browser_documentation", { browser_id: host.id });
  await until(paneOpen, "A new tool call did not reopen the collapsed conversation");
  await until(() => host.attachedTab === tab, "A new tool call did not restore the browser page");
  result.freshRevealStillOpens = true;

  // Both plugin pages keep /c/:id in the address bar and cover the chat.
  const custom = async (id, className, visible) => {
    await evaluate(`(() => {
      const conversation = document.querySelector('[data-testid="conversation-view"]');
      if (${visible}) {
        const page = document.createElement('section'); page.id = ${JSON.stringify(id)};
        page.style.cssText = 'position:absolute;inset:0;display:flex'; conversation.parentElement.append(page);
        conversation.style.visibility = 'hidden'; document.body.classList.add(${JSON.stringify(className)});
      } else {
        document.getElementById(${JSON.stringify(id)})?.remove(); conversation.style.visibility = '';
        document.body.classList.remove(${JSON.stringify(className)});
      }
    })()`);
  };
  for (const [id, className] of [["bettergravity-pets-view", "bettergravity-pets-open"], ["gemini-skills-view", "gemini-skills-open"]]) {
    await custom(id, className, true);
    await until(async () => !await paneOpen() && await evaluate(`!document.querySelector('#bg-in-built-browser, [data-bg-browser-resize-handle]')`), `${id} retained the browser sidebar`);
    assert.equal(host.attachedTab, null);
    service.changed(host);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}))`);
    await evaluate(`showSettings()`);
    await delay(100);
    assert.equal(await paneOpen(), false, `${id} allowed the browser to reopen on top of it`);
    await custom(id, className, false);
    await until(paneOpen, "Leaving a full-page view did not restore the conversation's sidebar");
    await until(() => host.attachedTab === tab, "Leaving a full-page view lost the browser page");
  }
  result.customPagesHidePane = true;

  await evaluate(`window.qaSetPaneOpen(false)`);
  await delay(80);
  await custom("bettergravity-pets-view", "bettergravity-pets-open", true);
  host.revealSequence++; service.changed(host);
  await delay(80);
  assert.equal(await paneOpen(), false);
  await custom("bettergravity-pets-view", "bettergravity-pets-open", false);
  await delay(150);
  assert.equal(await paneOpen(), false, "Leaving Pets replayed a hidden browser reveal");
  result.hiddenRevealDoesNotReplay = true;

  await service.execute("get_browser_documentation", { browser_id: host.id });
  await until(paneOpen, "Browser did not open before leaving the conversation route");
  // Native React state can commit after the user has navigated again. Delay
  // real toggle handling and ensure the final conversation wins without a
  // second click cancelling the first pending change.
  await evaluate(`(() => {
    window.qaPaneToggleCommits = 0;
    window.qaPendingPaneToggles = 0;
    window.qaDelayPaneToggle = event => {
      event.stopImmediatePropagation();
      const next = document.querySelector('[data-aux-pane-open]')?.getAttribute('data-aux-pane-open') !== 'true';
      window.qaPendingPaneToggles++;
      setTimeout(() => {
        window.qaSetPaneOpen(next);
        window.qaPaneToggleCommits++; window.qaPendingPaneToggles--;
      }, 100);
    };
    document.querySelector('[data-testid="toggle-aux-sidebar"]').addEventListener('click', window.qaDelayPaneToggle, true);
  })()`);
  await route(secondContext);
  await route(originalContext);
  await until(() => evaluate(`window.qaPaneToggleCommits === 2 && window.qaPendingPaneToggles === 0`), "Rapid navigation lost the pending native pane toggle");
  assert(await paneOpen(), "A late native toggle closed the destination conversation");
  await route(secondContext);
  await until(async () => !await paneOpen(), "Rapid navigation overwrote the closed conversation's visibility");
  await route(originalContext);
  await until(paneOpen, "Rapid navigation overwrote the open conversation's visibility");
  await evaluate(`document.querySelector('[data-testid="toggle-aux-sidebar"]').removeEventListener('click', window.qaDelayPaneToggle, true)`);
  result.delayedPaneNavigation = true;

  await evaluate(`history.pushState({}, '', '/settings')`);
  await until(async () => !await paneOpen() && await evaluate(`!document.querySelector('#bg-in-built-browser')`), "A non-conversation route retained browser chrome");
  await route(originalContext);
  await until(paneOpen, "Returning from a non-conversation route lost pane visibility");
  assert.equal(await tab.evaluate("window.qaVisibilityIdentity"), identity, "Visibility changes reloaded the shared page");
  const display = await evaluate(`getComputedStyle(document.querySelector('[data-testid="conversation-view"]')).display`);
  assert.equal(display, "flex", "Visibility changes damaged the conversation layout");
  result.nonConversationRoutesHidePane = result.visibilityKeepsPageState = true;
}

module.exports = { verifyBrowserVisibility };

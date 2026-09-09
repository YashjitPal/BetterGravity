// Fork Chat — Add first-class chat forking to Antigravity
//
// Allows users to fork conversations from any message turn or any sidebar thread
// into a new branch or workspace, matching Codex and Claude Code.

const FORK_ICON_SVG = '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M200-440q-17 0-28.5-11.5T160-480q0-17 11.5-28.5T200-520h264l200-200h-64q-17 0-28.5-11.5T560-760q0-17 11.5-28.5T600-800h160q17 0 28.5 11.5T800-760v160q0 17-11.5 28.5T760-560q-17 0-28.5-11.5T720-600v-64L519-463q-11 11-25.5 17t-30.5 6H200Zm400 280q-17 0-28.5-11.5T560-200q0-17 11.5-28.5T600-240h64l-99-98q-12-12-12-28.5t12-28.5q12-12 29-12t29 12l97 99v-64q0-17 11.5-28.5T760-400q17 0 28.5 11.5T800-360v160q0 17-11.5 28.5T760-160H600Z"/></svg>';
const WORKSPACE_ICON_SVG = '<svg viewBox="0 -960 960 960" fill="currentColor"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>';
const BRANCH_ICON_SVG = FORK_ICON_SVG;

/* ── Settings ────────────────────────────────────────────────────────────── */
const settings = plugin.settings.define({
  defaultTarget: {
    type: "select",
    label: "Default fork workspace",
    description: "Where newly forked conversations are created by default.",
    default: "1",
    options: [
      { value: "1", label: "Current workspace" },
      { value: "2", label: "Shared workspace (Git worktree)" }
    ]
  },
  allTurns: {
    type: "boolean",
    label: "Show fork button on every message",
    description: "Adds a fork button to every message turn in the conversation, not just the latest reply.",
    default: true
  },
  quickFork: {
    type: "boolean",
    label: "Quick fork on click",
    description: "Fork immediately into the default workspace when clicking the turn button without opening a dropdown.",
    default: false
  }
});

/* ── Native Flag Synchronization ─────────────────────────────────────────── */
function ensureNativeFlags() {
  try {
    const key = "jetski.developer.customFlagOverrides";
    let flags = {};
    const raw = window.localStorage.getItem(key);
    if (raw) {
      try {
        flags = JSON.parse(raw) || {};
      } catch {}
    }
    if (!flags["enable-conversation-forking"] || !flags["enable-fork-in-new-worktree"]) {
      flags["enable-conversation-forking"] = true;
      flags["enable-fork-in-new-worktree"] = true;
      const val = JSON.stringify(flags);
      window.localStorage.setItem(key, val);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: val,
          oldValue: raw,
          storageArea: window.localStorage
        })
      );
    }
  } catch {}
}

ensureNativeFlags();

/* ── React and Store Inspection ──────────────────────────────────────────── */
function getFiber(node) {
  if (!node) return null;
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber"));
  return key ? node[key] : null;
}

function findAgentService() {
  const anchors = [
    document.querySelector('[data-testid="conversation-view"]'),
    document.querySelector('[data-testid="conversation-row-sidebar"]'),
    document.querySelector('[data-testid="agent-input-box"]'),
    document.body
  ];

  for (const anchor of anchors) {
    if (!anchor) continue;
    let fiber = getFiber(anchor);
    for (let depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
      if (typeof fiber.memoizedProps?.agentService?.forkConversation === "function") {
        return fiber.memoizedProps.agentService;
      }
      if (typeof fiber.memoizedProps?.value?.agentService?.forkConversation === "function") {
        return fiber.memoizedProps.value.agentService;
      }
      let dep = fiber.dependencies?.firstContext;
      for (let i = 0; dep && i < 30; i += 1, dep = dep.next) {
        if (typeof dep.memoizedValue?.forkConversation === "function") {
          return dep.memoizedValue;
        }
        if (typeof dep.memoizedValue?.agentService?.forkConversation === "function") {
          return dep.memoizedValue.agentService;
        }
      }
    }
  }
  return null;
}

function findRouter() {
  const anchors = [
    document.querySelector('[data-testid="conversation-view"]'),
    document.body
  ];
  for (const anchor of anchors) {
    if (!anchor) continue;
    let fiber = getFiber(anchor);
    for (let depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
      if (typeof fiber.memoizedProps?.router?.navigate === "function") {
        return fiber.memoizedProps.router;
      }
      let dep = fiber.dependencies?.firstContext;
      for (let i = 0; dep && i < 30; i += 1, dep = dep.next) {
        if (typeof dep.memoizedValue?.navigate === "function" && dep.memoizedValue.parseLocation) {
          return dep.memoizedValue;
        }
      }
    }
  }
  return null;
}

function findStore() {
  const anchors = [
    document.querySelector('[data-testid="conversation-view"]'),
    document.querySelector('[data-testid="conversation-row-sidebar"]'),
    document.body
  ];
  for (const anchor of anchors) {
    if (!anchor) continue;
    let fiber = getFiber(anchor);
    for (let depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
      const store = fiber.memoizedProps?.store;
      if (typeof store?.getState === "function") return store;
      let dep = fiber.dependencies?.firstContext;
      for (let i = 0; dep && i < 30; i += 1, dep = dep.next) {
        const depStore = dep.memoizedValue?.store;
        if (typeof depStore?.getState === "function") return depStore;
      }
    }
  }
  return null;
}

function currentConversationId() {
  const view = document.querySelector('[data-testid="conversation-view"]');
  const id = view?.getAttribute("data-cascade-id") ?? "";
  if (id && id !== "conversation") return id;
  const match = typeof window !== "undefined" && window.location?.pathname ? window.location.pathname.match(/\/c\/([a-f0-9-]+)/i) : null;
  return match ? match[1] : "";
}

function isConversationBusy(conversationId) {
  const store = findStore();
  if (!store) return false;
  try {
    const state = store.getState();
    const summary = state?.trajectorySummaries?.summaries?.[conversationId];
    if (summary) {
      return (
        summary.notFullyIdle === true ||
        summary.hasActiveChildren === true ||
        summary.status === 2 ||
        summary.status === 3 ||
        summary.status === 4
      );
    }
  } catch {}
  return false;
}

function navigateToConversation(cascadeId) {
  const router = findRouter();
  if (router && typeof router.navigate === "function") {
    try {
      router.navigate({ to: `/c/${cascadeId}` });
      return true;
    } catch {}
  }

  // Fallback to finding the sidebar row anchor or history push
  const rowLink = document.querySelector(
    `[data-testid="conversation-row-sidebar"][data-cascade-id="${CSS.escape(cascadeId)}"] a[aria-label]`
  );
  if (rowLink instanceof HTMLElement) {
    rowLink.click();
    return true;
  }

  try {
    history.pushState(null, "", `/c/${cascadeId}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return true;
  } catch {}

  return false;
}

function getConversationTitle(cascadeId) {
  if (!cascadeId) return "";
  const store = findStore();
  try {
    const summary = store?.getState()?.trajectorySummaries?.summaries?.[cascadeId];
    if (summary?.summary) return summary.summary;
    if (summary?.title) return summary.title;
  } catch {}
  const row = document.querySelector(`[data-cascade-id="${CSS.escape(cascadeId)}"]`);
  const label = row?.querySelector("a[aria-label]")?.getAttribute("aria-label");
  if (label) return label;
  const all = collectAllConversations();
  const found = all.find((c) => c.id === cascadeId);
  if (found?.title) return found.title;
  return "";
}

/* ── Core Fork Execution ─────────────────────────────────────────────────── */
let activeForkPromise = null;

async function runFork(sourceCascadeId, forkAtStepIndex, targetForkWorkspace, title) {
  if (activeForkPromise) return;

  if (!sourceCascadeId) {
    plugin.ui.toast({
      title: "No conversation selected",
      body: "Could not identify a conversation to fork.",
      kind: "warning"
    });
    return;
  }

  if (isConversationBusy(sourceCascadeId)) {
    plugin.ui.toast({
      title: "Conversation is busy",
      body: "Cannot fork while this conversation is generating or running tasks. Please wait or stop it first.",
      kind: "warning",
      duration: 5000
    });
    return;
  }

  const agentService = findAgentService();
  if (!agentService || typeof agentService.forkConversation !== "function") {
    plugin.ui.toast({
      title: "Fork service unavailable",
      body: "The agent service is not ready. Please try again in a moment.",
      kind: "error"
    });
    return;
  }

  const target = Number(targetForkWorkspace) || Number(settings.defaultTarget) || 1;
  const targetLabel = target === 2 ? "shared workspace" : "current workspace";
  const stepLabel = forkAtStepIndex >= 0 ? ` at step #${forkAtStepIndex}` : "";

  const origTitle = title || getConversationTitle(sourceCascadeId) || "Conversation";
  const forkedTitle = origTitle.startsWith("Forked • ") ? origTitle : `Forked • ${origTitle}`;

  plugin.ui.toast({
    title: "Forking conversation...",
    body: origTitle ? `Forking "${origTitle}" into ${targetLabel}${stepLabel}...` : `Creating fork in ${targetLabel}...`,
    kind: "info",
    duration: 3500
  });

  const run = async () => {
    try {
      const response = await agentService.forkConversation({
        sourceCascadeId,
        forkAtStepIndex: Number(forkAtStepIndex) >= 0 ? Number(forkAtStepIndex) : -1,
        targetForkWorkspace: target
      });

      if (!response?.newCascadeId) {
        throw new Error("No conversation ID returned by the server.");
      }

      // Rename forked conversation to "Forked • " + original conversation name
      try {
        const store = findStore();
        if (store && typeof store.dispatch === "function") {
          store.dispatch({
            type: "updateOptimisticSummary",
            cascadeId: response.newCascadeId,
            optimisticSummaryText: forkedTitle
          });
        }
        if (typeof agentService.updateConversationAnnotations === "function") {
          await agentService.updateConversationAnnotations(
            response.newCascadeId,
            { title: forkedTitle },
            true
          );
        }
      } catch {}

      plugin.ui.toast({
        title: "Conversation forked!",
        body: "Switched to your new branch.",
        kind: "success",
        duration: 3000
      });

      navigateToConversation(response.newCascadeId);
    } catch (error) {
      plugin.ui.toast({
        title: "Failed to fork conversation",
        body: error?.message || String(error),
        kind: "error",
        duration: 6000
      });
    } finally {
      activeForkPromise = null;
    }
  };

  activeForkPromise = run();
  await activeForkPromise;
}

/* ── Popover for Turn-level Workspace Selection (Willow Parity) ──────────── */
let activePopover = null;
let popoverDismissHandlers = null;

function closeActivePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
  if (popoverDismissHandlers) {
    document.removeEventListener("pointerdown", popoverDismissHandlers.onPointerDown, true);
    document.removeEventListener("keydown", popoverDismissHandlers.onKeyDown, true);
    window.removeEventListener("resize", popoverDismissHandlers.onClose, true);
    window.removeEventListener("scroll", popoverDismissHandlers.onClose, true);
    popoverDismissHandlers = null;
  }
}

function openTurnForkPopover(button, cascadeId, stepIndex) {
  closeActivePopover();

  const popover = document.createElement("div");
  popover.className = "bettergravity-fork-popover";
  popover.setAttribute("role", "menu");

  const makeItem = (label, iconSvg, target) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.className = "bettergravity-fork-popover-item";
    item.innerHTML = `
      <span class="bettergravity-fork-popover-icon">${iconSvg}</span>
      <span class="bettergravity-fork-popover-label">${label}</span>
    `;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      closeActivePopover();
      void runFork(cascadeId, stepIndex, target);
    });
    return item;
  };

  popover.append(
    makeItem("Fork in current workspace", WORKSPACE_ICON_SVG, 1),
    makeItem("Fork in shared worktree", BRANCH_ICON_SVG, 2)
  );

  document.body.append(popover);
  activePopover = popover;

  const rect = button.getBoundingClientRect();
  const menuWidth = 224;
  const menuHeight = 88;
  const opensAbove = rect.bottom + menuHeight + 12 > window.innerHeight && rect.top > menuHeight + 12;

  let left = rect.left;
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, rect.right - menuWidth);
  }
  left = Math.min(Math.max(8, left), window.innerWidth - menuWidth - 8);

  if (opensAbove) {
    popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    popover.style.top = "auto";
    popover.classList.add("opens-above");
  } else {
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.bottom = "auto";
    popover.classList.add("opens-below");
  }
  popover.style.left = `${left}px`;

  popoverDismissHandlers = {
    onClose: () => closeActivePopover(),
    onPointerDown: (e) => {
      if (activePopover?.contains(e.target) || button.contains(e.target)) return;
      closeActivePopover();
    },
    onKeyDown: (e) => {
      if (e.key === "Escape") closeActivePopover();
    }
  };

  setTimeout(() => {
    if (!popoverDismissHandlers) return;
    document.addEventListener("pointerdown", popoverDismissHandlers.onPointerDown, true);
    document.addEventListener("keydown", popoverDismissHandlers.onKeyDown, true);
    window.addEventListener("resize", popoverDismissHandlers.onClose, true);
    window.addEventListener("scroll", popoverDismissHandlers.onClose, true);
  }, 0);
}

/* ── Step Index Extraction Helpers ───────────────────────────────────────── */
function stepIndexFromFiber(bar) {
  let fiber = getFiber(bar);
  while (fiber) {
    if (Array.isArray(fiber.memoizedProps?.steps)) {
      const steps = fiber.memoizedProps.steps;
      for (let i = steps.length - 1; i >= 0; i -= 1) {
        const index = steps[i]?.metadata?.sourceTrajectoryStepInfo?.stepIndex;
        if (typeof index === "number" && index >= 0) return index;
      }
    }
    fiber = fiber.return;
  }
  return -1;
}

function getStepIndexForUserStep(stepEl) {
  if (!stepEl) return -1;
  let fiber = getFiber(stepEl);

  let userStep = null;
  let userStepIndex = -1;
  let trajectorySteps = null;

  while (fiber) {
    if (fiber.memoizedProps?.userStep && !userStep) {
      userStep = fiber.memoizedProps.userStep;
      if (typeof fiber.memoizedProps.userStepIndex === "number") {
        userStepIndex = fiber.memoizedProps.userStepIndex;
      }
    }
    if (Array.isArray(fiber.memoizedProps?.trajectorySteps) && !trajectorySteps) {
      trajectorySteps = fiber.memoizedProps.trajectorySteps;
    }
    fiber = fiber.return;
  }

  if (userStep && trajectorySteps) {
    for (let i = 0; i < trajectorySteps.length; i += 1) {
      const s = trajectorySteps[i];
      if (s === userStep || s.step === userStep.step) {
        const idx = s.metadata?.sourceTrajectoryStepInfo?.stepIndex;
        return typeof idx === "number" ? idx : i;
      }
    }
  }

  if (userStepIndex >= 0) {
    return userStepIndex;
  }

  return -1;
}

/* ── UI Element Decorators ───────────────────────────────────────────────── */
function decorateTitlebar() {
  const moreActions = document.querySelector('[data-testid="titlebar-more-actions"]');
  if (!moreActions) return;

  const container = moreActions.parentElement;
  if (!container || container.querySelector("button[data-fork-titlebar-btn]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-fork-titlebar-btn", "true");
  button.className = "bettergravity-fork-titlebar-btn " + (moreActions.className || "");
  button.setAttribute("aria-label", "Fork conversation");
  button.title = "Fork conversation";
  button.innerHTML = `<span class="relative flex items-center justify-center" style="width: 18px; height: 18px;"><span class="absolute inset-0 flex items-center justify-center">${FORK_ICON_SVG}</span></span>`;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const cascadeId = currentConversationId();
    if (!cascadeId) return;

    openTurnForkPopover(button, cascadeId, -1);
  });

  container.insertBefore(button, moreActions);
}

function scanUserSteps(view) {
  if (!view) return;
  const userSteps = view.querySelectorAll('[data-testid="user-input-step"]');
  for (let i = 0; i < userSteps.length; i += 1) {
    const stepEl = userSteps[i];
    const container = stepEl.querySelector(".user-input-buttons-container");
    if (!container) continue;

    const existing = container.querySelectorAll("button[data-fork-chat-btn]");
    if (existing.length > 0) {
      for (let j = 1; j < existing.length; j += 1) existing[j].remove();
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-fork-chat-btn", "true");
    button.setAttribute("aria-label", "Fork from this message");
    button.title = "Fork conversation from this message";
    button.className = "text-muted-foreground hover:text-secondary-foreground transition-opacity pointer-events-auto p-1 cursor-pointer bettergravity-fork-turn-btn";
    button.innerHTML = FORK_ICON_SVG;

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const cascadeId = currentConversationId();
      if (!cascadeId) return;

      const stepIndex = getStepIndexForUserStep(stepEl);
      openTurnForkPopover(button, cascadeId, stepIndex);
    });

    const revertBtn = container.querySelector('[data-testid="revert-button"]');
    if (revertBtn) {
      container.insertBefore(button, revertBtn);
    } else {
      container.append(button);
    }
  }
}

function decorateTurnBar(bar) {
  if (!bar || bar.nodeType !== Node.ELEMENT_NODE) return;

  // Ensure turn action attribute is set so flexbox ordering (Like:1, Dislike:2, Copy:3, Fork:4) is active
  if (bar.getAttribute("data-gemini-turn-actions") !== "true") {
    bar.setAttribute("data-gemini-turn-actions", "true");
  }

  // Hide any native Antigravity fork button so only ONE fork button is visible under messages
  const nativeForks = bar.querySelectorAll(
    'button:is([aria-label="Fork Conversation"], [aria-label*="Fork"]):not([data-fork-chat-btn])'
  );
  for (let i = 0; i < nativeForks.length; i += 1) {
    nativeForks[i].style.display = "none";
    nativeForks[i].setAttribute("data-fork-hidden", "true");
  }

  // Ensure only at most ONE of our fork buttons exists
  const existingBtns = bar.querySelectorAll("button[data-fork-chat-btn]");
  if (existingBtns.length > 0) {
    for (let i = 1; i < existingBtns.length; i += 1) {
      existingBtns[i].remove();
    }
    return;
  }

  // Target the buttons container: flex min-w-0 row, or copy wrapper
  const container =
    bar.querySelector(".flex.min-w-0.flex-wrap-reverse") ||
    bar.querySelector(".flex.min-w-0") ||
    bar.querySelector(".flex.shrink-0.items-end") ||
    bar;

  if (container.querySelector("button[data-fork-chat-btn]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "bettergravity-fork-turn-btn";
  button.setAttribute("data-fork-chat-btn", "true");
  button.setAttribute("aria-label", "Fork from this message");
  button.title = "Fork conversation from this message";
  button.innerHTML = FORK_ICON_SVG;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const cascadeId = currentConversationId();
    if (!cascadeId) return;

    const stepIndex = stepIndexFromFiber(bar);
    openTurnForkPopover(button, cascadeId, stepIndex);
  });

  // Always append at the end so it renders after Copy and Like/Dislike
  container.append(button);
}

function removeTopBarIndicator(view) {
  const root = view || document;
  const banners = root.querySelectorAll(
    'div[title="Open side-by-side view"], div.w-full.bg-background.border-b.border-border'
  );
  for (let i = 0; i < banners.length; i += 1) {
    const b = banners[i];
    if (b.getAttribute("title") === "Open side-by-side view" || b.querySelector("span.select-none, [name='fork_left']")) {
      b.style.display = "none";
    }
  }
}

function scanAssistantTurns(view) {
  if (!view) return;

  // Hide any native fork buttons anywhere in view
  const nativeForks = view.querySelectorAll(
    'button:is([aria-label="Fork Conversation"], [aria-label*="Fork"]):not([data-fork-chat-btn]):not([data-fork-titlebar-btn])'
  );
  for (let i = 0; i < nativeForks.length; i += 1) {
    nativeForks[i].style.display = "none";
    nativeForks[i].setAttribute("data-fork-hidden", "true");
  }

  // 1. Direct scan across all feedback and copy buttons to reliably find every turn,
  // including in previous/past conversations regardless of utility class variations
  const actionBtns = view.querySelectorAll(
    'button:is([aria-label="Copy"], [aria-label="Copied"], [aria-label="Good response"], [aria-label="Bad response"])'
  );
  for (let i = 0; i < actionBtns.length; i += 1) {
    const btn = actionBtns[i];
    if (btn.closest('[data-testid="user-input-step"]') || btn.closest('.code-block') || btn.closest('pre')) {
      continue;
    }
    const bar = btn.closest('.flex.w-full.items-start') || btn.closest('.flex.min-w-0')?.parentElement;
    if (bar) {
      decorateTurnBar(bar);
    }
  }

  // 2. Structural scan across all message action bar containers
  const selector = ".flex.w-full.items-start, [data-gemini-turn-actions='true']";
  const bars = view.querySelectorAll(selector);
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    if (bar.closest('[data-testid="user-input-step"]')) continue;
    decorateTurnBar(bar);
  }

  // 3. Scan across all agent response articles
  const articles = view.querySelectorAll('[role="article"][aria-label="Agent response"], [role="article"]:not([aria-label="User message"])');
  for (let i = 0; i < articles.length; i += 1) {
    const art = articles[i];
    if (art.closest('[data-testid="user-input-step"]')) continue;
    const bar = art.querySelector('.flex.w-full.items-start') || art.parentElement?.querySelector('.flex.w-full.items-start');
    if (bar) {
      decorateTurnBar(bar);
    }
  }
}

function scanAll() {
  decorateTitlebar();
  const view = document.querySelector('[data-testid="conversation-view"]');
  if (view) {
    removeTopBarIndicator(view);
    scanUserSteps(view);
    scanAssistantTurns(view);
  }
}

/* ── Observers and SPA Navigation Lifecycle ──────────────────────────────── */
let bodyObserver = null;
let lastObservedUrl = typeof window !== "undefined" ? window.location?.href || "" : "";

function setupObservers() {
  let scheduled = false;
  const scheduleScan = () => {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        scheduled = false;
        scanAll();
      });
    } else {
      scheduled = false;
      scanAll();
    }
  };

  const bindScroller = () => {
    const view = document.querySelector('[data-testid="conversation-view"]');
    const scroller = view?.querySelector('.overflow-y-auto') || view;
    if (scroller && !scroller.dataset?.hasForkScroll) {
      scroller.dataset.hasForkScroll = "true";
      scroller.addEventListener("scroll", scheduleScan, { passive: true });
    }
  };

  const scheduleRetries = () => {
    scheduleScan();
    bindScroller();
    // Past conversations load turns asynchronously over 100-3000ms
    setTimeout(() => { scheduleScan(); bindScroller(); }, 100);
    setTimeout(() => { scheduleScan(); bindScroller(); }, 300);
    setTimeout(() => { scheduleScan(); bindScroller(); }, 600);
    setTimeout(() => { scheduleScan(); bindScroller(); }, 1000);
    setTimeout(() => { scheduleScan(); bindScroller(); }, 1600);
    setTimeout(() => { scheduleScan(); bindScroller(); }, 2500);
  };

  const onNavChange = () => {
    const currentUrl = typeof window !== "undefined" ? window.location?.href || "" : "";
    if (currentUrl !== lastObservedUrl) {
      lastObservedUrl = currentUrl;
      scheduleRetries();
    }
  };

  // Intercept HTML5 History pushState and replaceState used by Antigravity's router
  let origPushState = null;
  let origReplaceState = null;
  if (typeof window !== "undefined" && window.history) {
    origPushState = window.history.pushState;
    if (typeof origPushState === "function") {
      window.history.pushState = function (...args) {
        const res = origPushState.apply(this, args);
        onNavChange();
        return res;
      };
    }
    origReplaceState = window.history.replaceState;
    if (typeof origReplaceState === "function") {
      window.history.replaceState = function (...args) {
        const res = origReplaceState.apply(this, args);
        onNavChange();
        return res;
      };
    }
  }

  bodyObserver = new MutationObserver((records) => {
    // Immediately hide native Antigravity fork buttons synchronously before next paint
    for (let i = 0; i < records.length; i += 1) {
      const added = records[i].addedNodes;
      for (let j = 0; j < added.length; j += 1) {
        const node = added[j];
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches && node.matches('button:is([aria-label="Fork Conversation"], [aria-label*="Fork"]):not([data-fork-chat-btn]):not([data-fork-titlebar-btn])')) {
            node.style.display = "none";
            node.setAttribute("data-fork-hidden", "true");
          } else if (node.querySelectorAll) {
            const natives = node.querySelectorAll('button:is([aria-label="Fork Conversation"], [aria-label*="Fork"]):not([data-fork-chat-btn]):not([data-fork-titlebar-btn])');
            for (let k = 0; k < natives.length; k += 1) {
              natives[k].style.display = "none";
              natives[k].setAttribute("data-fork-hidden", "true");
            }
          }
        }
      }
    }

    const currentUrl = typeof window !== "undefined" ? window.location?.href || "" : "";
    if (currentUrl && currentUrl !== lastObservedUrl) {
      lastObservedUrl = currentUrl;
      scheduleRetries();
      return;
    }

    scheduleScan();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  if (typeof window !== "undefined") {
    window.addEventListener("popstate", onNavChange);
    window.addEventListener("hashchange", onNavChange);
  }

  // Periodic safety check to guarantee asynchronous past turns and scroller are decorated
  const periodicCheck = setInterval(() => {
    const view = document.querySelector('[data-testid="conversation-view"]');
    if (!view) return;
    bindScroller();
    const hasNative = view.querySelector('button:is([aria-label="Fork Conversation"], [aria-label*="Fork"]):not([data-fork-chat-btn]):not([data-fork-titlebar-btn])');
    let needsScan = hasNative !== null;
    if (!needsScan) {
      const actionBars = view.querySelectorAll('.flex.w-full.items-start');
      for (let i = 0; i < actionBars.length; i += 1) {
        if (!actionBars[i].closest('[data-testid="user-input-step"]') && !actionBars[i].querySelector('button[data-fork-chat-btn]')) {
          needsScan = true;
          break;
        }
      }
    }
    if (needsScan) {
      scheduleScan();
    }
  }, 600);

  // Synchronous initial scan + retry schedule
  scanAll();
  bindScroller();
  scheduleRetries();

  plugin.onDispose(() => {
    bodyObserver?.disconnect();
    clearInterval(periodicCheck);
    if (typeof window !== "undefined" && window.history) {
      if (origPushState) window.history.pushState = origPushState;
      if (origReplaceState) window.history.replaceState = origReplaceState;
      window.removeEventListener("popstate", onNavChange);
      window.removeEventListener("hashchange", onNavChange);
    }
    closeActivePopover();
    document.querySelectorAll("button[data-fork-chat-btn], button[data-fork-titlebar-btn]").forEach((b) => b.remove());
  });
}

setupObservers();

/* ── Context Menu Contributor ────────────────────────────────────────────── */
plugin.ui.contextMenu((menu) => {
  if (!menu.has("conversation-rename-menu-item") && !menu.has("conversation-delete-menu-item")) {
    return undefined;
  }

  const row =
    menu.trigger?.closest('[data-cascade-id]') ||
    menu.trigger?.closest('[data-testid="conversation-row-sidebar"]');
  const cascadeId = row?.getAttribute("data-cascade-id") || "";
  if (!cascadeId) return undefined;

  const labelSpan = row?.querySelector("a[aria-label]");
  const title = labelSpan?.getAttribute("aria-label") || "this conversation";

  return [
    {
      label: "Fork conversation",
      icon: FORK_ICON_SVG,
      onSelect: () => {
        void runFork(cascadeId, -1, Number(settings.defaultTarget) || 1, title);
      }
    }
  ];
});

/* ── Global "Fork Any Chat" Modal ────────────────────────────────────────── */
function collectAllConversations() {
  const conversations = [];
  const seenIds = new Set();
  const store = findStore();

  if (store) {
    try {
      const state = store.getState();
      const summaries = state?.trajectorySummaries?.summaries || {};

      for (const [id, s] of Object.entries(summaries)) {
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);

        let updatedAtMs = 0;
        if (s?.lastModifiedTime?.seconds) {
          updatedAtMs = Number(s.lastModifiedTime.seconds) * 1000;
        } else if (s?.updatedAtMs) {
          updatedAtMs = Number(s.updatedAtMs);
        }

        const title = s?.summary || s?.title || "Untitled conversation";
        const stepCount = typeof s?.stepCount === "number" ? s.stepCount : 0;

        conversations.push({
          id,
          title,
          updatedAt: updatedAtMs,
          stepCount
        });
      }
    } catch {}
  }

  // Also harvest from rendered sidebar rows if any aren't in summaries
  for (const row of document.querySelectorAll('[data-testid="conversation-row-sidebar"]')) {
    const id = row.getAttribute("data-cascade-id");
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const title =
      row.querySelector("a[aria-label]")?.getAttribute("aria-label") ||
      row.querySelector("span.truncate")?.textContent?.trim() ||
      "Conversation";
    conversations.push({
      id,
      title,
      updatedAt: 0,
      stepCount: 0
    });
  }

  conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  return conversations;
}

let activeModal = null;

function openForkModal() {
  activeModal?.close();

  const currentId = currentConversationId();
  const allConversations = collectAllConversations();
  let selectedId = currentId || allConversations[0]?.id || "";
  let selectedTarget = Number(settings.defaultTarget) || 1;
  const forkAtTurn = -1; // -1 = latest

  activeModal = plugin.ui.modal({
    title: "Fork Conversation",
    description: "Branch any conversation from your history into an isolated workspace or current project.",
    width: 520,
    render(body, close) {
      const root = document.createElement("div");
      root.className = "bettergravity-fork-modal";

      // Current selection banner
      const banner = document.createElement("div");
      banner.className = "bettergravity-fork-modal__banner";
      const bannerTitle = document.createElement("span");
      bannerTitle.className = "bettergravity-fork-modal__banner-title";
      const bannerSub = document.createElement("span");
      bannerSub.className = "bettergravity-fork-modal__banner-sub";
      banner.append(bannerTitle, bannerSub);

      const updateBanner = () => {
        const item = allConversations.find((c) => c.id === selectedId);
        const name = item ? item.title : (selectedId ? `Thread ${selectedId.slice(0, 8)}` : "None");
        bannerTitle.textContent = `Selected: ${name}`;
        bannerSub.textContent = selectedId === currentId ? "Active conversation on screen" : `ID: ${selectedId}`;
      };
      updateBanner();

      // Search and list section
      const listSection = document.createElement("div");
      listSection.className = "bettergravity-fork-modal__section";
      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.className = "bettergravity-fork-modal__search";
      searchInput.placeholder = allConversations.length > 0
        ? `Search all ${allConversations.length} conversations...`
        : "Search conversations to fork...";

      const list = document.createElement("div");
      list.className = "bettergravity-fork-modal__list";

      const renderList = (filter = "") => {
        list.replaceChildren();
        const term = filter.toLowerCase().trim();
        const filtered = allConversations.filter(
          (c) => !term || c.title.toLowerCase().includes(term) || c.id.includes(term)
        );

        if (filtered.length === 0) {
          const empty = document.createElement("div");
          empty.style.padding = "16px";
          empty.style.textAlign = "center";
          empty.style.color = "var(--muted-foreground, #94a3b8)";
          empty.textContent = "No matching conversations found.";
          list.append(empty);
          return;
        }

        for (const conv of filtered) {
          const item = document.createElement("button");
          item.type = "button";
          item.className = `bettergravity-fork-modal__item ${conv.id === selectedId ? "is-selected" : ""}`;

          const title = document.createElement("span");
          title.className = "bettergravity-fork-modal__item-title";
          title.textContent = conv.title;

          const meta = document.createElement("span");
          meta.className = "bettergravity-fork-modal__item-meta";
          const stepText = conv.stepCount > 0 ? ` · ${conv.stepCount} steps` : "";
          meta.textContent = (conv.id === currentId ? "Current" : conv.id.slice(0, 8)) + stepText;

          item.append(title, meta);
          item.addEventListener("click", () => {
            selectedId = conv.id;
            updateBanner();
            renderList(searchInput.value);
          });
          list.append(item);
        }
      };

      searchInput.addEventListener("input", () => renderList(searchInput.value));
      renderList();
      listSection.append(searchInput, list);

      // Target workspace chips
      const targetSection = document.createElement("div");
      targetSection.className = "bettergravity-fork-modal__section";
      const targetLabel = document.createElement("span");
      targetLabel.className = "bettergravity-fork-modal__label";
      targetLabel.textContent = "Destination Workspace";

      const chips = document.createElement("div");
      chips.className = "bettergravity-fork-modal__chips";

      const currentChip = document.createElement("button");
      currentChip.type = "button";
      currentChip.className = `bettergravity-fork-modal__chip ${selectedTarget === 1 ? "is-active" : ""}`;
      currentChip.innerHTML = `<span class="bettergravity-fork-modal__chip-title">Current Workspace</span><span class="bettergravity-fork-modal__chip-desc">Continues inside the current folder</span>`;

      const worktreeChip = document.createElement("button");
      worktreeChip.type = "button";
      worktreeChip.className = `bettergravity-fork-modal__chip ${selectedTarget === 2 ? "is-active" : ""}`;
      worktreeChip.innerHTML = `<span class="bettergravity-fork-modal__chip-title">Shared Worktree</span><span class="bettergravity-fork-modal__chip-desc">Creates an isolated git branch and worktree</span>`;

      currentChip.addEventListener("click", () => {
        selectedTarget = 1;
        currentChip.classList.add("is-active");
        worktreeChip.classList.remove("is-active");
      });

      worktreeChip.addEventListener("click", () => {
        selectedTarget = 2;
        worktreeChip.classList.add("is-active");
        currentChip.classList.remove("is-active");
      });

      chips.append(currentChip, worktreeChip);
      targetSection.append(targetLabel, chips);

      // Actions footer
      const actions = document.createElement("div");
      actions.className = "bettergravity-fork-modal__actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "bettergravity-fork-modal__btn bettergravity-fork-modal__btn--secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => close());

      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "bettergravity-fork-modal__btn bettergravity-fork-modal__btn--primary";
      submitBtn.textContent = "Fork Chat";

      submitBtn.addEventListener("click", async () => {
        if (!selectedId) return;
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        submitBtn.innerHTML = '<span class="bettergravity-fork-modal__spinner"></span><span>Forking...</span>';
        try {
          const selectedConv = allConversations.find((c) => c.id === selectedId);
          await runFork(selectedId, forkAtTurn, selectedTarget, selectedConv?.title);
          close();
        } finally {
          submitBtn.disabled = false;
          cancelBtn.disabled = false;
          submitBtn.textContent = "Fork Chat";
        }
      });

      actions.append(cancelBtn, submitBtn);

      root.append(banner, listSection, targetSection, actions);
      body.append(root);
    },
    onClose() {
      activeModal = null;
    }
  });
}

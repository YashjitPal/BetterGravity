// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const source = readFileSync("community/plugins/in-built-browser/index.js", "utf8");
const disposers: (() => void)[] = [];
const taskListeners = new Set<() => void>();
type Generation = { conversationId: string; status: number; fullyIdle: boolean };
const generations = new Map<string, { state: Generation; listeners: Set<() => void>; provider: { getState: () => Generation; onDidChange: (listener: () => void) => { dispose: () => void } } }>();
let summary: { status: number; notFullyIdle: boolean; hasActiveChildren: boolean; waitingSteps: unknown[] };
let useStore: boolean;
let useProvider: boolean;
let useOptimistic: boolean;
const optimisticListeners = new Set<() => void>();
const trueListeners = new Set<() => void>();
let optimisticResponse: { agentState?: Generation } | undefined;
let trueResponse: { agentState?: Generation };
let displayedContext: string;
let emit: (patch: Record<string, unknown>) => void;
let request: ReturnType<typeof vi.fn>;

const node = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
const cursor = () => node("browser-agent-cursor-overlay");
const glow = () => node("browser-agent-border");
const dock = () => node("browser-agent-dock");
const control = () => node("browser-agent-control");

function setTask(status: number) {
  summary = { status, notFullyIdle: status === 2, hasActiveChildren: false, waitingSteps: [] };
  for (const listener of [...taskListeners]) listener();
}

function generation(id = displayedContext) {
  let entry = generations.get(id);
  if (!entry) {
    const listeners = new Set<() => void>();
    entry = {
      state: { conversationId: id, status: 1, fullyIdle: true }, listeners,
      provider: {
        getState: () => generations.get(id)!.state,
        onDidChange: listener => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; }
      }
    };
    generations.set(id, entry);
  }
  return entry;
}

function setGeneration(status: number, id = displayedContext, fullyIdle = status === 1) {
  const entry = generation(id);
  entry.state = { conversationId: id, status, fullyIdle };
  for (const listener of [...entry.listeners]) listener();
}

async function start() {
  let state = {
    context: "task-a", browserId: "browser-a", enabled: true, visible: true, paused: false,
    supportsAgentCursor: true, supportsCompositing: true, activity: null,
    activeTabId: "tab-a", tabs: [{ id: "tab-a", url: "http://localhost/fixture", title: "Fixture" }],
    annotations: [], agentCursor: { tabId: "tab-a", x: 80, y: 90, viewportWidth: 600, viewportHeight: 500, sequence: 1, animateMovement: false }
  } as Record<string, unknown>;
  let onState = (_next: Record<string, unknown>) => {};
  emit = patch => { state = { ...state, ...patch }; onState(state); };
  request = vi.fn(async (action: string) => {
    if (action === "pause" || action === "resume") emit({ paused: action === "pause" });
    return state;
  });
  const store = {
    getState: () => ({
      conversation: { convoState: { type: "active", cascadeId: displayedContext } },
      trajectorySummaries: { summaries: { "task-a": summary, "another-task": { status: 2, notFullyIdle: true }, ...(displayedContext !== "task-a" ? { [displayedContext]: summary } : {}) } }
    }),
    subscribe: (listener: () => void) => { taskListeners.add(listener); return () => taskListeners.delete(listener); }
  };
  const manager = {
    getAgentStates: () => new Map([...generations].map(([id, entry]) => [id, { provider: entry.provider }])),
    peek: (id: string) => generations.get(id)?.provider
  };
  const optimisticEntry = {
    optimisticState: { getState: () => optimisticResponse, onDidChange: (listener: () => void) => { optimisticListeners.add(listener); return { dispose: () => optimisticListeners.delete(listener) }; } },
    trueState: { getState: () => trueResponse, onDidChange: (listener: () => void) => { trueListeners.add(listener); return { dispose: () => trueListeners.delete(listener) }; } }
  };
  const registry = { peek: () => optimisticEntry, listen: (_id: string, listener: () => void) => { listener(); return () => {}; } };
  if (useProvider) generation();
  const plugin = {
    settings: { define: () => ({ sharedTabsAcrossConversations: true }) },
    dom: { observe: (selector: string, callback: (element: Element) => void) => { document.querySelectorAll(selector).forEach(callback); } },
    react: { getFiber: (anchor: Element) => {
      const parent = { dependencies: { firstContext: { memoizedValue: useStore ? { store } : {}, next: { memoizedValue: useProvider ? manager : {}, next: useOptimistic ? { memoizedValue: { registry } } : null } } } };
      // In the real host, the conversation's Redux provider is closer than its
      // live response provider, which is read by the composer below it.
      return useProvider && anchor === node("agent-input-box") ? {
        memoizedProps: { cascadeId: displayedContext },
        dependencies: { firstContext: { memoizedValue: { cascadeContext: { state: { agentStateProvider: generation().provider } } } } },
        return: parent
      } : parent;
    } },
    browser: { available: true, request, setBounds: vi.fn(), onStateChanged: (listener: typeof onState) => { onState = listener; } },
    patcher: { after: () => () => {} },
    onDispose: (dispose: () => void) => disposers.push(dispose)
  };
  new Function("plugin", source)(plugin);
  await vi.advanceTimersByTimeAsync(50);
}

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, "", "/c/task-a");
  document.body.innerHTML = '<main data-testid="conversation-view"><div data-testid="agent-input-box"></div></main><aside data-aux-pane-open="true"><header data-active-tab-id="overview"><button data-tab-id="terminal">Terminal</button></header><div class="content"></div></aside>';
  useStore = true;
  useProvider = false; displayedContext = "task-a"; generations.clear();
  useOptimistic = false; optimisticResponse = undefined; trueResponse = { agentState: { conversationId: "task-a", status: 1, fullyIdle: true } };
  summary = { status: 1, notFullyIdle: false, hasActiveChildren: false, waitingSteps: [] };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  expect(taskListeners.size).toBe(0);
  for (const entry of generations.values()) expect(entry.listeners.size).toBe(0);
  expect(optimisticListeners.size).toBe(0); expect(trueListeners.size).toBe(0);
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("holds the cursor through long tool gaps, then finishes on the current task's store update", async () => {
  await start();
  setTask(2); emit({ activity: "Click" });
  await vi.advanceTimersByTimeAsync(50);
  emit({ activity: null });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
  setTask(1);
  expect(cursor().hidden).toBe(false); expect(glow().hidden).toBe(false); expect(dock().hidden).toBe(false);
  expect(cursor().dataset.visible).toBeUndefined();
  expect(glow().dataset.visible).toBeUndefined();
  expect(node("in-built-browser-viewport").hasAttribute("data-agent-control")).toBe(false);
  await vi.advanceTimersByTimeAsync(350);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(1100);
  expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
  // Another conversation is still running, and starting a new task here is
  // insufficient to restore the previous task's browser cursor.
  setTask(2); await vi.advanceTimersByTimeAsync(2000);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
  emit({ activity: "Click again" }); await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(false);
});

it("ends the indicators on cancellation without requiring another browser state event", async () => {
  await start(); setTask(2); emit({ activity: "Move" }); emit({ activity: null });
  setTask(3); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
});

it("uses the native Stop control when no supported task store is available", async () => {
  useStore = false; await start();
  const stop = document.createElement("button"); stop.dataset.tooltipId = "input-send-button-cancel-tooltip";
  node("agent-input-box").append(stop); await vi.advanceTimersByTimeAsync(50);
  emit({ activity: "Move" }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(10_000); expect(cursor().hidden).toBe(false);
  stop.remove(); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
});

it("does not keep control forever when tools run without a host task", async () => {
  await start(); emit({ activity: "External action" });
  expect(cursor().hidden).toBe(false);
  emit({ activity: null }); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
});

it("takes over and resumes through the floating control without forwarding its pointer to the page", async () => {
  await start(); setTask(2); emit({ activity: "Move" }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(50);
  request.mockClear();
  control().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  control().dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  control().click(); await vi.advanceTimersByTimeAsync(1100);
  expect(request.mock.calls.map(call => call[0])).not.toContain("input");
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
  expect(dock().hidden).toBe(false); expect(control().textContent).toBe("Resume");
  control().click(); await vi.advanceTimersByTimeAsync(1100);
  expect(dock().hidden).toBe(false); expect(cursor().hidden).toBe(false);
  expect(node("in-built-browser-viewport").hasAttribute("data-agent-control")).toBe(true);
  setTask(1); await vi.advanceTimersByTimeAsync(1100);
  expect(dock().hidden).toBe(true); expect(cursor().hidden).toBe(true);
});

it("clears effects immediately when the pane closes or the plugin disables", async () => {
  await start(); setTask(2); emit({ activity: "Move" }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(50);
  document.querySelector<HTMLElement>("[data-aux-pane-open]")!.dataset.auxPaneOpen = "false";
  await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
  document.querySelector<HTMLElement>("[data-aux-pane-open]")!.dataset.auxPaneOpen = "true";
  await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(false); expect(node("in-built-browser-viewport").hasAttribute("data-agent-control")).toBe(true);
  emit({ activity: "Move" }); await vi.advanceTimersByTimeAsync(50);
  emit({ enabled: false, activity: null });
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
});

it("holds one browser session for the displayed response even when the address bar and list summary are stale", async () => {
  displayedContext = "displayed-task"; useProvider = true;
  setGeneration(2);
  await start();
  expect(cursor().hidden).toBe(true);
  emit({ activity: "Click", revealSequence: 1 });
  await vi.advanceTimersByTimeAsync(50);
  emit({ activity: null });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true"); expect(dock().hidden).toBe(false);
  for (let call = 2; call <= 4; call++) {
    emit({ activity: "Read the page", revealSequence: call }); emit({ activity: null });
    await vi.advanceTimersByTimeAsync(3000);
    expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
  }
  // List summaries and background work must not extend a finished response.
  setTask(2); setGeneration(1, displayedContext, false);
  await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
  setGeneration(2); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true);
});

it("starts the response session with a metadata tool even when that tool has no activity payload", async () => {
  useProvider = true; setGeneration(2); await start();
  emit({ revealSequence: 1 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
  control().click(); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(control().textContent).toBe("Resume");
  emit({ revealSequence: 2 }); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true);
  control().click(); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(false);
  emit({ revealSequence: 3 }); await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(false);
  setGeneration(3); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
});

it("rebinds to the new response when the displayed conversation changes without changing the URL", async () => {
  useProvider = true; setGeneration(2); await start();
  emit({ activity: "Click" }); emit({ activity: null });
  displayedContext = "second-displayed-task"; setGeneration(2); setTask(1);
  await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true);
  emit({ activity: "Move" }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(3000);
  setGeneration(1, "task-a");
  expect(cursor().hidden).toBe(false); expect(generation("task-a").listeners.size).toBe(0);
  setGeneration(1); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
});

it("ends a cancelled response even if its last browser operation has not returned yet", async () => {
  useProvider = true; setGeneration(2); await start();
  emit({ activity: "Waiting for the page", revealSequence: 1 });
  await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(false);
  setGeneration(3); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
  // Completing one of several concurrent tools can reveal an older activity
  // label. That is not a new tool call and must not revive the ended response.
  emit({ activity: "Earlier operation still returning" }); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
  emit({ activity: null }); setGeneration(2);
  await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true);
});

it("keeps the same session while the page navigates through a blank or loading tab", async () => {
  useProvider = true; setGeneration(2); await start();
  emit({ revealSequence: 1, activity: "Navigate" }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(50);
  emit({ tabs: [{ id: "tab-a", url: "about:blank", loading: true, title: "Loading" }] });
  await vi.advanceTimersByTimeAsync(3000);
  expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
  emit({ tabs: [{ id: "tab-a", url: "http://localhost/next", title: "Next" }] });
  await vi.advanceTimersByTimeAsync(3000);
  expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
  setGeneration(1); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
});

it("retains the first tool's response session while the closed sidebar remounts", async () => {
  useProvider = true; setGeneration(2); await start();
  const pane = document.querySelector("aside")!;
  pane.remove(); await vi.advanceTimersByTimeAsync(50);
  expect(document.querySelector("#bg-in-built-browser")).toBeNull();
  emit({ activity: "Open and inspect", revealSequence: 1 });
  document.body.append(pane); await vi.advanceTimersByTimeAsync(50);
  emit({ activity: null }); await vi.advanceTimersByTimeAsync(10_000);
  expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
  setGeneration(1); await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
});

it("follows the composer's effective response when the raw provider remains running", async () => {
  useProvider = useOptimistic = true; setGeneration(2);
  trueResponse = { agentState: generation().state };
  await start();
  emit({ activity: "Click", agentActivity: { sequence: 1, tabIds: ["tab-a"] } }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(50); expect(cursor().hidden).toBe(false);
  optimisticResponse = { agentState: { conversationId: displayedContext, status: 1, fullyIdle: true } };
  for (const listener of [...optimisticListeners]) listener();
  await vi.advanceTimersByTimeAsync(1100);
  expect(generation().state.status).toBe(2);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
  expect(request.mock.calls).toContainEqual(["response-state", expect.objectContaining({ responseId: null })]);
  // An optimistic wrapper with no agentState delegates to trueState.
  optimisticResponse = {};
  trueResponse = { agentState: { conversationId: displayedContext, status: 1, fullyIdle: true } };
  for (const listener of [...optimisticListeners, ...trueListeners]) listener();
  await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(true);
});

it("keeps cursor, glow and handoff on only the tabs used in this response", async () => {
  useProvider = true; setGeneration(2); await start();
  const tabs = ["a", "b", "c"].map(id => ({ id: `tab-${id}`, url: `http://localhost/${id}`, title: id }));
  emit({ tabs, activity: "Click A", agentActivity: { sequence: 1, tabIds: ["tab-a"] } }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(50); expect(cursor().hidden).toBe(false);
  emit({ activeTabId: "tab-b" });
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
  emit({ activity: "Read A", agentActivity: { sequence: 2, tabIds: ["tab-a"] } }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(5000);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
  emit({ activity: "Click C", agentActivity: { sequence: 3, tabIds: ["tab-c"] }, agentCursor: { tabId: "tab-c", x: 120, y: 100, viewportWidth: 600, viewportHeight: 500, sequence: 3, animateMovement: false } }); emit({ activity: null });
  emit({ activeTabId: "tab-c" }); await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
  emit({ activeTabId: "tab-a" }); await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(false); expect(dock().hidden).toBe(false);
  control().click(); await vi.advanceTimersByTimeAsync(1100);
  expect(control().textContent).toBe("Resume");
  emit({ activeTabId: "tab-b" }); expect(dock().hidden).toBe(true);
  setGeneration(1); await vi.advanceTimersByTimeAsync(1100);
  emit({ activeTabId: "tab-a" }); expect(dock().hidden).toBe(true);
  emit({ paused: false }); setGeneration(2);
  emit({ activity: "Use B", activeTabId: "tab-b", agentActivity: { sequence: 4, tabIds: ["tab-b"] } }); emit({ activity: null });
  emit({ activeTabId: "tab-a" });
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
});

it("opens for metadata without claiming a page and blocks page input until Take over", async () => {
  useProvider = true; setGeneration(2); await start();
  emit({ revealSequence: 1, agentActivity: { sequence: 1, tabIds: [] } });
  await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
  emit({ activity: "Read A", agentActivity: { sequence: 2, tabIds: ["tab-a"] } }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(50);
  const page = node("in-built-browser-viewport");
  page.setPointerCapture = vi.fn(); page.hasPointerCapture = vi.fn(() => false);
  request.mockClear();
  for (const event of [
    new MouseEvent("pointerdown", { clientX: 50, clientY: 60, bubbles: true, cancelable: true }),
    new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
    new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }),
    new KeyboardEvent("keydown", { key: "x", code: "KeyX", bubbles: true, cancelable: true }),
    new CompositionEvent("compositionend", { data: "text", bubbles: true, cancelable: true }),
    new Event("paste", { bubbles: true, cancelable: true })
  ]) expect(page.dispatchEvent(event)).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(request.mock.calls.map(call => call[0])).not.toContain("input");
  expect(document.querySelector<HTMLInputElement>(".bg-browser-address")!.readOnly).toBe(true);
  control().click(); await vi.advanceTimersByTimeAsync(1);
  expect(page.hasAttribute("data-agent-control")).toBe(false);
  expect(document.querySelector<HTMLInputElement>(".bg-browser-address")!.readOnly).toBe(false);
  page.dispatchEvent(new MouseEvent("pointerdown", { clientX: 50, clientY: 60, bubbles: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(request.mock.calls.find(call => call[0] === "input")?.[1]).toMatchObject({ tabId: "tab-a" });
});

it("fades effects in and out without an old exit timer hiding the next response", async () => {
  await start(); setTask(2); emit({ activity: "Read page" });
  expect(cursor().hidden).toBe(false); expect(glow().hidden).toBe(false);
  expect(cursor().dataset.visible).toBeUndefined(); expect(glow().dataset.visible).toBeUndefined();
  await vi.advanceTimersByTimeAsync(50);
  expect(cursor().dataset.visible).toBe("true"); expect(glow().dataset.visible).toBe("true");
  emit({ activity: null }); setTask(1); await vi.advanceTimersByTimeAsync(150);
  expect(cursor().hidden).toBe(false); expect(glow().hidden).toBe(false);
  setTask(2); emit({ activity: "Read again" }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(1200);
  expect(cursor().hidden).toBe(false); expect(glow().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
});

it("skips enter and exit fades with reduced motion", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  await start(); setTask(2); emit({ activity: "Read page" });
  expect(cursor().dataset.visible).toBe("true"); expect(glow().dataset.visible).toBe("true");
  emit({ activity: null }); setTask(1);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
});

it("coalesces true and optimistic state changes without ending a response between them", async () => {
  useOptimistic = true; trueResponse = { agentState: { conversationId: displayedContext, status: 2, fullyIdle: false } };
  await start(); emit({ activity: "Click", agentActivity: { sequence: 1, tabIds: ["tab-a"] } }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(50); request.mockClear();
  trueResponse = { agentState: { conversationId: displayedContext, status: 1, fullyIdle: true } };
  for (const listener of [...trueListeners]) listener();
  optimisticResponse = { agentState: { conversationId: displayedContext, status: 2, fullyIdle: false } };
  for (const listener of [...optimisticListeners]) listener();
  await vi.advanceTimersByTimeAsync(50);
  expect(cursor().hidden).toBe(false); expect(glow().dataset.visible).toBe("true");
  expect(request.mock.calls.filter(call => call[0] === "response-state")).toHaveLength(0);
  optimisticResponse = undefined;
  for (const listener of [...optimisticListeners]) listener();
  await vi.advanceTimersByTimeAsync(1100);
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true);
});

it("observes completion while the sidebar is unmounted so the next response cannot inherit its tabs", async () => {
  useProvider = true; setGeneration(2); await start();
  const tabs = ["a", "b"].map(id => ({ id: `tab-${id}`, url: `http://localhost/${id}`, title: id }));
  emit({ tabs, activity: "Read A", agentActivity: { sequence: 1, tabIds: ["tab-a"] } }); emit({ activity: null });
  const pane = document.querySelector("aside")!; pane.remove(); await vi.advanceTimersByTimeAsync(50);
  setGeneration(1); setGeneration(2);
  document.body.append(pane); await vi.advanceTimersByTimeAsync(50);
  emit({ activeTabId: "tab-b", activity: "Read B", agentActivity: { sequence: 2, tabIds: ["tab-b"] } }); emit({ activity: null });
  await vi.advanceTimersByTimeAsync(50); expect(cursor().hidden).toBe(false);
  emit({ activeTabId: "tab-a" });
  expect(cursor().hidden).toBe(true); expect(glow().hidden).toBe(true); expect(dock().hidden).toBe(true);
});

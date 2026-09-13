// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("community/plugins/pets/index.js", "utf8");

interface PetActions {
  askThread(key: string | null, text: string): Promise<boolean>;
  fromSurface(message: { t: string; [key: string]: unknown }): void;
  stopThread(key: string): Promise<void>;
  readEntries(): unknown[];
  dismiss(key: string): void;
  settings: Record<string, unknown>;
  setShown(shown: boolean): void;
  start(): Promise<void>;
  connectSurface(send: (message: ActivityMessage) => void): void;
  disconnectSurface(): void;
}

interface ActivityMessage {
  t: string;
  working: boolean;
  entries: { key: string; status: string; title: string; subtitle: string }[];
}

const cleanups: (() => void)[] = [];
const sent: { key: string | null; path: string; text: string }[] = [];
const stopped: string[] = [];
let pet: PetActions;
let enableSend = true;
let hostState: unknown;
let agentStatesManager: unknown;
const storeListeners = new Set<() => void>();
const hostStore = {
  getState: () => hostState,
  subscribe: (listener: () => void) => { storeListeners.add(listener); return () => storeListeners.delete(listener); }
};
let stored: Map<string, unknown>;
let bootPet: () => PetActions;
let desktopData: Record<string, unknown>[];
let desktopSend: ((message: { t: string; [key: string]: unknown }) => void) | undefined;

function showConversation(key: string | null): HTMLTextAreaElement {
  history.replaceState(null, "", key === null ? "/" : `/c/${key}`);
  const view = document.querySelector("main")!;
  view.dataset.testid = "conversation-view";
  view.dataset.cascadeId = key ?? "conversation";
  view.innerHTML = '<div data-testid="agent-input-box"><textarea></textarea><button data-testid="send-button" disabled>Send</button><button data-tooltip-id="input-send-button-cancel-tooltip">Stop</button></div>';
  const field = view.querySelector("textarea")!;
  const send = view.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!;
  field.addEventListener("input", () => {
    if (enableSend) setTimeout(() => { send.disabled = false; }, 32);
  });
  send.addEventListener("click", () => {
    sent.push({ key, path: location.pathname, text: field.value });
    field.value = "";
  });
  view.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]')!.addEventListener("click", () => {
    stopped.push(key ?? "new");
  });
  return field;
}

function addThread(key: string, delay: number | null): void {
  const row = document.createElement("div");
  row.dataset.testid = "conversation-row-sidebar";
  row.dataset.cascadeId = key;
  row.innerHTML = `<a href="/c/${key}" aria-label="${key}"></a><span class="truncate">${key}</span><span data-testid="status-loading-spinner"></span>`;
  row.querySelector("a")!.addEventListener("click", (event) => {
    event.preventDefault();
    if (delay !== null) setTimeout(() => showConversation(key), delay);
  });
  document.querySelector("nav")!.appendChild(row);
  pet.readEntries();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document.defaultView!, "focus").mockImplementation(() => undefined);
  document.body.innerHTML = '<a data-testid="new-conversation-button" href="/">New conversation</a><nav></nav><main></main>';
  document.querySelector("a")!.addEventListener("click", (event) => {
    event.preventDefault();
    setTimeout(() => showConversation(null), 240);
  });
  sent.length = 0;
  stopped.length = 0;
  enableSend = true;
  hostState = undefined;
  storeListeners.clear();
  agentStatesManager = undefined;
  stored = new Map([["shown", false]]);
  desktopData = [];
  desktopSend = undefined;
  showConversation("previous");

  // Run the actual community plugin with its pet hidden. The fixture supplies
  // the host DOM and plugin services, while the real navigation and send code runs.
  let savedSettings: Record<string, unknown> | undefined;
  const plugin = {
    manifest: { id: "pets" },
    settings: {
      define: (schema: Record<string, { default?: unknown }>) => savedSettings ??= Object.fromEntries(
        Object.entries(schema).map(([key, value]) => [key, value.default])
      ),
      onChange: () => () => undefined
    },
    storage: {
      get: (key: string, fallback: unknown) => stored.has(key) ? stored.get(key) : fallback,
      set: (key: string, value: unknown) => { stored.set(key, value); }
    },
    overlay: {
      open: async (options: { data: Record<string, unknown> }) => {
        desktopData.push(options.data);
        return {
          ok: true,
          send: vi.fn(),
          close: vi.fn(),
          onMessage: (listener: typeof desktopSend) => {
            desktopSend = listener;
            listener!({ t: "hello", width: 800, height: 600 });
            return () => { desktopSend = undefined; };
          }
        };
      }
    },
    react: {
      getFiber: () => (hostState === undefined && agentStatesManager === undefined) ? undefined : ({
        dependencies: {
          firstContext: {
            memoizedValue: hostState !== undefined ? { store: hostStore } : agentStatesManager,
            next: hostState !== undefined && agentStatesManager !== undefined ? { memoizedValue: agentStatesManager } : undefined
          }
        }
      })
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ui: { button: () => ({ element: document.createElement("button"), setActive: vi.fn(), remove: vi.fn() }) },
    onDispose: (cleanup: () => void) => cleanups.push(cleanup)
  };
  bootPet = () => new Function("plugin", "window", `${source}\nreturn {
    askThread, stopThread, readEntries, dismiss, settings, fromSurface, setShown, start,
    connectSurface: (send) => { surface = { send, close() {} }; poll(); },
    disconnectSurface: stop
  };`)(plugin, document.defaultView) as PetActions;
  pet = bootPet();
});

describe("Pets activity updates", () => {
  function observe(): ActivityMessage[] {
    const updates: ActivityMessage[] = [];
    document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]')!.remove();
    pet.connectSurface((message) => updates.push(message));
    return updates;
  }

  it("updates from store events within 50ms and sorts changed chats ahead of older statuses", async () => {
    const summaries = {
      working: { summary: "Working task", status: 2, lastModifiedTime: Date.now() - 2000 },
      waiting: { summary: "Waiting task", status: 1, waitingSteps: [{ toolName: "approval" }], lastModifiedTime: Date.now() - 1000 }
    };
    hostState = { trajectorySummaries: { summaries } };
    const updates = observe();
    expect(updates.at(-1)!.entries.map(entry => entry.key)).toEqual(["waiting", "working"]);
    expect(storeListeners.size).toBe(1);
    hostState = { trajectorySummaries: { summaries: { ...summaries,
      working: { ...summaries.working, summary: "Updated working task", lastModifiedTime: Date.now() }
    } } };
    storeListeners.forEach(listener => listener());
    await vi.advanceTimersByTimeAsync(50);
    expect(updates.at(-1)!.entries.map(entry => entry.key)).toEqual(["working", "waiting"]);
    expect(updates.at(-1)!.entries[0]!.title).toBe("Updated working task");
    const count = updates.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(updates).toHaveLength(count);
  });

  it("listens to provider step changes without reopening dismissed notifications", async () => {
    hostState = { trajectorySummaries: { summaries: {
      worker: { summary: "Background work", status: 2, lastModifiedTime: Date.now() - 2000 },
      newest: { summary: "Newer task", status: 2, lastModifiedTime: Date.now() - 1000 }
    } } };
    const listeners = new Set<() => void>();
    let state: Record<string, unknown> = { trajectorySlice: { totalStepsLength: 1, stepsInSlice: [
      { status: 2, step: { value: { thinking: "Planning" } } }
    ] } };
    const provider = {
      getState: () => state,
      onDidChange: (listener: () => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; }
    };
    const acquire = vi.fn();
    agentStatesManager = { getAgentStates: () => new Map([["worker", { provider }]]), subscribe: acquire };
    const updates = observe();
    expect(listeners.size).toBe(1);
    expect(acquire).not.toHaveBeenCalled();
    expect(updates.at(-1)!.entries[0]!.key).toBe("newest");
    state = { trajectorySlice: { totalStepsLength: 2, stepsInSlice: [
      { status: 2, metadata: { executionId: "command-1", toolCall: { name: "run_command" } }, step: { value: {} } }
    ] } };
    listeners.forEach(listener => listener());
    await vi.advanceTimersByTimeAsync(50);
    expect(updates.at(-1)!.entries[0]).toMatchObject({ key: "worker", status: "running", subtitle: "Running command" });
    pet.dismiss("worker");
    state = { trajectorySlice: { totalStepsLength: 3, stepsInSlice: [
      { status: 2, metadata: { executionId: "command-2", toolCall: { name: "run_command" } }, step: { value: {} } }
    ] } };
    listeners.forEach(listener => listener());
    await vi.advanceTimersByTimeAsync(50);
    expect(updates.at(-1)!.entries.some(entry => entry.key === "worker")).toBe(false);
    pet.disconnectSurface();
    expect(listeners.size).toBe(0);
    expect(storeListeners.size).toBe(0);
  });

  it("coalesces live DOM progress and ignores pet animation mutations", async () => {
    const updates: ActivityMessage[] = [];
    pet.connectSurface(message => updates.push(message));
    const summary = document.createElement("div");
    summary.dataset.testid = "planner-response-text";
    document.querySelector('[data-testid="conversation-view"]')!.append(summary);
    for (const text of ["Checking", "Checking the", "Checking the implementation"]) summary.textContent = text;
    const count = updates.length;
    await vi.advanceTimersByTimeAsync(50);
    expect(updates).toHaveLength(count + 1);
    expect(updates.at(-1)!.entries.find(entry => entry.key === "previous")?.subtitle).toBe("Checking the implementation");
    const decoration = document.createElement("div");
    decoration.className = "bettergravity-pet";
    document.body.append(decoration);
    decoration.style.backgroundPosition = "10% 20%";
    decoration.textContent = "A frame";
    await vi.advanceTimersByTimeAsync(50);
    expect(updates).toHaveLength(count + 1);
  });

  it("keeps background progress text when its provider is released", async () => {
    const progress = "Reviewing all task cards and their shared width";
    hostState = { trajectorySummaries: { summaries: {
      worker: { summary: "Background task", status: 2, lastModifiedTime: Date.now() }
    } } };
    const providers = new Map([["worker", { provider: { getState: () => ({ status: 2, trajectorySlice: {
      stepsInSlice: [{ status: 3, step: { value: { response: progress } } }]
    } }) } }]]);
    agentStatesManager = { getAgentStates: () => providers };
    const updates = observe();
    expect(updates.at(-1)!.entries[0]!.subtitle).toBe(progress);
    providers.clear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(updates.at(-1)!.entries[0]!.subtitle).toBe(progress);
  });

  it("reports ongoing work independently of dismissing its card, and reports when it ends", () => {
    const updates = observe();
    addThread("working", null);
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)).toMatchObject({ working: true, entries: [{ key: "working" }] });

    pet.dismiss("working");
    expect(updates.at(-1)).toMatchObject({ working: true, entries: [] });
    vi.advanceTimersByTime(4000);
    expect(updates.at(-1)).toMatchObject({ working: true, entries: [] });

    // The notification list stays empty: the separate work signal is the only
    // change, and still has to reach both renderers.
    document.querySelector('[data-testid="status-loading-spinner"]')!.remove();
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)).toMatchObject({ working: false, entries: [] });
  });

  it("keeps observing agent state while activity cards are disabled", () => {
    pet.settings.activity = false;
    const updates = observe();
    addThread("working", null);
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)).toMatchObject({ working: true, entries: [] });
    document.querySelector('[data-testid="status-loading-spinner"]')!.remove();
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)).toMatchObject({ working: false, entries: [] });
  });

  it("detects a worker beyond the displayed notification limit", () => {
    const updates = observe();
    for (let index = 0; index < 33; index += 1) {
      addThread(`waiting-${index}`, null);
      document.querySelector(`[data-cascade-id="waiting-${index}"] [data-testid="status-loading-spinner"]`)!
        .setAttribute("data-testid", "attention-dot");
    }
    addThread("working", null);
    vi.advanceTimersByTime(2000);
    const last = updates.at(-1)!;
    expect(last.working).toBe(true);
    expect(last.entries).toHaveLength(32);
    expect(last.entries.every((entry) => entry.status === "waiting")).toBe(true);
  });

  it("lets a new status appear after its running notification was dismissed", () => {
    const updates = observe();
    addThread("working", null);
    vi.advanceTimersByTime(2000);
    pet.dismiss("working");
    document.querySelector('[data-testid="status-loading-spinner"]')!.setAttribute("data-testid", "status-unread-dot");
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)).toMatchObject({ working: false, entries: [{ key: "working", status: "review" }] });
  });

  it("follows live work when its sidebar row is filtered or unmounted", () => {
    const updates = observe();
    hostState = { trajectorySummaries: { summaries: {
      hidden: { status: 2, notFullyIdle: true, waitingSteps: [] }
    } } };
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)).toMatchObject({ working: true, entries: [] });

    // A new store snapshot replaces the old one; a cached fiber summary or an
    // indefinitely retained running record would keep the pet working here.
    hostState = { trajectorySummaries: { summaries: {
      hidden: { status: 1, notFullyIdle: false, waitingSteps: [] }
    } } };
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)).toMatchObject({ working: false, entries: [] });
  });

  it("includes a working child agent even while another conversation needs input", () => {
    const updates = observe();
    hostState = { trajectorySummaries: { summaries: {
      waiting: { status: 2, notFullyIdle: true, waitingSteps: [{}] },
      child: { status: 1, notFullyIdle: true, waitingSteps: [], trajectoryMetadata: { parentConversationId: "parent" } }
    } } };
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)?.working).toBe(true);
  });

  it("does not treat a waiting or completed conversation as ongoing work", () => {
    const updates = observe();
    hostState = { trajectorySummaries: { summaries: {
      waiting: { status: 2, notFullyIdle: true, waitingSteps: [{}] },
      completed: { status: 1, notFullyIdle: false, waitingSteps: [{}] }
    } } };
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)?.working).toBe(false);
  });

  it.each([3, 4])("treats host run status %s as work even without a mounted row", (status) => {
    const updates = observe();
    hostState = { trajectorySummaries: { summaries: { hidden: { status, waitingSteps: [] } } } };
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)?.working).toBe(true);
  });

  it("keeps the DOM sensor working if the host store shape changes", () => {
    const updates = observe();
    hostState = { trajectorySummaries: null };
    addThread("working", null);
    vi.advanceTimersByTime(2000);
    expect(updates.at(-1)).toMatchObject({ working: true, entries: [{ key: "working" }] });
  });

  it("does not report Using browser when the browser cursor element is hidden", () => {
    const cursor = document.createElement("div");
    cursor.setAttribute("data-testid", "browser-agent-cursor");
    cursor.classList.add("agent-cursor-element", "agent-cursor-hidden");
    cursor.style.display = "none";
    cursor.style.opacity = "0";
    document.body.appendChild(cursor);

    const entries = pet.readEntries() as { key: string; subtitle: string }[];
    const current = entries.find((e) => e.key === "previous");
    expect(current?.subtitle).not.toBe("Using browser");
  });

  it("does not report completed tools from transcript history and reverts to Thinking when running", () => {
    const view = document.querySelector('[data-testid="conversation-view"]')!;
    const cmdStep = document.createElement("div");
    cmdStep.setAttribute("data-testid", "run-command-step");
    cmdStep.textContent = "Ran pnpm test";
    view.appendChild(cmdStep);

    const entries = pet.readEntries() as { key: string; subtitle: string }[];
    const current = entries.find((e) => e.key === "previous");
    expect(current?.subtitle).toBe("Thinking");
  });

  it("previews the reply instead of embedded Markdown styles and hidden content", () => {
    const summary = document.createElement("div");
    summary.dataset.testid = "planner-response-text";
    summary.innerHTML = `<style>/* Copied from remark-github-blockquote-alert/alert.css */
      .markdown-alert { color: red; }</style>
      <script>const preview = "internal renderer code";</script>
      <template>Unused template</template><noscript>Fallback markup</noscript>
      <span hidden>Hidden metadata</span><span aria-hidden="true">Decorative label</span>
      <p>Waiting for <strong>sprite generation</strong> to finish.</p>`;
    document.querySelector('[data-testid="conversation-view"]')!.appendChild(summary);

    const entries = pet.readEntries() as { key: string; subtitle: string }[];
    expect(entries.find(entry => entry.key === "previous")?.subtitle).toBe("Waiting for sprite generation to finish.");
    expect(summary.querySelector("style")?.textContent).toContain("Copied from remark-github-blockquote-alert");
  });

  it("uses the normal activity fallback while a reply contains only its stylesheet", () => {
    const summary = document.createElement("div");
    summary.dataset.testid = "planner-response-text";
    summary.innerHTML = '<style>/* Markdown alert styles */ .markdown-alert { color: red; }</style>';
    document.querySelector('[data-testid="conversation-view"]')!.appendChild(summary);

    const entries = pet.readEntries() as { key: string; subtitle: string }[];
    expect(entries.find(entry => entry.key === "previous")?.subtitle).toBe("Thinking");
  });

  it("keeps comment syntax when it is part of the actual reply", () => {
    const summary = document.createElement("div");
    summary.dataset.testid = "planner-response-text";
    summary.innerHTML = '<pre><code>/* This comment is visible code */</code></pre>';
    document.querySelector('[data-testid="conversation-view"]')!.appendChild(summary);

    const entries = pet.readEntries() as { key: string; subtitle: string }[];
    expect(entries.find(entry => entry.key === "previous")?.subtitle).toBe("/* This comment is visible code */");
  });

  it("does not report active tool statuses once the turn has completed into review", () => {
    addThread("previous", null);
    const view = document.querySelector('[data-testid="conversation-view"]')!;
    const cmdStep = document.createElement("div");
    cmdStep.setAttribute("data-testid", "run-command-step");
    cmdStep.textContent = "Running pnpm test";
    const spinner = document.createElement("span");
    spinner.className = "animate-spin";
    cmdStep.appendChild(spinner);
    view.appendChild(cmdStep);

    // Turn finishes and leaves an unread dot (review status)
    document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]')?.remove();
    const rowSpinner = document.querySelector('[data-cascade-id="previous"] [data-testid="status-loading-spinner"]')!;
    rowSpinner.setAttribute("data-testid", "status-unread-dot");

    const entries = pet.readEntries() as { key: string; status: string; subtitle: string }[];
    const current = entries.find((e) => e.key === "previous");
    expect(current).toBeDefined();
    expect(current?.status).toBe("review");
    expect(current?.subtitle).toBe("");
  });

  it("reports Running command for off-screen threads with background task trajectories rather than Thinking or Running subagent", () => {
    addThread("background-chat", null);
    hostState = {
      trajectorySummaries: {
        summaries: {
          "child-task-1": {
            status: 2,
            notFullyIdle: true,
            waitingSteps: [],
            summary: "Task: pnpm test",
            trajectoryMetadata: {
              rootConversationId: "background-chat"
            }
          }
        }
      }
    };
    const entries = pet.readEntries() as { key: string; status: string; subtitle: string }[];
    const bg = entries.find((e) => e.key === "background-chat");
    expect(bg).toBeDefined();
    expect(bg?.status).toBe("running");
    expect(bg?.subtitle).toBe("Running tests");
  });

  it("reports Running subagent for off-screen threads with child subagent trajectories", () => {
    addThread("background-chat-2", null);
    hostState = {
      trajectorySummaries: {
        summaries: {
          "subagent-1": {
            status: 2,
            notFullyIdle: true,
            waitingSteps: [],
            summary: "<original_task>",
            trajectoryMetadata: {
              rootConversationId: "background-chat-2",
              subagentSpec: { role: "researcher" }
            }
          }
        }
      }
    };
    const entries = pet.readEntries() as { key: string; status: string; subtitle: string }[];
    const bg = entries.find((e) => e.key === "background-chat-2");
    expect(bg).toBeDefined();
    expect(bg?.status).toBe("running");
    expect(bg?.subtitle).toBe("Running subagent");
  });

  it("reports Running command for off-screen threads via AgentStatesManager without jumping from Thinking", () => {
    addThread("bg-worker", null);
    agentStatesManager = {
      getAgentStates: () => new Map([
        ["bg-worker", {
          provider: {
            getState: () => ({
              backgroundTasks: [
                {
                  step: { status: 2 },
                  taskSnapshot: { description: "Running git status", toolName: "run_command" }
                }
              ]
            })
          }
        }]
      ]),
      peek: (id: string) => id === "bg-worker" ? {
        getState: () => ({
          backgroundTasks: [
            {
              step: { status: 2 },
              taskSnapshot: { description: "Running git status", toolName: "run_command" }
            }
          ]
        })
      } : null
    };

    const entries = pet.readEntries() as { key: string; status: string; subtitle: string }[];
    const bg = entries.find((e) => e.key === "bg-worker");
    expect(bg).toBeDefined();
    expect(bg?.status).toBe("running");
    expect(bg?.subtitle).toBe("Running command");
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Pets activity visibility persistence", () => {
  const badge = () => document.querySelector<HTMLElement>(".bettergravity-pet__badge")!;
  const tray = () => document.querySelector<HTMLElement>(".bettergravity-pet-tray")!;
  const reload = async () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    pet = bootPet();
    await vi.advanceTimersByTimeAsync(0);
  };

  beforeEach(async () => {
    vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: false }));
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 7 })
    } as unknown as CanvasRenderingContext2D);
    pet.settings.home = "window";
    pet.setShown(true);
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  it("remembers both hiding and showing across pet toggles and complete plugin reloads", async () => {
    expect(tray().dataset.petTray).toBe("open");
    badge().click();
    expect(stored.get("activityPillsVisible")).toBe(false);
    pet.setShown(false);
    expect(document.querySelector(".bettergravity-pet")).toBeNull();
    pet.setShown(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(tray().dataset.petTray).toBe("closed");
    expect(badge().getAttribute("aria-label")).toMatch(/^Show activity,/);
    await reload();
    expect(tray().dataset.petTray).toBe("closed");
    expect(badge().getAttribute("aria-label")).toMatch(/^Show activity,/);
    badge().click();
    expect(stored.get("activityPillsVisible")).toBe(true);
    await reload();
    expect(tray().dataset.petTray).toBe("open");
    expect(tray().dataset.petStack).toBe("collapsed");
    expect(badge().getAttribute("aria-label")).toBe("Hide activity");
    expect(sent).toEqual([]);
  });

  it("carries the same preference between window and desktop surfaces", async () => {
    badge().click();
    pet.fromSurface({ t: "badge-corner", corner: "bottom-end" });
    pet.settings.home = "desktop";
    await pet.start();
    expect(desktopData.at(-1)).toMatchObject({ desktop: true, activityPillsVisible: false, badgeCorner: "bottom-end" });
    expect(document.querySelector(".bettergravity-pet")).toBeNull();
    desktopSend!({ t: "activity-visibility", visible: "true" });
    expect(stored.get("activityPillsVisible")).toBe(false);
    desktopSend!({ t: "activity-visibility", visible: true });
    desktopSend!({ t: "badge-corner", corner: "top-start" });
    desktopSend!({ t: "badge-corner", corner: "invalid" });
    expect(stored.get("activityPillsVisible")).toBe(true);
    expect(stored.get("badgeCorner")).toBe("top-start");
    pet.settings.home = "window";
    await pet.start();
    expect(tray().dataset.petTray).toBe("open");
    expect(tray().dataset.petStack).toBe("collapsed");
    expect(document.querySelector<HTMLElement>(".bettergravity-pet")!.dataset.petBadgeCorner).toBe("top-start");
    await reload();
    expect(document.querySelector<HTMLElement>(".bettergravity-pet")!.dataset.petBadgeCorner).toBe("top-start");
    expect(sent).toEqual([]);
  });
});

describe("Pets conversation controls", () => {
  it("focuses the current composer without navigating or changing its draft when the pet is clicked", () => {
    const field = document.querySelector<HTMLTextAreaElement>("main textarea")!;
    field.value = "Keep this draft";
    pet.fromSurface({ t: "poke" });
    expect(window.focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(field);
    expect(location.pathname).toBe("/c/previous");
    expect(field.value).toBe("Keep this draft");
    expect(sent).toEqual([]);
  });

  it("opens the particular chat selected from a task card", async () => {
    addThread("selected", 120);
    addThread("unrelated", 120);
    pet.fromSurface({ t: "open", key: "selected" });
    await vi.advanceTimersByTimeAsync(150);
    expect(location.pathname).toBe("/c/selected");
    expect(window.focus).toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("opens the root chat when a task card belongs to a child agent", async () => {
    addThread("parent", 120);
    hostState = { trajectorySummaries: { summaries: {
      child: { trajectoryMetadata: { rootConversationId: "parent" } }
    } } };
    pet.fromSurface({ t: "open", key: "child" });
    await vi.advanceTimersByTimeAsync(150);
    expect(location.pathname).toBe("/c/parent");
    expect(sent).toEqual([]);
  });

  it("opens an existing chat with its project when its sidebar row is unmounted", () => {
    hostState = { trajectorySummaries: { summaries: {
      hidden: { trajectoryMetadata: { projectId: "project-one" } }
    } } };
    pet.fromSurface({ t: "open", key: "hidden" });
    expect(location.pathname).toBe("/c/hidden");
    expect(location.search).toBe("?section=project-one");
    expect(window.focus).toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it.each([true, false])("acknowledges inline replies after the host send succeeds or fails (send enabled=%s)", async (ready) => {
    enableSend = ready;
    const updates: ActivityMessage[] = [];
    pet.connectSurface(message => updates.push(message));
    pet.fromSurface({ t: "ask", key: "previous", text: "Reply from the card", requestId: "reply-1" });
    expect(updates.filter(message => message.t === "reply-result")).toEqual([]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(updates.filter(message => message.t === "reply-result")).toEqual([
      { t: "reply-result", key: "previous", requestId: "reply-1", ok: ready }
    ]);
    expect(sent).toHaveLength(ready ? 1 : 0);
  });

  it("does not deliver an old reply result to a replacement pet surface", async () => {
    const before: ActivityMessage[] = [];
    const after: ActivityMessage[] = [];
    pet.connectSurface(message => before.push(message));
    pet.fromSurface({ t: "ask", key: "previous", text: "Reply from the card", requestId: "reply-1" });
    pet.connectSurface(message => after.push(message));
    await vi.advanceTimersByTimeAsync(600);
    expect(before.filter(message => message.t === "reply-result")).toEqual([]);
    expect(after.filter(message => message.t === "reply-result")).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("explicitly requests projectless navigation from other plugins", async () => {
    let projectless = false;
    document.querySelector("a")!.addEventListener("click", (event) => {
      projectless = (event as MouseEvent & { betterGravityProjectless?: boolean }).betterGravityProjectless === true;
    });
    const pending = pet.askThread(null, "Start in Conversations");
    await vi.advanceTimersByTimeAsync(600);
    await pending;
    expect(projectless).toBe(true);
    expect(sent).toEqual([{ key: null, path: "/", text: "Start in Conversations" }]);
  });

  // A root URL can still be a project's composer when it carries section=<id>.
  it("refuses a project composer if the host ignores projectless navigation", async () => {
    const previous = document.querySelector("a")!;
    const replacement = previous.cloneNode(true) as HTMLAnchorElement;
    previous.replaceWith(replacement);
    replacement.addEventListener("click", (event) => {
      event.preventDefault();
      setTimeout(() => {
        showConversation(null);
        history.replaceState(null, "", "/?section=some-workspace");
      }, 240);
    });
    const pending = pet.askThread(null, "Keep this outside a project");
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(sent).toEqual([]);
    expect(document.querySelector("textarea")!.value).toBe("");
  });

  // The old composer remains mounted while the router handles the root anchor.
  // Sending as soon as any composer exists put projectless chat into that thread.
  it("waits for the new conversation before sending a projectless chat", async () => {
    const previous = document.querySelector("textarea")!;
    previous.value = "An unfinished draft";
    const pending = pet.askThread(null, "A new question");

    await vi.advanceTimersByTimeAsync(180);
    expect(previous.value).toBe("An unfinished draft");
    expect(sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(400);
    await pending;
    expect(sent).toEqual([{ key: null, path: "/", text: "A new question" }]);
  });

  // A fixed two-frame/120 ms delay did not prove the requested thread had loaded.
  it("sends a follow-up only after slow navigation reaches the requested thread", async () => {
    addThread("requested", 360);
    const previous = document.querySelector("textarea")!;
    previous.value = "Keep this draft";
    const pending = pet.askThread("requested", "Follow up here");

    await vi.advanceTimersByTimeAsync(220);
    expect(previous.value).toBe("Keep this draft");
    expect(sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(400);
    await pending;
    expect(sent).toEqual([{ key: "requested", path: "/c/requested", text: "Follow up here" }]);
  });

  // Ignoring selectThread(false) sent a missing card's reply into the open thread.
  it("leaves the current draft alone when the requested thread cannot be found", async () => {
    const previous = document.querySelector("textarea")!;
    previous.value = "Keep this draft";
    const pending = pet.askThread("missing", "A follow-up");
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(previous.value).toBe("Keep this draft");
    expect(sent).toEqual([]);
  });

  // Clicking a valid row can still fail to navigate, for example during a reload.
  it("does not send when the requested navigation times out", async () => {
    addThread("unavailable", null);
    const previous = document.querySelector("textarea")!;
    previous.value = "Keep this draft";
    const pending = pet.askThread("unavailable", "A follow-up");
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(previous.value).toBe("Keep this draft");
    expect(sent).toEqual([]);
  });

  // Stop used to ignore a failed selection and cancel whichever thread was open.
  it("does not stop another conversation when a card's thread is missing", async () => {
    await pet.stopThread("missing");
    expect(stopped).toEqual([]);
  });

  it("waits for the selected conversation before pressing its stop control", async () => {
    addThread("requested", 360);
    const pending = pet.stopThread("requested");
    await vi.advanceTimersByTimeAsync(220);
    expect(stopped).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    await pending;
    expect(stopped).toEqual(["requested"]);
  });

  // An enabled button belongs to the current composer, which the user can change
  // while the pet is waiting for input validation to finish.
  it("does not send into a different conversation if the user switches while waiting", async () => {
    const pending = pet.askThread("previous", "For the original thread");
    setTimeout(() => {
      const field = showConversation("elsewhere");
      field.value = "Another draft";
      document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!.disabled = false;
    }, 160);
    enableSend = false;
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(sent).toEqual([]);
    expect(document.querySelector("textarea")!.value).toBe("Another draft");
  });

  // A disabled send control is a refusal, not a reason to bypass it with Enter.
  it("does not synthesize Enter when the host keeps the send button disabled", async () => {
    enableSend = false;
    const entered = vi.fn();
    document.querySelector("textarea")!.addEventListener("keydown", entered);
    const pending = pet.askThread("previous", "Not ready yet");
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(sent).toEqual([]);
    expect(entered).not.toHaveBeenCalled();
  });
});

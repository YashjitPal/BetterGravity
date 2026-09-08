// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("community/plugins/pets/index.js", "utf8");

interface PetActions {
  askThread(key: string | null, text: string): Promise<void>;
  stopThread(key: string): Promise<void>;
  readEntries(): unknown[];
  dismiss(key: string): void;
  settings: Record<string, unknown>;
  connectSurface(send: (message: ActivityMessage) => void): void;
}

interface ActivityMessage {
  t: string;
  working: boolean;
  entries: { key: string; status: string }[];
}

const cleanups: (() => void)[] = [];
const sent: { key: string | null; path: string; text: string }[] = [];
const stopped: string[] = [];
let pet: PetActions;
let enableSend = true;
let hostState: unknown;

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
  showConversation("previous");

  // Run the actual community plugin with its pet hidden. The fixture supplies
  // the host DOM and plugin services, while the real navigation and send code runs.
  const plugin = {
    settings: {
      define: (schema: Record<string, { default?: unknown }>) => Object.fromEntries(
        Object.entries(schema).map(([key, value]) => [key, value.default])
      ),
      onChange: () => () => undefined
    },
    storage: { get: (key: string, fallback: unknown) => key === "shown" ? false : fallback },
    react: {
      getFiber: () => hostState === undefined ? undefined : ({
        dependencies: { firstContext: { memoizedValue: { store: { getState: () => hostState } } } }
      })
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ui: { button: () => ({ element: document.createElement("button"), setActive: vi.fn(), remove: vi.fn() }) },
    onDispose: (cleanup: () => void) => cleanups.push(cleanup)
  };
  pet = new Function("plugin", "window", `${source}\nreturn {
    askThread, stopThread, readEntries, dismiss, settings,
    connectSurface: (send) => { surface = { send, close() {} }; poll(); }
  };`)(plugin, document.defaultView) as PetActions;
});

describe("Pets activity updates", () => {
  function observe(): ActivityMessage[] {
    const updates: ActivityMessage[] = [];
    document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]')!.remove();
    pet.connectSurface((message) => updates.push(message));
    return updates;
  }

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
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Pets conversation controls", () => {
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

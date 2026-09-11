// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const manifest = JSON.parse(readFileSync("community/plugins/fork-chat/plugin.json", "utf8"));
const pluginSource = readFileSync("community/plugins/fork-chat/index.js", "utf8");

describe("Fork Chat plugin manifest", () => {
  it("conforms to the community manifest standard", () => {
    expect(manifest.name).toBe("Fork Chat");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.main).toBe("index.js");
    expect(manifest.styles).toEqual(["styles/fork.css"]);
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.length).toBeGreaterThan(10);
    expect(manifest.author).toBe("Yashjit Pal");
  });
});

describe("Fork Chat plugin functionality", () => {
  let cleanups: (() => void)[] = [];
  let menuContributors: ((menu: any) => any)[] = [];
  let buttons: any[] = [];
  let toasts: any[] = [];
  let forkCalls: any[] = [];
  let navigatedTo: string[] = [];

  const mockAgentService = {
    forkConversation: vi.fn(async (args: any) => {
      forkCalls.push(args);
      return {
        newCascadeId: "forked-child-uuid-1234",
        newProjectId: "outside-of-project",
        forkedAtStepIndex: args.forkAtStepIndex
      };
    }),
    updateConversationAnnotations: vi.fn(async () => {})
  };

  const mockRouter = {
    navigate: vi.fn((opts: any) => {
      navigatedTo.push(opts.to);
    })
  };

  const mockStore = {
    dispatch: vi.fn(),
    getState: () => ({
      conversation: {
        conversations: [
          {
            type: "recent",
            conversationIds: ["convo-1", "convo-2"],
            workspaceUris: ["file:///workspace"]
          }
        ]
      },
      trajectorySummaries: {
        summaries: {
          "convo-1": { summary: "First Conversation", title: "First Conversation", status: 1, notFullyIdle: false, lastModifiedTime: { seconds: "1725849600" }, stepCount: 12 },
          "convo-2": { summary: "Busy Conversation", title: "Busy Conversation", status: 2, notFullyIdle: true, lastModifiedTime: { seconds: "1725840000" }, stepCount: 4 }
        }
      }
    })
  };

  beforeEach(() => {
    mockAgentService.forkConversation.mockClear();
    mockRouter.navigate.mockClear();
    cleanups = [];
    menuContributors = [];
    buttons = [];
    toasts = [];
    forkCalls = [];
    navigatedTo = [];
    localStorage.clear();

    document.body.innerHTML = `
      <header class="titlebar-container">
        <div class="flex items-center gap-1">
          <button data-testid="titlebar-more-actions" aria-label="More actions"></button>
        </div>
      </header>
      <main data-testid="conversation-view" data-cascade-id="convo-1">
        <div data-testid="user-input-step">
          <div class="user-input-buttons-container">
            <button aria-label="Copy">Copy</button>
            <button data-testid="revert-button" aria-label="Undo changes up to this point">Undo</button>
          </div>
        </div>
        <div class="flex w-full items-start gap-1 pl-2 pr-1">
          <div class="flex shrink-0 items-end">
            <button aria-label="Copy">Copy</button>
          </div>
        </div>
      </main>
      <div data-testid="conversation-row-sidebar" data-cascade-id="convo-1">
        <a aria-label="First Conversation" href="/c/convo-1"></a>
        <span class="truncate">First Conversation</span>
      </div>
    `;

    // Attach React fibers with mocks
    const view = document.querySelector('[data-testid="conversation-view"]') as any;
    const fiberKey = "__reactFiber$test";
    view[fiberKey] = {
      memoizedProps: {
        store: mockStore,
        router: mockRouter,
        agentService: mockAgentService
      },
      dependencies: {
        firstContext: {
          memoizedValue: {
            forkConversation: mockAgentService.forkConversation,
            navigate: mockRouter.navigate,
            store: mockStore
          },
          next: null
        }
      },
      return: null
    };

    const userStepEl = document.querySelector('[data-testid="user-input-step"]') as any;
    userStepEl[fiberKey] = {
      memoizedProps: {
        userStepIndex: 5,
        userStep: { stepIndex: 5 }
      },
      return: view[fiberKey]
    };

    const turnBar = document.querySelector(".flex.w-full.items-start.gap-1") as any;
    turnBar[fiberKey] = {
      memoizedProps: {
        steps: [
          {
            metadata: {
              sourceTrajectoryStepInfo: { stepIndex: 42 }
            }
          }
        ]
      },
      return: view[fiberKey]
    };

    const plugin = {
      settings: {
        define: (schema: Record<string, { default?: any }>) =>
          Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default])),
        onChange: () => () => undefined
      },
      ui: {
        toast: (opts: any) => toasts.push(opts),
        button: (spec: any) => {
          buttons.push(spec);
          return { element: document.createElement("button"), remove: () => undefined };
        },
        contextMenu: (fn: any) => {
          menuContributors.push(fn);
          return () => undefined;
        },
        modal: (opts: any) => ({ close: () => opts.onClose?.() })
      },
      onDispose: (fn: () => void) => cleanups.push(fn)
    };

    // Execute plugin index.js in sandbox
    new Function("plugin", "window", "document", "localStorage", pluginSource)(
      plugin,
      window,
      document,
      localStorage
    );
  });

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
  });

  it("synchronizes native conversation forking flags into localStorage", () => {
    const raw = localStorage.getItem("jetski.developer.customFlagOverrides");
    expect(raw).toBeTruthy();
    const flags = JSON.parse(raw!);
    expect(flags["enable-conversation-forking"]).toBe(true);
    expect(flags["enable-fork-in-new-worktree"]).toBe(true);
  });

  it("does not render a fork button in the top right titlebar area", () => {
    const titlebarBtn = document.querySelector("button[data-fork-titlebar-btn]");
    expect(titlebarBtn).toBeNull();
  });

  it("reframes three dot menu Fork option as Copy session with workspace options", () => {
    const menuEl = document.createElement("div");
    menuEl.setAttribute("role", "menu");
    menuEl.innerHTML = `
      <div role="menuitem">
        <span><svg></svg><span>Fork</span></span>
      </div>
      <div role="menuitem">
        <span>Create fork in current workspace</span>
      </div>
      <div role="menuitem">
        <span>Create fork in shared workspace</span>
      </div>
    `;
    document.body.appendChild(menuEl);

    new Function("plugin", "window", "document", "localStorage", pluginSource)(
      { settings: { define: () => ({}), onChange: () => () => undefined }, ui: { toast: () => undefined, button: () => undefined, contextMenu: () => undefined, modal: () => undefined }, onDispose: () => undefined },
      window,
      document,
      localStorage
    );

    const items = Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
    expect(items[0]?.textContent).toContain("Copy session");
    expect(items[0]?.textContent).not.toContain("Fork");
    expect(items[1]?.textContent).toContain("In current workspace");
    expect(items[2]?.textContent).toContain("In shared workspace");
  });

  it("decorates user messages with a Fork button between Copy and Undo", () => {
    const userForkBtn = document.querySelector(".user-input-buttons-container button[data-fork-chat-btn]");
    expect(userForkBtn).toBeTruthy();
    expect(userForkBtn?.getAttribute("aria-label")).toBe("Fork from this message");
  });

  it("decorates assistant message turns with a Fork from this message button", () => {
    const forkBtn = document.querySelector(".flex.w-full.items-start button[data-fork-chat-btn]");
    expect(forkBtn).toBeTruthy();
    expect(forkBtn?.getAttribute("aria-label")).toBe("Fork from this message");
  });

  it("ensures strictly one fork button exists under messages even if native fork button is rendered", () => {
    const turnBar = document.querySelector(".flex.w-full.items-start.gap-1")!;
    // Simulate Antigravity native UI adding a native fork button
    const nativeBtn = document.createElement("button");
    nativeBtn.setAttribute("aria-label", "Fork Conversation");
    turnBar.appendChild(nativeBtn);

    // Re-run scanAll
    const view = document.querySelector('[data-testid="conversation-view"]');
    const scanAllFn = new Function("plugin", "window", "document", "localStorage", pluginSource);
    scanAllFn(
      { settings: { define: () => ({}), onChange: () => () => undefined }, ui: { toast: () => undefined, button: () => undefined, contextMenu: () => undefined, modal: () => undefined }, onDispose: () => undefined },
      window,
      document,
      localStorage
    );

    const visibleForkBtns = Array.from(
      turnBar.querySelectorAll('button:is([aria-label="Fork Conversation"], [data-fork-chat-btn])')
    ).filter((b) => (b as HTMLElement).style.display !== "none");
    expect(visibleForkBtns.length).toBe(1);
    expect(visibleForkBtns[0]!.getAttribute("data-fork-chat-btn")).toBe("true");
  });

  it("clicking the turn fork button opens a Willow-styled popup menu with the two workspace options", () => {
    const forkBtn = document.querySelector(".flex.w-full.items-start button[data-fork-chat-btn]") as HTMLButtonElement;
    expect(forkBtn).toBeTruthy();

    forkBtn.click();

    const menu = document.querySelector(".bettergravity-fork-popover[role='menu']");
    expect(menu).toBeTruthy();

    const items = menu?.querySelectorAll(".bettergravity-fork-popover-item");
    expect(items?.length).toBe(2);
    expect(items?.[0]?.textContent).toContain("Fork in current workspace");
    expect(items?.[1]?.textContent).toContain("Fork in shared worktree");
  });

  it("adds a Fork conversation item to the conversation sidebar context menu", () => {
    expect(menuContributors.length).toBeGreaterThan(0);
    const mockMenu = {
      has: (testid: string) => testid === "conversation-rename-menu-item",
      trigger: document.querySelector('[data-testid="conversation-row-sidebar"]')
    };

    const items = menuContributors[0]!(mockMenu);
    expect(items).toBeDefined();
    expect(items.length).toBe(1);
    expect(items[0].label).toBe("Fork conversation");
  });

  it("does not register a button in the left sidebar under pets", () => {
    expect(buttons.filter((b) => b.area === "sidebar").length).toBe(0);
  });

  it("hides the native top bar forked conversation banner", () => {
    const view = document.querySelector('[data-testid="conversation-view"]')!;
    const banner = document.createElement("div");
    banner.setAttribute("title", "Open side-by-side view");
    view.prepend(banner);

    const pluginFn = new Function("plugin", "window", "document", "localStorage", pluginSource);
    pluginFn(
      { settings: { define: () => ({}), onChange: () => () => undefined }, ui: { toast: () => undefined, button: () => undefined, contextMenu: () => undefined, modal: () => undefined }, onDispose: () => undefined },
      window,
      document,
      localStorage
    );

    expect(banner.style.display).toBe("none");
  });

  it("executes fork from context menu, renames with 'Forked • ' prefix, and navigates to the forked child conversation", async () => {
    const mockMenu = {
      has: (testid: string) => testid === "conversation-rename-menu-item",
      trigger: document.querySelector('[data-testid="conversation-row-sidebar"]')
    };

    const items = menuContributors[0]!(mockMenu);
    items[0]!.onSelect();

    // Wait for async fork to resolve
    await new Promise((r) => setTimeout(r, 20));

    expect(mockAgentService.forkConversation).toHaveBeenCalledWith({
      sourceCascadeId: "convo-1",
      forkAtStepIndex: -1,
      targetForkWorkspace: 1
    });

    expect(mockAgentService.updateConversationAnnotations).toHaveBeenCalledWith(
      "forked-child-uuid-1234",
      { title: "Forked • First Conversation" },
      true
    );

    expect(mockStore.dispatch).toHaveBeenCalledWith({
      type: "updateOptimisticSummary",
      cascadeId: "forked-child-uuid-1234",
      optimisticSummaryText: "Forked • First Conversation"
    });

    expect(navigatedTo).toContain("/c/forked-child-uuid-1234");
    expect(toasts.some((t) => t.title === "Conversation forked!")).toBe(true);
  });

  it("guards against forking when a conversation is actively running", async () => {
    const mockMenu = {
      has: (testid: string) => testid === "conversation-rename-menu-item",
      trigger: {
        closest: (sel: string) => ({
          getAttribute: () => "convo-2",
          querySelector: () => ({ getAttribute: () => "Busy Conversation" })
        })
      }
    };

    const items = menuContributors[0]!(mockMenu);
    items[0]!.onSelect();

    await new Promise((r) => setTimeout(r, 20));

    expect(mockAgentService.forkConversation).not.toHaveBeenCalled();
    expect(toasts.some((t) => t.title === "Conversation is busy")).toBe(true);
  });
});

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("community/plugins/fork-chat/index.js", "utf8");
const fiberKey = "__reactFiber$forkTest";
const propsKey = "__reactProps$forkTest";
type Step = { status: number; step: { case: string }; metadata: { sourceTrajectoryStepInfo?: { stepIndex: number; cascadeId?: string } } };
const step = (kind = "plannerResponse"): Step => ({ status: 3, step: { case: kind }, metadata: {} });

let disposers: (() => void)[];
let toasts: { title: string; body: string }[];
let summaries: Record<string, { status: number; notFullyIdle?: boolean }>;
let fork: ReturnType<typeof vi.fn>;
let navigate: ReturnType<typeof vi.fn>;
let getHistory: ReturnType<typeof vi.fn>;
let startCascade: ReturnType<typeof vi.fn>;
let annotations: ReturnType<typeof vi.fn>;
let helpers: { decorateTurnBar(bar: HTMLElement): void; runFork(id: string, index: unknown, target: number): Promise<void> };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  localStorage.clear();
  disposers = [];
  toasts = [];
  summaries = {};
  fork = vi.fn(async () => ({ newCascadeId: "forked", newProjectId: "fork-project" }));
  navigate = vi.fn(async () => {});
  getHistory = vi.fn();
  startCascade = vi.fn(async (request: { cascadeId: string }) => ({ cascadeId: request.cascadeId }));
  annotations = vi.fn(async () => {});
});

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
});

function mount(turns: Step[][], { id = "source", start = 100, withSlice = true } = {}) {
  const view = document.createElement("main");
  view.dataset.testid = "conversation-view";
  view.dataset.cascadeId = id;
  const slice = {
    conversationId: id,
    stepsSlice: { startIndex: start },
    stepsInSlice: turns.flat(),
    totalStepsLength: start + turns.flat().length
  };
  const rootFiber = {
    stateNode: view,
    memoizedProps: {
      agentService: { forkConversation: fork, getCascadeTrajectory: getHistory, startCascade, updateConversationAnnotations: annotations },
      store: { getState: () => ({ trajectorySummaries: { summaries } }), dispatch: vi.fn() },
      // The router may be exposed by a provider rather than a direct prop.
      value: { router: { navigate } }
    },
    return: null
  };
  Object.assign(view, { [fiberKey]: rootFiber });
  const sliceFiber = { memoizedProps: withSlice ? { trajectorySlice: slice } : {}, return: rootFiber };
  const bars = turns.map((steps, index) => {
    const bar = document.createElement("div");
    bar.className = "flex w-full items-start";
    bar.innerHTML = '<div class="flex min-w-0"><button aria-label="Copy"></button></div>';
    const owner = { memoizedProps: { steps, isLatest: index === turns.length - 1 }, return: sliceFiber };
    const props = { className: bar.className };
    Object.assign(bar, { [fiberKey]: { memoizedProps: props, return: owner }, [propsKey]: props });
    view.append(bar);
    return bar;
  });
  document.body.append(view);
  summaries[id] = { status: 1 };
  return { view, bars, slice, sliceFiber };
}

function start(): void {
  helpers = new Function("plugin", `${source}\nreturn { decorateTurnBar, runFork };`)({
    settings: { define: () => ({}), onChange: () => () => {} },
    ui: { contextMenu() {}, toast: (toast: { title: string; body: string }) => toasts.push(toast) },
    onDispose: (cleanup: () => void) => disposers.push(cleanup)
  });
  vi.advanceTimersByTime(0);
}

function open(bar: HTMLElement): void {
  bar.querySelector<HTMLButtonElement>("[data-fork-chat-btn]")!.click();
}

async function choose(target = 1): Promise<void> {
  const items = document.querySelectorAll<HTMLButtonElement>(".bettergravity-fork-popover-item");
  expect(items).toHaveLength(2);
  items[target - 1]!.click();
  await vi.advanceTimersByTimeAsync(0);
}

describe("forking through the selected response", () => {
  it.each([1, 2])("sends the inclusive end of the chosen response to workspace %s on paged history", async target => {
    const first = [step("userInput"), step(), step("generic"), step()];
    const next = [step("userInput"), step()];
    const { bars } = mount([first, next]);
    start();
    open(bars[0]!);
    await choose(target);

    expect(fork).toHaveBeenCalledExactlyOnceWith({ sourceCascadeId: "source", forkAtStepIndex: 103, targetForkWorkspace: target });
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/c/$cascadeId", params: { cascadeId: "forked" } }));
    const search = navigate.mock.calls[0]![0].search;
    expect(search({ focused: "source", q: "old search", tab: "terminal", section: "old-project", keep: true }))
      .toEqual({ section: "fork-project", keep: true });
  });

  it("uses the current branch's slice positions instead of its inherited source indices", async () => {
    const first = [step("userInput"), step()];
    first[1]!.metadata.sourceTrajectoryStepInfo = { cascadeId: "ancestor", stepIndex: 900 };
    const { bars } = mount([first, [step("userInput"), step()]], { id: "branch", start: 20 });
    start();
    open(bars[0]!);
    await choose();
    expect(fork).toHaveBeenCalledExactlyOnceWith({ sourceCascadeId: "branch", forkAtStepIndex: 21, targetForkWorkspace: 1 });
  });

  it("allows an earlier response to be forked while later work in the same conversation is running", async () => {
    const { bars } = mount([[step("userInput"), step()], [step("userInput"), step()]]);
    summaries.source = { status: 2, notFullyIdle: true };
    start();
    open(bars[0]!);
    await choose();
    expect(fork).toHaveBeenCalledExactlyOnceWith({ sourceCascadeId: "source", forkAtStepIndex: 101, targetForkWorkspace: 1 });
    expect(toasts.some(toast => toast.title === "Conversation is busy")).toBe(false);
  });

  it("keeps the selected cutoff when more steps arrive before a workspace is chosen", async () => {
    const { bars, slice } = mount([[step("userInput"), step()]]);
    start();
    open(bars[0]!);
    slice.stepsInSlice.push(step("userInput"), step());
    slice.totalStepsLength += 2;
    summaries.source = { status: 2, notFullyIdle: true };
    await choose();
    expect(fork.mock.calls[0]![0].forkAtStepIndex).toBe(101);
  });

  it("uses the conversation containing the clicked button when more than one is visible", async () => {
    mount([[step()]], { id: "first" });
    const second = mount([[step()]], { id: "second", start: 50 });
    start();
    helpers.decorateTurnBar(second.bars[0]!);
    open(second.bars[0]!);
    await choose();
    expect(fork).toHaveBeenCalledExactlyOnceWith({ sourceCascadeId: "second", forkAtStepIndex: 50, targetForkWorkspace: 1 });
  });

  it("reads the committed React alternate when a response toolbar is reused", async () => {
    const older = [step("userInput"), step()];
    const current = [step("userInput"), step("generic"), step()];
    const { bars, sliceFiber } = mount([older, current]);
    const bar = bars[0]!;
    const attached = (bar as unknown as Record<string, any>)[fiberKey];
    const committedProps = { className: bar.className };
    attached.alternate = {
      memoizedProps: committedProps,
      return: { memoizedProps: { steps: current, isLatest: true }, return: sliceFiber }
    };
    Object.assign(bar, { [propsKey]: committedProps });
    start();
    open(bar);
    await choose();
    expect(fork.mock.calls[0]![0].forkAtStepIndex).toBe(104);
  });

  it("accepts an inclusive cutoff at step zero", async () => {
    const { bars } = mount([[step()], [step("userInput"), step()]], { start: 0 });
    start();
    open(bars[0]!);
    await choose();
    expect(fork.mock.calls[0]![0].forkAtStepIndex).toBe(0);
  });

  it("does not copy the whole conversation or choose an earlier step when the final step cannot be located", () => {
    const steps = [step(), step()];
    steps[0]!.metadata.sourceTrajectoryStepInfo = { stepIndex: 5 };
    const { bars } = mount([steps], { withSlice: false });
    start();
    open(bars[0]!);
    expect(document.querySelector(".bettergravity-fork-popover")).toBeNull();
    expect(fork).not.toHaveBeenCalled();
    expect(toasts.some(toast => toast.title === "Fork point unavailable")).toBe(true);
  });

  it("rejects invalid indices instead of converting them to a whole-conversation fork", async () => {
    mount([[step()]]);
    start();
    for (const index of [undefined, null, NaN, -2, 1.5]) await helpers.runFork("source", index, 1);
    expect(fork).not.toHaveBeenCalled();
  });

  it("keeps the current page intact if the native router cannot open the newly created fork", async () => {
    const { bars } = mount([[step()]]);
    navigate.mockRejectedValue(new Error("Navigation unavailable"));
    const before = window.location.href;
    start();
    open(bars[0]!);
    await choose();
    expect(fork).toHaveBeenCalledOnce();
    expect(window.location.href).toBe(before);
    expect(toasts.some(toast => toast.body === "Your new branch is ready to open from the sidebar.")).toBe(true);
  });
});

const busyError = () => new Error('cannot fork conversation "source": it must be fully idle, with no running steps, subagents, background tasks, or queued messages');

function historyFor(steps: Step[]) {
  return {
    trajectory: {
      cascadeId: "source", trajectoryId: "source-trajectory", trajectoryType: 4, source: 1,
      steps,
      metadata: { projectId: "source-project", environmentId: "source-environment", workspaceUris: ["file:///source/workspace"] },
      parentReferences: [{ conversationId: "ancestor", trajectoryId: "ancestor-trajectory", stepIndex: 900 }],
      generatorMetadata: [
        { stepIndices: [1, 2], promptDebugStr: "first generation" },
        { stepIndices: [3], promptDebugStr: "selected response" },
        { stepIndices: [5], promptDebugStr: "future message context" },
        { stepIndices: [], promptDebugStr: "pending future generation" }
      ],
      executorMetadatas: [{ lastStepIdx: 3 }, { lastStepIdx: 5 }],
      battleModeInfos: [{ children: ["unrelated-running-child"] }]
    }
  };
}

describe("forking history while the server reports ongoing work", () => {
  it.each([1, 2])("copies only the selected prefix and its context into workspace %s", async target => {
    const selected = [step("userInput"), step(), step("generic"), step()];
    const later = [step("userInput"), step()];
    later[1]!.status = 2;
    const { bars } = mount([selected, later], { start: 0 });
    const history = historyFor([...selected, ...later]);
    const before = structuredClone(history);
    getHistory.mockResolvedValue(history);
    fork.mockRejectedValueOnce(busyError());
    summaries.source = { status: 2, notFullyIdle: true };
    start();
    open(bars[0]!);
    await choose(target);

    expect(getHistory).toHaveBeenCalledExactlyOnceWith({ cascadeId: "source", verbosity: 3 });
    expect(startCascade).toHaveBeenCalledOnce();
    const request = startCascade.mock.calls[0]![0];
    const copy = request.baseTrajectoryIdentifier.identifier.value;
    expect(request.baseTrajectoryIdentifier.identifier.case).toBe("trajectory");
    expect(copy.steps).toEqual(selected);
    expect(copy.generatorMetadata).toEqual(history.trajectory.generatorMetadata.slice(0, 2));
    expect(copy.executorMetadatas).toEqual([{ lastStepIdx: 3 }]);
    expect(copy.parentReferences).toEqual([]);
    expect(copy.cascadeId).toBe("source");
    expect(copy.trajectoryId).toBe("source-trajectory");
    expect(copy.battleModeInfos).toEqual([]);
    expect(JSON.stringify(copy)).not.toContain("future");
    expect(request.workspaceUris).toEqual(["file:///source/workspace"]);
    expect(request.projectEnvConfig).toEqual({ projectId: "source-project", target: { case: "environmentId", value: "source-environment" } });
    expect(request.cascadeId).not.toBe("source");
    expect(history).toEqual(before);

    if (target === 1) {
      expect(fork).toHaveBeenCalledOnce();
      expect(navigate.mock.calls[0]![0].params.cascadeId).toBe(request.cascadeId);
      expect(annotations).toHaveBeenCalledWith(request.cascadeId, { title: "Forked • Untitled conversation" }, true);
    } else {
      expect(fork).toHaveBeenCalledTimes(2);
      expect(fork).toHaveBeenLastCalledWith({ sourceCascadeId: request.cascadeId, forkAtStepIndex: 3, targetForkWorkspace: 2 });
      expect(annotations).toHaveBeenCalledWith(request.cascadeId, { archived: true }, true);
      expect(navigate.mock.calls[0]![0].params.cascadeId).toBe("forked");
    }
    expect(toasts.some(toast => /busy|Failed/.test(toast.title))).toBe(false);
  });

  it("seals unfinished background work in the copy without changing the source", async () => {
    const running = { ...step("generic"), status: 2, interaction: { id: "source-permission" } };
    const selected = [running, step()];
    const { bars } = mount([selected, [step("userInput")]], { start: 0 });
    getHistory.mockResolvedValue(historyFor([...selected, step("userInput")]));
    fork.mockRejectedValueOnce(busyError());
    start();
    open(bars[0]!);
    await choose();
    const copy = startCascade.mock.calls[0]![0].baseTrajectoryIdentifier.identifier.value;
    expect(copy.steps[0]).toEqual({ ...running, status: 6, interaction: undefined });
    expect(copy.steps[1]).toEqual(selected[1]);
    expect(running.status).toBe(2);
    expect(running.interaction.id).toBe("source-permission");
  });

  it("can copy a whole previous chat despite a stuck busy state, freezing only its copied tail", async () => {
    const steps = [step("userInput"), step(), { ...step(), status: 8 }];
    mount([steps], { start: 0 });
    const history = historyFor(steps);
    history.trajectory.metadata.projectId = "outside-of-project";
    history.trajectory.metadata.environmentId = "";
    getHistory.mockResolvedValue(history);
    fork.mockRejectedValueOnce(busyError());
    summaries.source = { status: 2, notFullyIdle: true };
    start();
    await helpers.runFork("source", -1, 1);
    const request = startCascade.mock.calls[0]![0];
    expect(request.projectEnvConfig).toBeUndefined();
    expect(request.baseTrajectoryIdentifier.identifier.value.steps.map((s: Step) => s.step)).toEqual(steps.map(s => s.step));
    expect(request.baseTrajectoryIdentifier.identifier.value.steps.at(-1).status).toBe(6);
    expect(steps.at(-1)!.status).toBe(8);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("does not copy a selected response that is still being written", async () => {
    const steps = [step("userInput"), { ...step(), status: 8 }];
    const { bars } = mount([steps], { start: 0 });
    getHistory.mockResolvedValue(historyFor(steps));
    fork.mockRejectedValueOnce(busyError());
    start();
    open(bars[0]!);
    await choose();
    expect(startCascade).not.toHaveBeenCalled();
    expect(toasts.at(-1)!.body).toContain("earlier completed response");
  });

  it.each(["missing response", "wrong conversation"])("creates no copy if a fresh snapshot has a %s", async problem => {
    const steps = [step("userInput"), step()];
    const { bars } = mount([steps], { start: 0 });
    const history = historyFor(problem === "missing response" ? [steps[0]!] : steps);
    if (problem === "wrong conversation") history.trajectory.cascadeId = "different-source";
    getHistory.mockResolvedValue(history);
    fork.mockRejectedValueOnce(busyError());
    start();
    open(bars[0]!);
    await choose();
    expect(startCascade).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(toasts.at(-1)!.title).toBe("Failed to fork conversation");
  });

  it("archives the backing snapshot even when creating the shared worktree fails", async () => {
    const steps = [step("userInput"), step()];
    const { bars } = mount([steps], { start: 0 });
    getHistory.mockResolvedValue(historyFor(steps));
    fork.mockRejectedValueOnce(busyError()).mockRejectedValueOnce(new Error("No Git repository for this workspace"));
    start();
    open(bars[0]!);
    await choose(2);
    expect(annotations).toHaveBeenCalledWith(startCascade.mock.calls[0]![0].cascadeId, { archived: true }, true);
    expect(navigate).not.toHaveBeenCalled();
    expect(toasts.at(-1)!.body).toBe("No Git repository for this workspace");
  });

  it("surfaces unrelated native errors without making a snapshot", async () => {
    const { bars } = mount([[step()]], { start: 0 });
    fork.mockRejectedValueOnce(new Error("Workspace not found"));
    start();
    open(bars[0]!);
    await choose();
    expect(getHistory).not.toHaveBeenCalled();
    expect(startCascade).not.toHaveBeenCalled();
    expect(toasts.at(-1)!.body).toBe("Workspace not found");
  });

  it("cleans up only its allocated snapshot ID if creation returns an unexpected conversation", async () => {
    const steps = [step("userInput"), step()];
    const { bars } = mount([steps], { start: 0 });
    getHistory.mockResolvedValue(historyFor(steps));
    fork.mockRejectedValueOnce(busyError());
    startCascade.mockResolvedValueOnce({ cascadeId: "source" });
    start();
    open(bars[0]!);
    await choose();
    const allocatedId = startCascade.mock.calls[0]![0].cascadeId;
    expect(allocatedId).not.toBe("source");
    expect(annotations).toHaveBeenCalledExactlyOnceWith(allocatedId, { archived: true }, true);
    expect(navigate).not.toHaveBeenCalled();
  });
});

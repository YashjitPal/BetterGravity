// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySourcePatches, readPatches } from "../src/main/source-patch.js";

const source = readFileSync("community/plugins/gemini-app/index.js", "utf8");
const helpers = source.slice(source.indexOf("function sampleEmphasisedEase("), source.indexOf("const geminiSendEntrance ="));
const { createGeminiSendEntrance, sampleEmphasisedEase } = new Function(`${helpers}\nreturn { createGeminiSendEntrance, sampleEmphasisedEase };`)();

type AnimationProbe = {
  from: number; duration: number; easing: string; currentTime: number; cancelled: boolean;
  onfinish: (() => void) | null; oncancel: (() => void) | null;
  pause: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>;
};

function harness() {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const resizes: Array<{ callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const motion = Object.assign(new EventTarget(), { matches: false });
  let hidden = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
  const environment = {
    document, location: { pathname: "/c/one" }, performance: { now: () => Date.now() },
    matchMedia: () => motion, getComputedStyle: () => ({ paddingTop: "40px" }),
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    ResizeObserver: class {
      observe = vi.fn(); disconnect = vi.fn();
      constructor(public callback: () => void) { resizes.push(this); }
    }
  };
  const entrance = createGeminiSendEntrance(environment);
  return {
    entrance, environment, frames, resizes, motion,
    frame(ms: number) {
      vi.advanceTimersByTime(ms);
      const ready = Array.from(frames.values()); frames.clear();
      for (const callback of ready) callback(Date.now());
    },
    hide() { hidden = true; document.dispatchEvent(new Event("visibilitychange")); }
  };
}

function fixture(id = "one") {
  const view = document.createElement("div");
  view.dataset.testid = "conversation-view"; view.dataset.cascadeId = id;
  view.style.cssText = "display:flex;flex-direction:column";
  view.innerHTML = '<div class="relative w-full flex-grow min-h-0"><div class="h-full overflow-y-auto"><div class="relative flex flex-col gap-y-3"></div></div></div><div data-testid="agent-input-box"><div contenteditable="true"></div></div>';
  document.body.append(view);
  const scroller = view.querySelector<HTMLElement>(".overflow-y-auto")!;
  const thread = scroller.firstElementChild as HTMLElement;
  const composer = view.lastElementChild as HTMLElement;
  let top = 0;
  const writes: number[] = [];
  Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => top, set: value => { top = value; writes.push(value); } });
  scroller.scrollTo = vi.fn((options: ScrollToOptions | number) => {
    if (typeof options !== "number" && options.behavior !== "smooth") scroller.scrollTop = options.top || 0;
  }) as typeof scroller.scrollTo;
  const viewportRead = vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(() => ({ top: 0, bottom: 600, height: 600, width: 704 }) as DOMRect);
  const add = (y: number, parent: HTMLElement = thread) => {
    const outer = document.createElement("div"); outer.className = "flex items-start";
    outer.style.minHeight = "calc(100cqh - 50px)";
    outer.innerHTML = '<div class="flex flex-col gap-0.5 group w-full scroll-mt-4"><div role="article" aria-label="User message"><div data-testid="user-input-step"></div></div><div role="article" aria-label="Agent response"></div><div data-testid="agent-loading">Working</div><div class="pt-3"><div class="flex w-full items-start" data-gemini-turn-actions="true"></div></div></div>';
    parent.append(outer);
    const group = outer.firstElementChild as HTMLElement;
    const step = group.querySelector<HTMLElement>('[data-testid="user-input-step"]')!;
    const animations: AnimationProbe[] = [];
    group.animate = vi.fn((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation: AnimationProbe = {
        from: Number(/translateY\(([-.\d]+)px\)/.exec(String(keyframes[0]!.transform))![1]),
        duration: Number(options.duration), easing: options.easing!, currentTime: 0, cancelled: false,
        onfinish: null, oncancel: null, pause: vi.fn(), cancel: vi.fn(() => { animation.cancelled = true; animation.oncancel?.(); })
      };
      animations.push(animation);
      return animation as unknown as Animation;
    }) as typeof group.animate;
    let logicalTop = y;
    const read = vi.spyOn(group, "getBoundingClientRect").mockImplementation(() => {
      const animation = animations.at(-1);
      const progress = animation ? Math.min(1, animation.currentTime / animation.duration) : 1;
      const offset = !animation || animation.cancelled ? 0 : animation.from *
        (1 - (animation.easing === "linear" ? progress : sampleEmphasisedEase(progress)));
      return { top: logicalTop - top + offset, bottom: logicalTop - top + offset + 180, height: 180, width: 704 } as DOMRect;
    });
    return { outer, group, step, animations, read, move: (delta: number) => { logicalTop += delta; } };
  };
  return { view, scroller, thread, composer, add, writes, viewportRead, setUserTop: (value: number) => { top = value; } };
}

const opened: Array<ReturnType<typeof harness>> = [];
const open = () => { const h = harness(); opened.push(h); return h; };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => {
  for (const h of opened.splice(0)) h.entrance.dispose();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("Gemini sent-message entrance", () => {
  it("uses Willow's 200px / 500ms first entrance and leaves the layout and text fade intact", () => {
    const h = open(), f = fixture();
    h.entrance.arm(f.composer);
    expect(h.entrance.ownsViewport(f.scroller)).toBe(true);
    const turn = f.add(40);
    turn.group.setAttribute("data-gemini-revealing", "true");
    expect(h.entrance.mount(turn.step)).toBe(true);
    expect(turn.animations[0]).toMatchObject({ from: 200, duration: 500, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    expect(turn.group.dataset.geminiSendEntering).toBe("true");
    expect(h.frames.size).toBe(0);
    expect(h.resizes).toHaveLength(0);
    expect(h.entrance.nativeSend("one")).toBe(true);
    turn.animations[0]!.onfinish!();
    expect(turn.group.hasAttribute("data-gemini-send-entering")).toBe(false);
    expect(turn.group.dataset.geminiRevealing).toBe("true");
    expect(f.view.style.display).toBe("flex");
    expect(turn.outer.style.minHeight).toMatch(/calc\((-50px \+ 100cqh|100cqh - 50px)\)/);
    expect(h.entrance.ownsViewport(f.scroller)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one timeline for a short turn and its scroll, with no per-frame geometry reads", () => {
    const h = open(), f = fixture(), previous = f.add(40);
    h.entrance.arm(f.composer);
    const turn = f.add(300);
    expect(h.entrance.mount(turn.step)).toBe(true);
    expect(turn.animations[0]!.from).toBe(300);
    expect(h.frames.size).toBe(1);
    h.frame(35);
    expect(f.scroller.scrollTop).toBe(0);
    expect(turn.animations[0]!.currentTime).toBeGreaterThan(0);
    h.frame(100);
    expect(f.scroller.scrollTop).toBeGreaterThan(0);
    expect(turn.animations[0]!.currentTime).toBe(1);
    h.frame(265);
    expect(f.scroller.scrollTop).toBe(260);
    expect(previous.animations).toHaveLength(0);
    expect(previous.read).not.toHaveBeenCalled();
    expect(turn.read).toHaveBeenCalledTimes(1);
    expect(f.viewportRead).toHaveBeenCalledTimes(1);
    expect(f.writes.every((value, i, values) => !i || value >= values[i - 1]!)).toBe(true);
    expect(h.frames.size).toBe(0);
    expect(h.resizes[0]!.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rechecks changed geometry before writes and never undoes browser scroll anchoring", () => {
    const h = open(), f = fixture(); f.add(40);
    h.entrance.arm(f.composer);
    const turn = f.add(300); h.entrance.mount(turn.step);
    h.frame(25);
    turn.move(100); f.setUserTop(100);
    h.resizes[0]!.callback();
    h.frame(10);
    expect(f.scroller.scrollTop).toBe(100);
    expect(turn.read).toHaveBeenCalledTimes(2);
    h.frame(365);
    expect(f.scroller.scrollTop).toBeCloseTo(360, 5);
    expect(turn.read).toHaveBeenCalledTimes(2);
  });

  it("uses native smooth scrolling when a long reply already puts the new bubble below the viewport", () => {
    const h = open(), f = fixture(), previous = f.add(40);
    h.entrance.arm(f.composer);
    const turn = f.add(900); h.entrance.mount(turn.step);
    expect(f.scroller.scrollTo).toHaveBeenCalledWith({ top: 860, behavior: "smooth" });
    expect(turn.animations).toHaveLength(0);
    expect(previous.animations).toHaveLength(0);
    expect(h.frames.size).toBe(0);
    f.setUserTop(860); f.scroller.dispatchEvent(new Event("scrollend"));
    expect(turn.group.hasAttribute("data-gemini-send-entering")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["wheel", "touchstart", "pointerdown", "keydown"])("hands over on %s with a 120ms settle and no further scroll writes", event => {
    const h = open(), f = fixture(); f.add(40);
    h.entrance.arm(f.composer);
    const turn = f.add(300); h.entrance.mount(turn.step); h.frame(20);
    const before = f.writes.length;
    f.scroller.dispatchEvent(event === "keydown" ? new KeyboardEvent("keydown", { key: "PageUp" }) : new Event(event));
    expect(turn.animations[0]!.cancelled).toBe(true);
    expect(turn.animations[1]!.duration).toBe(120);
    expect(turn.animations[1]!.from).toBeGreaterThan(0);
    expect(turn.animations[1]!.from).toBeLessThan(300);
    expect(h.entrance.ownsViewport(f.scroller)).toBe(false);
    expect(h.frames.size).toBe(0);
    h.frame(50);
    expect(f.writes).toHaveLength(before);
    turn.animations[1]!.onfinish!();
    expect(turn.group.hasAttribute("data-gemini-send-entering")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a compositor entrance from its current offset without changing inline transforms", () => {
    const h = open(), f = fixture(); h.entrance.arm(f.composer);
    const turn = f.add(40); turn.group.style.transform = "scale(1)";
    h.entrance.mount(turn.step); turn.animations[0]!.currentTime = 200;
    f.scroller.dispatchEvent(new Event("wheel"));
    expect(turn.animations[1]!.from).toBeCloseTo(200 * (1 - sampleEmphasisedEase(0.4)), 8);
    turn.animations[1]!.onfinish!();
    expect(turn.group.style.transform).toBe("scale(1)");
  });

  it.each(["hidden", "reduced", "dispose", "navigation", "removed"])("cleans an active glide and its gate on %s", reason => {
    const h = open(), f = fixture(); f.add(40); h.entrance.arm(f.composer);
    const turn = f.add(300); h.entrance.mount(turn.step);
    if (reason === "hidden") h.hide();
    else if (reason === "reduced") { h.motion.matches = true; h.motion.dispatchEvent(new Event("change")); }
    else if (reason === "dispose") h.entrance.dispose();
    else if (reason === "navigation") h.entrance.cancel();
    else { turn.outer.remove(); h.frame(16); }
    expect(turn.group.hasAttribute("data-gemini-send-entering")).toBe(false);
    expect(turn.animations[0]!.cancelled).toBe(true);
    expect(h.frames.size).toBe(0);
    expect(h.resizes[0]!.disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const before = f.writes.length;
    f.scroller.dispatchEvent(new Event("wheel")); h.frame(50);
    expect(f.writes).toHaveLength(before);
  });

  it("positions quietly without replay when motion is reduced or the window is hidden", () => {
    const h = open(), f = fixture(); h.motion.matches = true;
    h.entrance.arm(f.composer); const turn = f.add(40);
    expect(h.entrance.mount(turn.step)).toBe(true);
    expect(turn.animations).toHaveLength(0);
    expect(h.entrance.nativeSend("one")).toBe(true);
    expect(f.scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    h.motion.matches = false; h.motion.dispatchEvent(new Event("change"));
    expect(turn.animations).toHaveLength(0);
  });

  it("shows the working row and keeps native positioning if creating an animation fails", () => {
    const h = open(), f = fixture(); h.entrance.arm(f.composer);
    const turn = f.add(40);
    vi.mocked(turn.group.animate).mockImplementation(() => { throw new Error("Animation unavailable"); });
    expect(h.entrance.mount(turn.step)).toBe(true);
    expect(turn.group.hasAttribute("data-gemini-send-entering")).toBe(false);
    expect(h.entrance.ownsViewport(f.scroller)).toBe(false);
    expect(f.scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a previous entrance when an unarmed queued turn is committed", () => {
    const h = open(), f = fixture(); h.entrance.arm(f.composer);
    const turn = f.add(40); h.entrance.mount(turn.step);
    f.add(300);
    expect(h.entrance.nativeSend("one")).toBe(false);
    expect(turn.group.hasAttribute("data-gemini-send-entering")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does no work for history, expired submits, earlier turns, queues, subagents, or another pane", () => {
    const h = open(), f = fixture(), old = f.add(40);
    expect(h.entrance.mount(old.step)).toBe(false);
    h.entrance.arm(f.composer);
    const other = fixture("two").add(40);
    expect(h.entrance.mount(other.step)).toBe(false);
    expect(h.entrance.mount(old.step)).toBe(false);
    const queued = document.createElement("div"); queued.dataset.testid = "pending-user-messages"; f.thread.append(queued);
    const queueTurn = f.add(40, queued);
    expect(h.entrance.mount(queueTurn.step)).toBe(false);
    const nested = f.add(40, old.group.querySelector<HTMLElement>('[aria-label="Agent response"]')!);
    expect(h.entrance.mount(nested.step)).toBe(false);
    queued.remove();
    vi.advanceTimersByTime(4000);
    const late = f.add(300);
    expect(h.entrance.mount(late.step)).toBe(false);
    expect(f.viewportRead).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
    expect(h.resizes).toHaveLength(0);
  });

  it("claims a native send that runs before the observer and only consumes it once", () => {
    const h = open(), f = fixture(); f.add(40); h.entrance.arm(f.composer);
    const turn = f.add(300);
    expect(h.entrance.nativeSend("two")).toBe(false);
    expect(h.entrance.nativeSend("one")).toBe(true);
    expect(h.entrance.mount(turn.step)).toBe(false);
    expect(turn.animations).toHaveLength(1);
    h.frame(410);
    const next = f.add(560);
    expect(h.entrance.nativeSend("one")).toBe(false);
    expect(next.animations).toHaveLength(0);
  });

  it("cancels the previous run before another send and releases all input listeners at completion", () => {
    const h = open(), f = fixture(); h.entrance.arm(f.composer);
    const first = f.add(40); h.entrance.mount(first.step);
    const remove = vi.spyOn(f.scroller, "removeEventListener");
    h.entrance.arm(f.composer);
    expect(first.group.hasAttribute("data-gemini-send-entering")).toBe(false);
    const next = f.add(300); h.entrance.mount(next.step); h.frame(410);
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown", "scrollend"]) {
      expect(remove.mock.calls.filter(([type]) => type === event)).toHaveLength(2);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("native send scroll handoff", () => {
  it("keeps the native fallback, passes the conversation id, and never turns generation into a send", () => {
    const manifest = JSON.parse(readFileSync("community/plugins/gemini-app/plugin.json", "utf8"));
    const patch = readPatches("gemini-app", manifest)!.patches.find(p => p.find === "lastStepType")!;
    const native = `function Nib(a,b,c){var e=(0,z.useRef)({totalStepsLength:a,lastStepType:b});(0,z.useEffect)(()=>{var f=b===R.CortexStepType.USER_INPUT;a!==e.current.totalStepsLength&&f&&c?.();e.current={totalStepsLength:a,lastStepType:b}},[a,b,c])}
function render(a,h){Nib(a.totalStepsLength,a.lastStepType,h)}`;
    const result = applySourcePatches(native, [{ pluginId: "gemini-app", patches: [patch] }]);
    expect(result.failures).toEqual([]);
    expect(result.changed).toBe(true);
    let ref: { current: unknown } | undefined;
    const bridge = { nativeSend: vi.fn(() => true) };
    const scope = { __bettergravityGeminiSendEntrance: bridge as typeof bridge | undefined };
    const render = new Function("z", "R", "globalThis", `${result.source};return render;`)(
      { useRef: (value: unknown) => ref ??= { current: value }, useEffect: (callback: () => void) => callback() },
      { CortexStepType: { USER_INPUT: "user" } }, scope
    );
    const scroll = vi.fn();
    const update = (count: number, type = "user", id = "one") => render({ totalStepsLength: count, lastStepType: type, conversationId: id }, scroll);
    update(0); expect(bridge.nativeSend).not.toHaveBeenCalled();
    update(1); expect(bridge.nativeSend).toHaveBeenLastCalledWith("one"); expect(scroll).not.toHaveBeenCalled();
    update(2, "response"); expect(bridge.nativeSend).toHaveBeenCalledTimes(1);
    bridge.nativeSend.mockReturnValue(false);
    update(3, "user", "other-pane"); expect(scroll).toHaveBeenCalledOnce();
    scope.__bettergravityGeminiSendEntrance = undefined;
    update(4); expect(scroll).toHaveBeenCalledTimes(2);
  });
});

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("community/plugins/fork-chat/index.js", "utf8");
const responseActions = 'button:is([aria-label="Copy"], [aria-label="Copied"], [aria-label="Good response"], [aria-label="Bad response"])';
let disposers: (() => void)[];
let helpers: { scanAll(): void };
let view: HTMLElement;

const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const stop = () => { while (disposers.length) disposers.pop()?.(); };

beforeEach(() => {
  vi.useFakeTimers();
  disposers = [];
  localStorage.clear();
  document.body.innerHTML = '<button data-testid="titlebar-more-actions"></button><main data-testid="conversation-view"><div class="overflow-y-auto"><div title="Open side-by-side view"></div><div data-testid="user-input-step"><div class="user-input-buttons-container"><button aria-label="Copy"></button></div></div><div class="flex flex-col" data-gemini-send-entering="true" data-gemini-revealing="true"><article role="article" aria-label="Agent response"><div data-testid="planner-response-text"></div></article><div class="flex w-full items-start"><div class="flex min-w-0"><button aria-label="Good response"></button><button aria-label="Bad response"></button><button aria-label="Copy"></button><button aria-label="Fork Conversation"></button></div></div></div></div></main>';
  view = document.querySelector<HTMLElement>("main")!;
  const plugin = {
    settings: { define: () => ({}), onChange: () => () => {} },
    ui: { contextMenu() {}, toast() {}, modal() {} },
    onDispose: (cleanup: () => void) => disposers.push(cleanup),
  };
  helpers = new Function("plugin", `${source}\nreturn { scanAll };`)(plugin);
  // jsdom queues its own storage events when the native feature flags are set.
  vi.advanceTimersByTime(0);
});

afterEach(() => {
  stop();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Fork Chat repeated work", () => {
  it("does not rewrite settled controls or disturb the response animation gates", async () => {
    await settle();
    const before = view.innerHTML;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(batch => records.push(...batch));
    observer.observe(view, { attributes: true, childList: true, characterData: true, subtree: true });
    try {
      for (let i = 0; i < 10; i++) helpers.scanAll();
      await settle();
      expect(records).toHaveLength(0);
      expect(view.innerHTML).toBe(before);
      expect(view.querySelectorAll("[data-fork-chat-btn]")).toHaveLength(1);
      expect(view.querySelector('[data-testid="user-input-step"] [data-fork-chat-btn]')).toBeNull();
      expect(view.querySelector("[data-gemini-send-entering][data-gemini-revealing]")).not.toBeNull();
    } finally { observer.disconnect(); }
  });

  it.each([
    ["input steps", '<div data-testid="user-input-step"><div class="user-input-buttons-container flex w-full items-start"></div></div>'],
    ["user articles", '<article role="article" aria-label="User message"><div class="flex w-full items-start"></div></article>'],
    ["sent-message controls", '<div class="user-input-buttons-container flex w-full items-start"></div>']
  ])("skips newly mounted %s while adding one fork to each new response", async (_name, markup) => {
    const sent = document.createElement("div");
    sent.innerHTML = markup;
    sent.querySelector(".items-start")!.innerHTML = '<div class="flex min-w-0"><button aria-label="Copy"></button><button data-testid="revert-button" aria-label="Undo changes up to this point"></button></div>';
    const before = sent.innerHTML;
    const response = view.querySelector("[data-gemini-revealing]")!.cloneNode(true) as HTMLElement;
    response.querySelectorAll("[data-fork-chat-btn]").forEach(button => button.remove());
    view.querySelector(".overflow-y-auto")!.append(sent, response);
    await settle();
    vi.advanceTimersByTime(3200);
    await settle();

    expect(sent.innerHTML).toBe(before);
    expect(sent.querySelector("[data-fork-chat-btn]")).toBeNull();
    expect(response.querySelectorAll("[data-fork-chat-btn]")).toHaveLength(1);
    expect(view.querySelectorAll("[data-fork-chat-btn]")).toHaveLength(2);

    const scan = vi.spyOn(view, "querySelectorAll");
    vi.advanceTimersByTime(1200);
    expect(scan).not.toHaveBeenCalledWith(responseActions);
  });

  it("ignores unrelated streaming text and still decorates inserted or rebuilt menu items", async () => {
    vi.advanceTimersByTime(3000);
    await settle();
    const bodyScan = vi.spyOn(document.body, "querySelectorAll");
    const response = view.querySelector('[data-testid="planner-response-text"]')!;
    for (let i = 0; i < 20; i++) {
      const word = document.createElement("span");
      word.textContent = "More response text";
      response.append(word);
      await settle();
    }
    expect(bodyScan).not.toHaveBeenCalledWith('[role="menuitem"]');
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    item.innerHTML = '<span class="min-w-0">Fork</span><span class="shrink-0"></span>';
    document.body.append(item);
    await settle();
    expect(item.textContent).toBe("Copy session");
    expect(item.querySelectorAll("svg")).toHaveLength(2);
    item.querySelector(".min-w-0")!.textContent = "Fork";
    await settle();
    expect(item.textContent).toBe("Copy session");
    expect(item.querySelectorAll("svg")).toHaveLength(2);
    expect(bodyScan).not.toHaveBeenCalledWith('[role="menuitem"]');
  });

  it("does not keep rescanning because native buttons are already hidden and repairs a native reset", async () => {
    vi.advanceTimersByTime(3000);
    await settle();
    const scan = vi.spyOn(view, "querySelectorAll");
    vi.advanceTimersByTime(3000);
    expect(scan).not.toHaveBeenCalledWith(responseActions);
    const native = view.querySelector<HTMLElement>('[aria-label="Fork Conversation"]')!;
    native.style.display = "";
    vi.advanceTimersByTime(620);
    expect(native.style.display).toBe("none");
    const bar = view.querySelector(".flex.w-full.items-start")!;
    bar.querySelector("[data-fork-chat-btn]")!.remove();
    vi.advanceTimersByTime(620);
    expect(bar.querySelectorAll("[data-fork-chat-btn]")).toHaveLength(1);
  });

  it("cancels pending retries and scroll work when the plugin stops", async () => {
    await settle();
    const scroller = view.querySelector<HTMLElement>(".overflow-y-auto")!;
    const remove = vi.spyOn(scroller, "removeEventListener");
    document.querySelector<HTMLButtonElement>('[data-testid="titlebar-more-actions"]')!.click();
    scroller.dispatchEvent(new Event("scroll"));
    stop();
    await settle();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(scroller.dataset.hasForkScroll).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    scroller.dispatchEvent(new Event("scroll"));
    await settle();
    vi.advanceTimersByTime(4000);
    expect(view.querySelectorAll("[data-fork-chat-btn]")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the previous scroller after navigation and binds the new one", async () => {
    vi.advanceTimersByTime(3000);
    await settle();
    const oldScroller = view.querySelector<HTMLElement>(".overflow-y-auto")!;
    const remove = vi.spyOn(oldScroller, "removeEventListener");
    const next = view.cloneNode(true) as HTMLElement;
    view.replaceWith(next);
    vi.advanceTimersByTime(620);
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(oldScroller.dataset.hasForkScroll).toBeUndefined();
    const scan = vi.spyOn(next, "querySelectorAll");
    oldScroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    expect(scan).not.toHaveBeenCalledWith(responseActions);
    next.querySelector(".overflow-y-auto")!.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
    expect(scan).toHaveBeenCalledWith(responseActions);
  });
});

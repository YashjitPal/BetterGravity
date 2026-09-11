// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("community/plugins/gemini-app/index.js", "utf8");
const mounts = new Map<string, ((element: HTMLElement) => void)[]>();
const disposers: (() => void)[] = [];
const resizes = new Map<Element, () => void>();
let scrollIntoViewDescriptor: PropertyDescriptor | undefined;
let helpers: {
  ensureTopFade(scroller: HTMLElement, readScroll?: boolean): void;
  readProjectMap(fiber: unknown): void;
  getGoToNewConversation(): unknown;
  updateHistoryArrowsPosition(): void;
  wrapItems(fiber: unknown): void;
  unwrapItems(): void;
};

function startPlugin(scanExisting = false) {
  const plugin = {
    settings: {
      define: () => ({ workspaceColor: "blue" }),
      onChange: () => () => {},
    },
    dom: {
      observe: (selector: string, callback: (element: HTMLElement) => void) => {
        const callbacks = mounts.get(selector) ?? [];
        callbacks.push(callback);
        mounts.set(selector, callbacks);
        if (scanExisting) {
          for (const element of document.querySelectorAll<HTMLElement>(selector)) callback(element);
        }
        return () => {};
      },
    },
    react: { getFiber: () => null },
    onDispose: (cleanup: () => void) => disposers.push(cleanup),
  };
  helpers = new Function("BetterGravity", "plugin", `${source}\nreturn { ensureTopFade, readProjectMap, getGoToNewConversation, updateHistoryArrowsPosition, wrapItems, unwrapItems };`)({}, plugin);
}

function stopPlugin() {
  while (disposers.length) disposers.pop()?.();
  mounts.clear();
}

function mount(selector: string, element: HTMLElement) {
  const callbacks = mounts.get(selector);
  expect(callbacks?.length).toBeGreaterThan(0);
  for (const callback of callbacks ?? []) callback(element);
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("style");
  localStorage.clear();
  resizes.clear();
  vi.useFakeTimers();
  scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("ResizeObserver", class {
    private readonly elements = new Set<Element>();
    constructor(private readonly callback: (entries: { target: Element }[]) => void) {}
    observe(element: Element) { this.elements.add(element); resizes.set(element, () => this.callback([{ target: element }])); }
    unobserve(element: Element) { this.elements.delete(element); resizes.delete(element); }
    disconnect() { for (const element of this.elements) resizes.delete(element); this.elements.clear(); }
  });
});

afterEach(() => {
  stopPlugin();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("Gemini App repeated work", () => {
  it("restores sidebar collapse handlers when starting on an already mounted page", async () => {
    document.body.innerHTML = '<div><div><nav role="navigation" aria-label="Sidebar"><div class="shrink-0 flex items-center"></div><div class="px-2"><div class="flex flex-col"><button data-testid="new-conversation-button">New conversation</button><button data-testid="history-button">History</button></div></div><div class="relative"><div data-testid="conversation-list-sidebar"></div></div></nav></div></div><button data-testid="sidebar-toggle" aria-label="Toggle Sidebar" aria-expanded="true"></button>';
    const sidebar = document.querySelector<HTMLElement>('nav[aria-label="Sidebar"]')!;
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle"]')!;
    const frame = sidebar.parentElement!.parentElement!;
    for (let cycle = 0; cycle < 2; cycle++) {
      startPlugin(true);
      await settle();
      const extraButton = document.createElement("button");
      extraButton.setAttribute("data-bettergravity-button", "reload-check");
      sidebar.querySelector(".px-2 > .flex-col")!.append(extraButton);
      await settle();
      expect(extraButton.parentElement).toBe(document.getElementById("gemini-scroll-nav"));
      extraButton.remove();
      toggle.click();
      expect(sidebar.dataset.collapsed).toBe("true");
      toggle.setAttribute("aria-expanded", "false");
      await settle();
      expect(frame.style.width).toBe("52px");
      toggle.setAttribute("aria-expanded", "true");
      await settle();
      expect(sidebar.dataset.collapsed).toBe("false");
      expect(frame.style.width).toBe("288px");
      stopPlugin();
    }
  });

  it("keeps the same fade threshold without measuring scroll position when virtual rows change", async () => {
    startPlugin();
    document.body.innerHTML = '<div><div data-testid="conversation-list-sidebar"></div></div>';
    const scroller = document.querySelector<HTMLElement>('[data-testid="conversation-list-sidebar"]')!;
    let scrollTop = 0;
    const readScroll = vi.fn(() => scrollTop);
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: readScroll });
    mount('[data-testid="conversation-list-sidebar"]', scroller);
    await settle();
    expect(document.getElementById("gemini-top-fade")?.dataset.scrolled).toBe("false");

    readScroll.mockClear();
    for (let i = 0; i < 5; i++) {
      scroller.append(document.createElement("div"));
      await settle();
    }
    expect(readScroll).not.toHaveBeenCalled();

    for (const [position, expected] of [[5, "false"], [6, "true"], [300, "true"], [0, "false"]] as const) {
      scrollTop = position;
      scroller.dispatchEvent(new Event("scroll"));
      expect(document.getElementById("gemini-top-fade")?.dataset.scrolled).toBe(expected);
    }
    expect(readScroll).toHaveBeenCalledTimes(4);

    document.getElementById("gemini-top-fade")?.remove();
    scrollTop = 25;
    scroller.append(document.createElement("div"));
    await settle();
    expect(document.getElementById("gemini-top-fade")?.dataset.scrolled).toBe("true");
  });

  it("recognizes each navigation callback once and still follows a replacement callback", () => {
    startPlugin();
    const first = () => {};
    const second = () => {};
    const unrelated = () => {};
    const firstSource = vi.spyOn<any, any>(first, "toString").mockReturnValue('()=>navigate("AGENT_MANAGER_HOME")');
    const secondSource = vi.spyOn<any, any>(second, "toString").mockReturnValue('()=>otherNavigate("AGENT_MANAGER_HOME")');
    const unrelatedSource = vi.spyOn<any, any>(unrelated, "toString").mockReturnValue("()=>0");
    const fiber = { memoizedState: { memoizedState: [first, []], next: { memoizedState: unrelated, next: null } } };
    for (let i = 0; i < 20; i++) helpers.readProjectMap(fiber);
    expect(firstSource).toHaveBeenCalledTimes(1);
    expect(unrelatedSource).toHaveBeenCalledTimes(1);
    expect(helpers.getGoToNewConversation()).toBe(first);

    fiber.memoizedState.memoizedState = [second, []];
    helpers.readProjectMap(fiber);
    expect(secondSource).toHaveBeenCalledTimes(1);
    expect(helpers.getGoToNewConversation()).toBe(second);
  });

  it("leaves toolbar styles alone until their measured position changes", () => {
    startPlugin();
    document.body.innerHTML = '<div data-testid="title-menu-bar"><span></span></div><button data-testid="sidebar-toggle"></button><div><button aria-label="Go Back"></button></div>';
    const child = document.querySelector<HTMLElement>('[data-testid="title-menu-bar"] > span')!;
    let right = 300;
    vi.spyOn(child, "getBoundingClientRect").mockImplementation(() => ({ left: 0, right, width: right, height: 30 }) as DOMRect);
    helpers.updateHistoryArrowsPosition();
    const arrows = document.querySelector<HTMLElement>('[data-testid="sidebar-toggle"] + div')!;
    expect(arrows.style.left).toBe("308px");
    expect(arrows.style.getPropertyPriority("left")).toBe("important");

    const rootWrites = vi.spyOn(document.documentElement.style, "setProperty");
    const arrowWrites = vi.spyOn(arrows.style, "setProperty");
    for (let i = 0; i < 10; i++) helpers.updateHistoryArrowsPosition();
    expect(rootWrites).not.toHaveBeenCalled();
    expect(arrowWrites).not.toHaveBeenCalled();
    right = 345;
    helpers.updateHistoryArrowsPosition();
    expect(arrows.style.left).toBe("353px");
    expect(document.documentElement.style.getPropertyValue("--gemini-history-arrows-left")).toBe("353px");
  });

  it("removes page event handlers across repeated plugin reloads", () => {
    // Warm the selector engine before watching the plugin's registrations.
    document.querySelectorAll(":scope > div:has(span)");
    const documentAdds = vi.spyOn(document, "addEventListener");
    const documentRemoves = vi.spyOn(document, "removeEventListener");
    const windowAdds = vi.spyOn(window, "addEventListener");
    const windowRemoves = vi.spyOn(window, "removeEventListener");
    const capture = (options: unknown) => typeof options === "boolean" ? options : Boolean((options as AddEventListenerOptions | undefined)?.capture);
    for (let cycle = 0; cycle < 3; cycle++) {
      startPlugin();
      stopPlugin();
    }
    const pairs: [typeof documentAdds, typeof documentRemoves][] = [
      [documentAdds, documentRemoves],
      [windowAdds, windowRemoves]
    ];
    for (const [adds, removes] of pairs) {
      for (const [type, listener, options] of adds.mock.calls) {
        expect(removes.mock.calls.some(([removedType, removedListener, removedOptions]) =>
          type === removedType && listener === removedListener && capture(options) === capture(removedOptions)),
        `Leaked ${type} handler`).toBe(true);
      }
    }
  });

  it("does not rewrite an unchanged message bubble after resize and keeps its expand control", async () => {
    startPlugin();
    document.body.innerHTML = '<div data-testid="user-input-step"><div data-testid="lifted-context-menu-trigger"><div class="bg-card"><div class="flex-1"><div class="whitespace-pre-wrap">A long user message</div></div></div></div></div>';
    const step = document.querySelector<HTMLElement>('[data-testid="user-input-step"]')!;
    const text = step.querySelector<HTMLElement>(".whitespace-pre-wrap")!;
    vi.spyOn(text, "getBoundingClientRect").mockReturnValue({ height: 200 } as DOMRect);
    mount('[data-testid="user-input-step"]', step);
    await settle();
    const button = step.querySelector<HTMLButtonElement>(".willow-bubble-toggle-btn")!;
    expect(button.getAttribute("aria-label")).toBe("Expand");
    const before = step.innerHTML;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(step, { attributes: true, childList: true, characterData: true, subtree: true });
    try {
      for (let i = 0; i < 10; i++) resizes.get(text)?.();
      await settle();
      expect(step.innerHTML).toBe(before);
      expect(mutations).toHaveLength(0);
      button.click();
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(button.getAttribute("aria-label")).toBe("Collapse");
      expect(step.querySelector<HTMLElement>(".flex-1")!.style.getPropertyValue("--willow-expanded-height")).toBe("224px");
      button.click();
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(step.querySelector(".willow-bubble-icon")?.textContent).toBe("expand_more");
    } finally {
      observer.disconnect();
    }
  });

  it("rebinds an existing bubble once after reload using its current height", async () => {
    startPlugin();
    document.body.innerHTML = '<div data-testid="user-input-step"><div data-testid="lifted-context-menu-trigger"><div class="bg-card"><div class="flex-1"><div class="whitespace-pre-wrap">A long user message</div></div></div></div></div>';
    const step = document.querySelector<HTMLElement>('[data-testid="user-input-step"]')!;
    const text = step.querySelector<HTMLElement>(".whitespace-pre-wrap")!;
    let height = 200;
    vi.spyOn(text, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
    mount('[data-testid="user-input-step"]', step);
    await settle();
    const button = step.querySelector<HTMLButtonElement>(".willow-bubble-toggle-btn")!;
    stopPlugin();
    height = 320;
    startPlugin();
    mount('[data-testid="user-input-step"]', step);
    await settle();
    expect(step.querySelector(".willow-bubble-toggle-btn")).toBe(button);
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(step.querySelector<HTMLElement>(".flex-1")!.style.getPropertyValue("--willow-expanded-height")).toBe("344px");
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps image attachments outside the text clip across expand, resize, and reload", async () => {
    startPlugin();
    document.body.innerHTML = '<div data-testid="user-input-step"><div data-testid="lifted-context-menu-trigger"><div class="bg-card"><div class="flex-1"><div data-no-scroll-jump><img alt="User uploaded media"></div><div class="whitespace-pre-wrap">A long user message</div></div></div></div></div>';
    const step = document.querySelector<HTMLElement>('[data-testid="user-input-step"]')!;
    const flex = step.querySelector<HTMLElement>(".flex-1")!;
    const strip = step.querySelector<HTMLElement>("[data-no-scroll-jump]")!;
    const text = step.querySelector<HTMLElement>(".whitespace-pre-wrap")!;
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("willow-bubble-clip") ? 180 + (this.dataset.geminiExpanded === "true" ? 24 : 0) : 0;
    });
    mount('[data-testid="user-input-step"]', step);
    for (let cycle = 0; cycle < 2; cycle++) {
      await settle();
      const clip = text.querySelector<HTMLElement>(".willow-bubble-clip")!;
      const button = text.querySelector<HTMLButtonElement>(".willow-bubble-toggle-btn")!;
      expect(strip.parentElement).toBe(flex);
      expect(clip.querySelector("img")).toBeNull();
      expect(text.querySelectorAll(".willow-bubble-clip")).toHaveLength(1);
      button.click();
      expect(button.getAttribute("aria-expanded")).toBe("true");
      resizes.get(text)?.();
      await settle();
      expect(clip.style.getPropertyValue("--willow-expanded-height")).toBe("204px");
      expect(strip.parentElement).toBe(flex);
      button.click();
      expect(button.getAttribute("aria-expanded")).toBe("false");
      stopPlugin();
      startPlugin();
      mount('[data-testid="user-input-step"]', step);
    }
  });

  it("measures all newly mounted and resized bubbles before updating their controls", async () => {
    startPlugin();
    document.body.innerHTML = Array.from({ length: 3 }, (_, index) =>
      `<div data-testid="user-input-step"><div data-testid="lifted-context-menu-trigger"><div class="bg-card"><div class="flex-1"><div class="whitespace-pre-wrap">Message ${index}</div></div></div></div></div>`
    ).join("");
    const steps = [...document.querySelectorAll<HTMLElement>('[data-testid="user-input-step"]')];
    const events: string[] = [];
    let height = 180;
    for (const [index, step] of steps.entries()) {
      const text = step.querySelector<HTMLElement>(".whitespace-pre-wrap")!;
      const clamp = step.querySelector<HTMLElement>(".flex-1")!;
      vi.spyOn(text, "getBoundingClientRect").mockImplementation(() => {
        events.push(`read ${index}`);
        return { height } as DOMRect;
      });
      const setAttribute = clamp.setAttribute.bind(clamp);
      vi.spyOn(clamp, "setAttribute").mockImplementation((name, value) => {
        events.push(`write ${index}`);
        setAttribute(name, value);
      });
      mount('[data-testid="user-input-step"]', step);
    }
    await settle();
    expect(events.slice(0, 3)).toEqual(["read 0", "read 1", "read 2"]);
    expect(document.querySelectorAll(".willow-bubble-toggle-btn")).toHaveLength(3);

    events.length = 0;
    height = 96;
    for (let burst = 0; burst < 8; burst++) {
      for (const step of steps) resizes.get(step.querySelector(".whitespace-pre-wrap")!)?.();
    }
    await settle();
    expect(events.filter(event => event.startsWith("read"))).toEqual(["read 0", "read 1", "read 2"]);
    expect(document.querySelectorAll(".willow-bubble-toggle-btn")).toHaveLength(0);
  });

  it("cancels queued bubble work when the plugin stops", async () => {
    startPlugin();
    document.body.innerHTML = '<div data-testid="user-input-step"><div data-testid="lifted-context-menu-trigger"><div class="bg-card"><div class="flex-1"><div class="whitespace-pre-wrap">Message</div></div></div></div></div>';
    const step = document.querySelector<HTMLElement>('[data-testid="user-input-step"]')!;
    const measure = vi.spyOn(step.querySelector<HTMLElement>(".whitespace-pre-wrap")!, "getBoundingClientRect");
    const before = step.innerHTML;
    mount('[data-testid="user-input-step"]', step);
    stopPlugin();
    await settle();
    expect(measure).not.toHaveBeenCalled();
    expect(step.innerHTML).toBe(before);
    expect(resizes.size).toBe(0);
  });

  it("removes native sidebar handlers and restores both live React fibers on dispose", () => {
    startPlugin();
    document.body.innerHTML = '<button data-testid="sidebar-toggle" aria-label="Toggle Sidebar" aria-expanded="true"></button><div class="bg-sidebar"><button class="group/headerbtn"><span class="truncate">Project</span></button></div>';
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle"]')!;
    const heading = document.querySelector<HTMLButtonElement>('[class="group/headerbtn"]')!;
    const toggleAdds = vi.spyOn(toggle, "addEventListener");
    const toggleRemoves = vi.spyOn(toggle, "removeEventListener");
    const headingAdds = vi.spyOn(heading, "addEventListener");
    const headingRemoves = vi.spyOn(heading, "removeEventListener");
    mount('button[data-testid="sidebar-toggle"][aria-label="Toggle Sidebar"]', toggle);
    mount('.group\\/headerbtn, button[class*="group/headerbtn"]', heading);
    const original = () => null;
    const fiber = { type: original, alternate: { type: original } };
    helpers.wrapItems(fiber);
    expect(fiber.type).not.toBe(original);
    expect(fiber.alternate.type).toBe(fiber.type);
    stopPlugin();
    expect(fiber.type).toBe(original);
    expect(fiber.alternate.type).toBe(original);
    for (const [adds, removes] of [[toggleAdds, toggleRemoves], [headingAdds, headingRemoves]] as const) {
      for (const [type, listener] of adds.mock.calls) {
        expect(removes.mock.calls.some(([removedType, removedListener]) => type === removedType && listener === removedListener), `Leaked ${type} handler`).toBe(true);
      }
    }
  });

  it("listens for schedule dropdown dismissal only while a dropdown is open", async () => {
    startPlugin();
    document.body.innerHTML = '<div data-testid="sidecars-view" data-sidecar-type="schedule"><div class="w-full max-w-2xl"><div class="flex items-center justify-between"></div><div data-testid="sidecar-list-empty"></div></div></div>';
    const view = document.querySelector<HTMLElement>('[data-testid="sidecars-view"]')!;
    mount('[data-testid="sidecars-view"][data-sidecar-type="schedule"]', view);
    await settle();
    const adds = vi.spyOn(document, "addEventListener");
    const removes = vi.spyOn(document, "removeEventListener");
    view.querySelector<HTMLButtonElement>('[data-gemini-action="create-manually"]')!.click();
    await settle();
    const dismissalAdds = () => adds.mock.calls.filter(([, listener]) => /^(docClickListener|keyListener)$/.test((listener as Function).name));
    expect(dismissalAdds()).toHaveLength(0);

    const triggers = view.querySelectorAll<HTMLButtonElement>(".spark-schedule-custom-select__trigger");
    triggers[0]!.click();
    expect(dismissalAdds()).toHaveLength(2);
    const firstDismissalHandlers = dismissalAdds();
    triggers[1]!.click();
    expect(triggers[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(triggers[1]!.getAttribute("aria-expanded")).toBe("true");
    for (const [type, listener] of firstDismissalHandlers) {
      expect(removes.mock.calls.some(([removedType, removedListener]) => type === removedType && listener === removedListener)).toBe(true);
    }
    document.body.click();
    expect(triggers[1]!.getAttribute("aria-expanded")).toBe("false");
    for (const [type, listener] of dismissalAdds()) {
      expect(removes.mock.calls.some(([removedType, removedListener]) => type === removedType && listener === removedListener)).toBe(true);
    }

    const container = view.querySelector<HTMLElement>(".max-w-2xl")!;
    await settle();
    const queries = vi.spyOn(container, "querySelector");
    view.querySelector(".spark-schedule-editor")!.append(document.createElement("span"));
    await settle();
    expect(queries.mock.calls.filter(([selector]) => selector === '[data-testid="sidecar-list-empty"]')).toHaveLength(0);
  });

  it("does not display a skeleton animation when schedule data is already loaded", async () => {
    startPlugin();
    document.body.innerHTML = '<div data-testid="sidecars-view" data-sidecar-type="schedule"><div class="w-full max-w-2xl"><div class="flex items-center justify-between"></div><div data-testid="sidecar-list-empty"></div></div></div>';
    const view = document.querySelector<HTMLElement>('[data-testid="sidecars-view"]')!;
    mount('[data-testid="sidecars-view"][data-sidecar-type="schedule"]', view);
    await settle();

    // Data was already loaded at mount: skeleton must NOT appear
    expect(view.querySelector(".spark-customise-loading-section")).toBeNull();
    const container = view.querySelector<HTMLElement>(".max-w-2xl")!;
    expect(container.classList.contains("is-loading")).toBe(false);
    const emptyList = view.querySelector<HTMLElement>('[data-testid="sidecar-list-empty"]')!;
    expect(emptyList.style.display).toBe("");
  });

  it("shows the skeleton animation only while data is loading and hides the schedule list underneath", async () => {
    startPlugin();
    // Start with empty container (data has not arrived yet)
    document.body.innerHTML = '<div data-testid="sidecars-view" data-sidecar-type="schedule"><div class="w-full max-w-2xl"><div class="flex items-center justify-between"></div></div></div>';
    const view = document.querySelector<HTMLElement>('[data-testid="sidecars-view"]')!;
    mount('[data-testid="sidecars-view"][data-sidecar-type="schedule"]', view);

    const container = view.querySelector<HTMLElement>(".max-w-2xl")!;
    // Skeleton is shown because data is not yet loaded
    expect(view.querySelector(".spark-customise-loading-section")).not.toBeNull();
    expect(container.classList.contains("is-loading")).toBe(true);

    // Add list while still in loading observer
    const list = document.createElement("div");
    list.setAttribute("data-testid", "sidecar-list");
    const row = document.createElement("div");
    row.setAttribute("data-testid", "sidecar-row");
    list.appendChild(row);
    container.appendChild(list);

    await settle();
    // Once data arrives, skeleton is removed, is-loading is removed, and list is displayed
    expect(view.querySelector(".spark-customise-loading-section")).toBeNull();
    expect(container.classList.contains("is-loading")).toBe(false);
    expect(list.style.display).toBe("");
    expect(view.querySelector(".spark-schedules-heading")).not.toBeNull();
  });

  it("does not lock the conversation row resting container with inline display none", async () => {
    startPlugin();
    document.body.innerHTML = `
      <div data-testid="conversation-row-sidebar" data-cascade-id="c1">
        <div class="pointer-events-auto">
          <div>
            <div class="absolute"><button data-testid="conversation-pin-button" aria-label="Pin conversation"></button></div>
            <div class="flex items-center gap-1.5 group-hover:opacity-0">
              <span data-screenshot-volatile="true">2m</span>
            </div>
          </div>
        </div>
      </div>
    `;
    const row = document.querySelector<HTMLElement>('[data-testid="conversation-row-sidebar"]')!;
    const resting = row.querySelector<HTMLElement>('[class*="group-hover:opacity-0"]')!;
    mount('[data-testid="conversation-row-sidebar"]', row);
    await settle();

    // The resting container must NOT have inline display: none !important
    expect(resting.style.display).toBe("");

    // Simulate chat becoming working: React mounts spinner inside resting
    const spinner = document.createElement("svg");
    spinner.setAttribute("data-testid", "status-loading-spinner");
    spinner.setAttribute("class", "animate-spin");
    resting.appendChild(spinner);
    await settle();

    // Resting container remains clean without inline display: none
    expect(resting.style.display).toBe("");
  });
});

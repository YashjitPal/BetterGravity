// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySourcePatches, readPatches } from "../src/main/source-patch.js";

const manifest = JSON.parse(readFileSync("community/plugins/gemini-app/plugin.json", "utf8"));
const patches = readPatches("gemini-app", manifest)!.patches;

function apply(anchor: string, source: string): string {
  const patch = patches.find(candidate => candidate.find === anchor);
  expect(patch).toBeDefined();
  const result = applySourcePatches(`/* ${anchor} */\n${source}`, [{ pluginId: "gemini-app", patches: [patch!] }]);
  expect(result.failures).toEqual([]);
  expect(result.changed).toBe(true);
  return result.source;
}

async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

it("matches the scroll-edge hook quickly after a long embedded asset", () => {
  const prefix = `const embeddedAsset="${"a".repeat(256 * 1024)}";`;
  const hook = `function watch(scroller){var update=()=>{};var resize=new ResizeObserver(update);resize.observe(scroller);Array.from(scroller.children).forEach(child=>resize.observe(child));var mutations=new MutationObserver(nodes=>{nodes.forEach(node=>{node instanceof Element&&resize.unobserve(node)});update()});mutations.observe(scroller,{childList:!0});update();return()=>{resize.disconnect();mutations.disconnect()}}`;
  const started = performance.now();
  const result = apply("startThreshold", prefix + hook);
  const elapsed = performance.now() - started;
  expect(result).toContain(prefix);
  expect(result).toContain("new ResizeObserver(bgSoon)");
  expect(result).toContain("bgFrame&&cancelAnimationFrame(bgFrame)");
  expect(() => new Function(result)).not.toThrow();
  // Without the leading word boundary the search retries from every character
  // inside the asset, taking seconds before it ever reaches the hook.
  expect(elapsed).toBeLessThan(500);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

// The native ref path, including its immediate observer registration and
// scrolling guard. The full installed bundle is also checked during deployment.
const rowSource = `var IWa=class{constructor(a){this.unsubs=[];this.targetWindow=this.scrollElement=null;
Object.assign(this,a);this.measureElement=b=>{if(b){var c=this.indexFromElement(b),e=this.options.getItemKey(c),f=this.elementsCache.get(e);
f!==b&&(f&&this.observer.unobserve(f),this.observer.observe(b),this.elementsCache.set(e,b));
this.isScrolling&&!this.scrollState||!this.shouldMeasureDuringScroll(c)||this.resizeItem(c,this.options.measureElement(b,
void 0,this))}else this.elementsCache.forEach((g,h)=>{g.isConnected||(this.observer.unobserve(g),this.elementsCache.delete(h))})}}};`;

function rowFixture(testId = "conversation-list-sidebar") {
  const code = apply("pinnedPlaceholderHeight", rowSource);
  const NativeList = new Function(`${code}\nreturn IWa;`)();
  const scroller = document.createElement("div");
  scroller.dataset.testid = testId;
  document.body.append(scroller);
  const events: string[] = [];
  const measure = vi.fn((node: HTMLElement) => {
    events.push(`read ${node.dataset.index}`);
    return 32 + Number(node.dataset.index);
  });
  const resize = vi.fn((index: number, size: number) => events.push(`write ${index}:${size}`));
  const observer = { observe: vi.fn(), unobserve: vi.fn() };
  const instance = new NativeList({
    scrollElement: scroller,
    elementsCache: new Map(),
    options: { getItemKey: (index: number) => `row-${index}`, measureElement: measure },
    indexFromElement: (node: HTMLElement) => Number(node.dataset.index),
    shouldMeasureDuringScroll: () => true,
    isScrolling: false,
    scrollState: null,
    observer,
    resizeItem: resize
  });
  const row = (index: number) => {
    const node = document.createElement("div");
    node.dataset.index = String(index);
    scroller.append(node);
    return node;
  };
  return { instance, row, events, measure, resize, observer };
}

describe("Gemini App native measurement patches", () => {
  it("registers rows immediately and reads all their sizes before notifying React", async () => {
    const { instance, row, events, observer } = rowFixture();
    const first = row(0), second = row(1);
    instance.measureElement(first);
    instance.measureElement(second);
    instance.measureElement(first);
    expect(observer.observe.mock.calls.map(([node]) => node)).toEqual([first, second]);
    expect(events).toEqual([]);
    await settle();
    expect(events).toEqual(["read 0", "read 1", "write 0:32", "write 1:33"]);
  });

  it("drops removed, replaced, and reused rows before deferred measurements", async () => {
    const { instance, row, measure, resize } = rowFixture();
    const removed = row(0), replaced = row(1), reused = row(2);
    instance.measureElement(removed);
    instance.measureElement(replaced);
    instance.measureElement(reused);
    removed.remove();
    const replacement = row(1);
    instance.measureElement(replacement);
    reused.dataset.index = "3";
    await settle();
    expect(measure.mock.calls.map(([node]) => node)).toEqual([replacement]);
    expect(resize).toHaveBeenCalledExactlyOnceWith(1, 33);
  });

  it("keeps native scrolling guards and other virtual lists synchronous", async () => {
    const { instance, row, measure } = rowFixture();
    instance.isScrolling = true;
    instance.measureElement(row(0));
    await settle();
    expect(measure).not.toHaveBeenCalled();
    instance.isScrolling = false;
    instance.measureElement(row(1));
    instance.isScrolling = true;
    await settle();
    expect(measure).not.toHaveBeenCalled();

    const other = rowFixture("code-lines");
    other.instance.measureElement(other.row(0));
    expect(other.events).toEqual(["read 0", "write 0:32"]);
  });
});

describe("Gemini App native color cache", () => {
  it("ignores conversation title changes but invalidates styles, links, and root colors", async () => {
    let color = "red";
    const computed = vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ getPropertyValue: () => color }) as unknown as CSSStyleDeclaration);
    const code = apply("--sidebar-secondary --sidebar-muted --content --card --border --accent", `
function whb(){if(typeof document==="undefined")return{};var a=getComputedStyle(document.documentElement);return{color:a.getPropertyValue("--background")}}
var z={useCallback:fn=>fn},e={current:{}},f=(0,z.useCallback)(()=>{var k=whb(),l=JSON.stringify(k);e.current.key!==l&&(e.current={key:l,value:k});return e.current.value},[]);`);
    const cache = new Function(`${code}\nreturn { read: whb, close: () => bgThemeWatch?.disconnect() };`)();
    try {
      const first = cache.read();
      const title = document.createElement("title");
      document.head.append(title);
      title.textContent = "Another conversation";
      await settle();
      expect(cache.read()).toBe(first);
      expect(computed).toHaveBeenCalledTimes(1);

      const style = document.createElement("style");
      document.head.append(style);
      color = "blue";
      style.textContent = ":root { --background: blue; }";
      await settle();
      expect(cache.read()).toEqual({ color: "blue" });
      color = "green";
      style.firstChild!.textContent = ":root { --background: green; }";
      await settle();
      expect(cache.read()).toEqual({ color: "green" });

      const link = document.createElement("link");
      link.rel = "stylesheet";
      document.head.append(link);
      await settle();
      cache.read();
      color = "purple";
      link.media = "print";
      await settle();
      expect(cache.read()).toEqual({ color: "purple" });

      color = "orange";
      document.documentElement.style.setProperty("--background", color);
      expect(cache.read()).toEqual({ color: "orange" });
      color = "black";
      style.remove();
      await settle();
      expect(cache.read()).toEqual({ color: "black" });
    } finally {
      cache.close();
    }
  });
});

const scrollSource = `var HM=({threshold:a=25,smoothScroll:b=!1,viewport:f})=>{
var g={current:null},h={current:!0},n=()=>{};
var r=(0,z.useCallback)(()=>{var t=f.current;t&&(b?t.scrollTo({top:t.scrollHeight,behavior:"smooth"}):t.scrollTo({top:t.scrollHeight,
behavior:"instant"}))},[b]);var c=(0,z.useCallback)(()=>{h.current=!0;r()},[r]);return{viewportRef:f,contentRef:g,disableTemporarily:n,forceScrollToBottom:c}};`;

function scrollFactory() {
  const code = apply("disableTemporarily", scrollSource);
  const callbacks: Array<() => void> = [];
  const create = new Function("z", `${code}\nreturn HM;`)({ useCallback: (fn: () => void) => { callbacks.push(fn); return fn; } });
  return (options: { viewport: { current: HTMLElement }; smoothScroll?: boolean }) => {
    callbacks.length = 0;
    const hook = create(options);
    return { automatic: callbacks[0]!, manual: hook.forceScrollToBottom as () => void };
  };
}

function scrollViewport(conversation = true) {
  const view = document.createElement("div"), node = document.createElement("div");
  if (conversation) view.dataset.testid = "conversation-view";
  view.append(node); document.body.append(view);
  const read = vi.fn(() => 600);
  Object.defineProperty(node, "scrollHeight", { get: read });
  node.scrollTo = vi.fn();
  return { view, node, read, ref: { current: node } };
}

describe("Gemini App native output scrolling", () => {
  it("lets an entrance own initial positioning and hands an explicit jump back to the user", async () => {
    vi.stubGlobal("__bettergravityGeminiManualScroll", {});
    const viewport = scrollViewport(), scroll = scrollFactory()({ viewport: viewport.ref });
    let owned = true;
    const entrance = { ownsViewport: (node: Element) => owned && node === viewport.node, interruptScroll: vi.fn(() => { owned = false; }) };
    vi.stubGlobal("__bettergravityGeminiSendEntrance", entrance);
    scroll.automatic(); await settle();
    expect(viewport.read).not.toHaveBeenCalled();
    expect(viewport.node.scrollTo).not.toHaveBeenCalled();
    owned = false;
    scroll.automatic(); await settle();
    expect(viewport.node.scrollTo).not.toHaveBeenCalled();
    owned = true;
    scroll.manual(); await settle();
    expect(entrance.interruptScroll).toHaveBeenCalledExactlyOnceWith(viewport.node);
    expect(viewport.node.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: "instant" });
    vi.mocked(viewport.node.scrollTo).mockClear();
    scroll.automatic(); await settle();
    expect(viewport.node.scrollTo).not.toHaveBeenCalled();
  });

  it("drops a queued initial scroll if the send entrance claims the viewport before flushing", async () => {
    const viewport = scrollViewport(), scroll = scrollFactory()({ viewport: viewport.ref });
    scroll.automatic();
    vi.stubGlobal("__bettergravityGeminiSendEntrance", { ownsViewport: () => true });
    await settle();
    expect(viewport.read).not.toHaveBeenCalled();
    expect(viewport.node.scrollTo).not.toHaveBeenCalled();
  });

  it("reads current heights together and preserves instant and smooth scrolling", async () => {
    const createScroll = scrollFactory();
    const events: string[] = [];
    let height = 100;
    const refs = [false, true].map((smoothScroll, index) => {
      const node = document.createElement("div");
      document.body.append(node);
      Object.defineProperty(node, "scrollHeight", { get: () => { events.push(`read ${index}`); return height; } });
      node.scrollTo = vi.fn((options: ScrollToOptions) => { events.push(`scroll ${index}:${options.top}:${options.behavior}`); height += 20; }) as typeof node.scrollTo;
      const ref = { current: node };
      return { ref, scroll: createScroll({ viewport: ref, smoothScroll }).automatic };
    });
    for (let i = 0; i < 5; i++) for (const { scroll } of refs) scroll();
    height = 250;
    await settle();
    expect(events).toEqual(["read 0", "read 1", "scroll 0:250:instant", "scroll 1:250:smooth"]);
  });

  it("does not scroll a viewport that was replaced or removed before the flush", async () => {
    const createScroll = scrollFactory();
    const oldNode = document.createElement("div");
    const newNode = document.createElement("div");
    document.body.append(oldNode, newNode);
    oldNode.scrollTo = vi.fn();
    newNode.scrollTo = vi.fn();
    const ref = { current: oldNode };
    const scroll = createScroll({ viewport: ref }).automatic;
    scroll();
    ref.current = newNode;
    await settle();
    expect(oldNode.scrollTo).not.toHaveBeenCalled();
    scroll();
    newNode.remove();
    await settle();
    expect(newNode.scrollTo).not.toHaveBeenCalled();
  });

  it("keeps initial positioning, then suppresses generation scrolls without layout reads or queued work", async () => {
    vi.stubGlobal("__bettergravityGeminiManualScroll", {});
    const viewport = scrollViewport(), scroll = scrollFactory()({ viewport: viewport.ref });
    scroll.automatic();
    await settle();
    expect(viewport.node.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: "instant" });
    viewport.read.mockClear(); vi.mocked(viewport.node.scrollTo).mockClear();
    const queue = vi.spyOn(globalThis, "queueMicrotask");
    for (let i = 0; i < 100; i++) scroll.automatic();
    await settle();
    expect(queue).not.toHaveBeenCalled();
    expect(viewport.read).not.toHaveBeenCalled();
    expect(viewport.node.scrollTo).not.toHaveBeenCalled();
    scroll.manual();
    await settle();
    expect(viewport.node.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: "instant" });
    vi.mocked(viewport.node.scrollTo).mockClear();
    scroll.automatic();
    await settle();
    expect(viewport.node.scrollTo).not.toHaveBeenCalled();
  });

  it("retains native following outside conversations and restores it when Gemini App is disabled", async () => {
    vi.stubGlobal("__bettergravityGeminiManualScroll", {});
    const createScroll = scrollFactory();
    const chat = scrollViewport(), other = scrollViewport(false);
    const chatScroll = createScroll({ viewport: chat.ref }), otherScroll = createScroll({ viewport: other.ref, smoothScroll: true });
    chatScroll.automatic(); otherScroll.automatic(); await settle();
    vi.mocked(chat.node.scrollTo).mockClear(); vi.mocked(other.node.scrollTo).mockClear();
    chatScroll.automatic(); otherScroll.automatic(); await settle();
    expect(chat.node.scrollTo).not.toHaveBeenCalled();
    expect(other.node.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: "smooth" });
    vi.stubGlobal("__bettergravityGeminiManualScroll", undefined);
    chatScroll.automatic(); await settle();
    expect(chat.node.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: "instant" });
  });

  it("rechecks queued automatic scrolls if the plugin becomes active before flushing", async () => {
    const viewport = scrollViewport(), scroll = scrollFactory()({ viewport: viewport.ref });
    scroll.automatic(); await settle();
    viewport.read.mockClear(); vi.mocked(viewport.node.scrollTo).mockClear();
    scroll.automatic();
    vi.stubGlobal("__bettergravityGeminiManualScroll", {});
    await settle();
    expect(viewport.read).not.toHaveBeenCalled();
    expect(viewport.node.scrollTo).not.toHaveBeenCalled();
  });

  it("preserves an explicit jump when a later automatic request joins the same batch", async () => {
    const viewport = scrollViewport(), scroll = scrollFactory()({ viewport: viewport.ref, smoothScroll: true });
    scroll.automatic(); await settle();
    vi.mocked(viewport.node.scrollTo).mockClear();
    scroll.manual(); scroll.automatic();
    vi.stubGlobal("__bettergravityGeminiManualScroll", {});
    await settle();
    expect(viewport.node.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: "smooth" });
  });

  it("leaves a changed host entirely native when the manual-jump guard no longer matches", () => {
    const patch = patches.find(candidate => candidate.find === "disableTemporarily")!;
    const changed = scrollSource.replace("forceScrollToBottom:c", "newJumpCallback:c");
    const result = applySourcePatches(changed, [{ pluginId: "gemini-app", patches: [patch] }]);
    expect(result.failures).toHaveLength(1);
    expect(result.source).toBe(changed);
    expect(() => new Function(result.source)).not.toThrow();
  });
});

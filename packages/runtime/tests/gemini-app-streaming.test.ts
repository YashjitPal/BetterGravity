// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySourcePatches, readPatches } from "../src/main/source-patch.js";

const source = readFileSync("community/plugins/gemini-app/index.js", "utf8");
const revealSource = source.slice(source.indexOf("function nextGeminiRevealLength("), source.indexOf("const geminiStreamingReveal ="));
const { nextGeminiRevealLength, createGeminiRevealSession, sameGeminiCodeProps, createGeminiTurnRevealGate, createGeminiStreamingReveal } = new Function(
  `${revealSource}\nreturn { nextGeminiRevealLength, createGeminiRevealSession, sameGeminiCodeProps, createGeminiTurnRevealGate, createGeminiStreamingReveal };`
)();

type Tree = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: Tree[]; position?: { start: { offset: number }; end: { offset: number } } };
const position = (start: number, end: number) => ({ start: { offset: start }, end: { offset: end } });
const text = (value: string, start = 0, end = start + value.length): Tree => ({ type: "text", value, position: position(start, end) });
const element = (tagName: string, children: Tree[], start: number, end: number): Tree => ({ type: "element", tagName, children, position: position(start, end) });
const paragraph = (value: string): Tree => ({ type: "root", children: [element("p", [text(value)], 0, value.length)] });
const content = (tree: Tree): string => tree.value ?? tree.children?.map(content).join("") ?? "";
const find = (tree: Tree, predicate: (node: Tree) => boolean): Tree[] => [
  ...(predicate(tree) ? [tree] : []), ...(tree.children?.flatMap(child => find(child, predicate)) ?? [])
];
const fades = (tree: Tree) => find(tree, node => node.tagName === "bg-gemini-reveal");
const clock = { now: () => Date.now(), setTimeout, clearTimeout };

function mount(initial = "", streaming = true, quiet = false, parse = paragraph) {
  const session = createGeminiRevealSession(initial, streaming, quiet, { ...clock, setTimeout, clearTimeout });
  let tree = paragraph("");
  let renders = 0;
  const render = () => {
    renders++;
    tree = parse(session.getSnapshot().shown);
    session.decorate(tree, session.getSnapshot().shown);
    session.schedule();
  };
  session.subscribe(render);
  render();
  session.resume();
  return { session, render, get tree() { return tree; }, get renders() { return renders; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  document.body.replaceChildren(); document.head.replaceChildren();
});

describe("Gemini streaming cadence", () => {
  it("promotes the earliest sentence or paragraph and makes progress without punctuation", () => {
    const sentence = "One sentence. Another sentence.";
    expect(sentence.slice(0, nextGeminiRevealLength(sentence, 0))).toBe("One sentence. ");
    expect(nextGeminiRevealLength("First\n\nSecond", 0)).toBe(7);
    expect(nextGeminiRevealLength("a b c d e", 0)).toBe(4);
    expect(nextGeminiRevealLength("unbroken-token", 0)).toBe(14);
  });

  it("does no animation or timer work for completed history or a long running reply on navigation", () => {
    const history = mount("Already complete.", false);
    expect(history.session.getSnapshot()).toEqual({ shown: "Already complete.", active: false, revealing: false });
    expect(fades(history.tree)).toHaveLength(0);
    const long = mount("Existing history. ".repeat(200));
    expect(content(long.tree)).toBe("Existing history. ".repeat(200));
    expect(fades(long.tree)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a promotion anchored when tokens arrive faster than its cadence", () => {
    const view = mount();
    view.session.update("a", true);
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(5);
      view.session.update("a".repeat(i + 2), true);
    }
    expect(view.session.getSnapshot().shown).toBe("");
    vi.advanceTimersByTime(5);
    expect(view.session.getSnapshot().shown).toBe("a".repeat(10));
    expect(fades(view.tree)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("drains a final buffered chunk and lets its fade finish after generation stops", () => {
    const view = mount();
    view.session.update("Final buffered words", true);
    view.session.update("Final buffered words", false);
    vi.advanceTimersByTime(320);
    expect(content(view.tree)).toBe("Final buffered words");
    expect(fades(view.tree).length).toBeGreaterThan(0);
    expect(view.session.getSnapshot().active).toBe(true);
    vi.advanceTimersByTime(760);
    expect(view.session.getSnapshot().active).toBe(false);
    expect(fades(view.tree)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns to plain text during a provider pause and has no idle tick", () => {
    const view = mount("Fresh text");
    expect(fades(view.tree)).toHaveLength(1);
    vi.advanceTimersByTime(760);
    expect(fades(view.tree)).toHaveLength(0);
    const renders = view.renders;
    vi.advanceTimersByTime(60_000);
    expect(view.renders).toBe(renders);
    expect(vi.getTimerCount()).toBe(0);
    view.session.update("Fresh text keeps going", true);
    vi.advanceTimersByTime(320);
    expect(content(view.tree)).toBe("Fresh text keeps going");
    expect(fades(view.tree).map(content).join("")).toBe(" keeps going");
  });

  it("applies contractions immediately and resets replacements without stale text or timers", () => {
    const view = mount("Original response");
    view.session.update("Original", true);
    expect(content(view.tree)).toBe("Original");
    expect(fades(view.tree)).toHaveLength(0);
    view.session.update("Replacement", true);
    expect(content(view.tree)).toBe("Replacement");
    expect(fades(view.tree)).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(content(view.tree)).toBe("Replacement");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears timer handles on unmount and can resume after a StrictMode cleanup", () => {
    const view = mount();
    view.session.update("a growing response", true);
    view.session.suspend();
    expect(vi.getTimerCount()).toBe(0);
    view.session.resume();
    vi.advanceTimersByTime(320);
    expect(content(view.tree)).toBe("a growing response");
    view.session.suspend();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes pending text on reduced motion, hiding the window, or plugin disposal", () => {
    const view = mount("Initial");
    view.session.update("Initial and pending", true);
    view.session.update("Initial and pending", true, true);
    expect(content(view.tree)).toBe("Initial and pending");
    expect(fades(view.tree)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    view.session.update("Initial and pending", true, false);
    expect(fades(view.tree)).toHaveLength(0);
    view.session.update("Initial and pending more", true);
    vi.advanceTimersByTime(320);
    expect(fades(view.tree).map(content).join("")).toBe(" more");
    view.session.update("Initial and pending more final", true);
    view.session.finish();
    expect(content(view.tree)).toBe("Initial and pending more final");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Gemini native markdown decoration", () => {
  it("uses one opacity run for words in the same promotion and removes it after settling", () => {
    const view = mount("A handful of new words.");
    expect(fades(view.tree)).toHaveLength(1);
    expect(content(view.tree)).toBe("A handful of new words.");
    expect(fades(view.tree)[0]?.properties).toEqual({ "data-reveal-at": 150 });
    vi.advanceTimersByTime(760);
    expect(view.tree).toEqual(paragraph("A handful of new words."));
  });

  it("does not reanimate old words when closing markdown changes their element types", () => {
    const view = mount("Old **bold");
    vi.advanceTimersByTime(760);
    view.session.update("Old **bold** new", true);
    vi.advanceTimersByTime(320);
    const tree = { type: "root", children: [element("p", [
      text("Old "), element("strong", [text("bold", 6, 10)], 4, 12), text(" new", 12, 16)
    ], 0, 16)] };
    view.session.decorate(tree, "Old **bold** new");
    expect(fades(tree).some(node => content(node).includes("bold"))).toBe(false);
    expect(content(tree)).toBe("Old bold new");
  });

  it("preserves escaped/entity text and Unicode when splitting an appended suffix", () => {
    const view = mount("An &amp; example", true, false, value => paragraph(value.replace("&amp;", "&")));
    vi.advanceTimersByTime(760);
    view.session.update("An &amp; example 👋 世界", true);
    vi.advanceTimersByTime(320);
    const tree = element("p", [text("An & example 👋 世界", 0, 22)], 0, 22);
    view.session.decorate(tree, "An &amp; example 👋 世界");
    expect(content(tree)).toBe("An & example 👋 世界");
  });

  it("preserves native code/link string children and does not nest a second fade inside them", () => {
    const value = "[link](url) `code`";
    const session = createGeminiRevealSession(value, true, false, clock);
    const link = element("a", [text("link", 1, 5)], 0, 11);
    link.properties = { href: "url" };
    const code = element("code", [text("code", 13, 17)], 12, 18);
    const tree = element("p", [link, text(" ", 11), code], 0, 18);
    session.decorate(tree, value);
    expect(link.children).toEqual([text("link", 1, 5)]);
    expect(code.children).toEqual([text("code", 13, 17)]);
    expect(link.properties.href).toBe("url");
    expect(fades(tree).every(node => fades(node).length === 1)).toBe(true);
  });

  it("keeps the raw in-progress task prefix for the native checkbox renderer", () => {
    const value = "- [/] Working";
    const session = createGeminiRevealSession(value, true, false, clock);
    const tree = element("li", [text("[/] Working", 2)], 0, value.length);
    session.decorate(tree, value);
    expect(tree.children?.[0]).toEqual({ type: "text", value: "[/] " });
    expect(fades(tree).map(content).join("")).toBe("Working");
    expect(content(tree)).toBe("[/] Working");
  });

  it("shares each list marker's reveal time with its text and bounds burst work", () => {
    const value = "- x\n".repeat(180);
    const session = createGeminiRevealSession("", true, false, { ...clock, setTimeout, clearTimeout });
    session.update(value, true);
    const tree = { type: "root", children: Array.from({ length: 180 }, (_, i) =>
      element("li", [text("x", i * 4 + 2)], i * 4, i * 4 + 4)) };
    session.decorate(tree, value);
    expect(fades(tree).length).toBeLessThanOrEqual(96);
    for (const li of tree.children) {
      const marker = li.properties?.["data-gemini-reveal-marker"];
      if (marker !== undefined && fades(li).length) expect(fades(li)[0]?.properties?.["data-reveal-at"]).toBe(marker);
    }
    expect(Math.max(...fades(tree).map(node => Number(node.properties?.["data-reveal-at"])))).toBeLessThanOrEqual(630);
  });

  it("keeps earlier content static if the native normalizer changes source offsets", () => {
    const view = mount("[file](a b");
    vi.advanceTimersByTime(760);
    const normalized = "[file](<a b>)";
    const tree = paragraph(normalized);
    view.session.decorate(tree, normalized);
    expect(fades(tree)).toHaveLength(0);
    expect(content(tree)).toBe(normalized);
  });
});

describe("Gemini response action completion", () => {
  const css = readFileSync("community/plugins/gemini-app/styles/conversation.css", "utf8");

  beforeEach(() => {
    const style = document.createElement("style");
    style.textContent = css.slice(css.indexOf("/* The response footer row."), css.indexOf("/* Reorder buttons wrapper"));
    document.head.append(style);
  });

  function turnFixture(withFooter = true) {
    const view = document.createElement("div");
    view.dataset.testid = "conversation-view";
    view.innerHTML = `<div class="flex items-start" data-gemini-latest-turn="true">
      <div class="flex flex-col group w-full"><div role="article" aria-label="Agent response">
        <div data-testid="planner-response-text"><div class="markdown"></div></div>
      </div></div></div>`;
    const root = view.querySelector<HTMLElement>(".markdown")!;
    const article = view.querySelector<HTMLElement>('[role="article"]')!;
    const turn = article.parentElement!;
    const footer = document.createElement("div");
    footer.className = "flex w-full items-start gap-1 pl-2 pr-1";
    footer.dataset.geminiTurnActions = "true";
    footer.innerHTML = '<button aria-label="Good response"></button><button aria-label="Bad response"></button><button aria-label="Copy"></button><button data-fork-chat-btn="true" style="pointer-events:auto"></button>';
    if (withFooter) turn.append(footer);
    document.body.append(view);
    return { view, root, article, turn, footer };
  }

  function follow(gate: ReturnType<typeof createGeminiTurnRevealGate>, fixture: ReturnType<typeof turnFixture>, view: ReturnType<typeof mount>) {
    const update = () => gate.update(view.session, fixture.root, view.session.getSnapshot().revealing);
    view.session.subscribe(update);
    update();
  }

  it("hides every action after the API finishes until buffered text and the final fade settle", () => {
    const fixture = turnFixture(), gate = createGeminiTurnRevealGate(), view = mount();
    follow(gate, fixture, view);
    const buttons = [...fixture.footer.children];
    view.session.update("Final buffered words", true);
    view.session.update("Final buffered words", false);
    vi.advanceTimersByTime(320);
    expect(content(view.tree)).toBe("Final buffered words");
    expect(fades(view.tree).length).toBeGreaterThan(0);
    expect(getComputedStyle(fixture.footer).visibility).toBe("hidden");
    expect(getComputedStyle(fixture.footer).opacity).toBe("0");
    for (const button of buttons) expect(getComputedStyle(button).visibility).toBe("hidden");
    vi.advanceTimersByTime(760);
    expect(getComputedStyle(fixture.footer).visibility).toBe("visible");
    expect(getComputedStyle(fixture.footer).opacity).toBe("1");
    expect(getComputedStyle(fixture.footer).display).toBe("flex");
    expect([...fixture.footer.children]).toEqual(buttons);
    expect(fixture.turn.hasAttribute("data-gemini-revealing")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also gates a footer mounted later and future buttons without inspecting their labels", () => {
    const fixture = turnFixture(false), gate = createGeminiTurnRevealGate(), owner = {};
    gate.update(owner, fixture.root, true);
    fixture.turn.append(fixture.footer);
    const future = document.createElement("button");
    future.textContent = "A future action";
    fixture.footer.append(future);
    expect(getComputedStyle(fixture.footer).visibility).toBe("hidden");
    expect(getComputedStyle(future).visibility).toBe("hidden");
    gate.update(owner, fixture.root, false);
    expect(getComputedStyle(future).visibility).toBe("visible");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases actions after a cancelled reply's last fade even if the native animate flag remains true", () => {
    const fixture = turnFixture(), gate = createGeminiTurnRevealGate(), view = mount();
    follow(gate, fixture, view);
    view.session.update("An interrupted response with a buffered tail.", true);
    expect(getComputedStyle(fixture.footer).visibility).toBe("hidden");
    vi.runAllTimers();
    expect(view.session.getSnapshot().active).toBe(true);
    expect(view.session.getSnapshot().revealing).toBe(false);
    expect(content(view.tree)).toBe("An interrupted response with a buffered tail.");
    expect(getComputedStyle(fixture.footer).visibility).toBe("visible");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for every segment of its own turn without hiding a neighboring turn", () => {
    const first = turnFixture(), second = turnFixture(), gate = createGeminiTurnRevealGate();
    const a = {}, b = {}, c = {};
    const secondSegment = first.root.parentElement!.cloneNode(true) as HTMLElement;
    first.article.append(secondSegment);
    gate.update(a, first.root, true);
    gate.update(b, secondSegment.firstElementChild, true);
    gate.update(c, second.root, true);
    gate.update(a, null, false);
    expect(getComputedStyle(first.footer).visibility).toBe("hidden");
    gate.update(b, null, false);
    expect(getComputedStyle(first.footer).visibility).toBe("visible");
    expect(getComputedStyle(second.footer).visibility).toBe("hidden");
    gate.update(c, null, false);
    expect(getComputedStyle(second.footer).visibility).toBe("visible");
  });

  it("releases removed/reused roots and survives StrictMode effect cleanup", () => {
    const first = turnFixture(), second = turnFixture(), gate = createGeminiTurnRevealGate(), owner = {};
    gate.update(owner, first.root, true);
    gate.update(owner, null, false);
    expect(first.turn.hasAttribute("data-gemini-revealing")).toBe(false);
    gate.update(owner, first.root, true);
    expect(first.turn.dataset.geminiRevealing).toBe("true");
    gate.update(owner, second.root, true);
    expect(first.turn.hasAttribute("data-gemini-revealing")).toBe(false);
    expect(second.turn.dataset.geminiRevealing).toBe("true");
    gate.dispose();
    expect(second.turn.hasAttribute("data-gemini-revealing")).toBe(false);
    gate.update(owner, first.root, true);
    expect(first.turn.hasAttribute("data-gemini-revealing")).toBe(false);
  });

  it.each(["reduced motion / hidden window", "disposal"])("releases the row when %s flushes the reveal", reason => {
    const fixture = turnFixture(), gate = createGeminiTurnRevealGate(), view = mount();
    follow(gate, fixture, view);
    view.session.update("A pending final answer", true);
    view.session.update("A pending final answer", false);
    expect(fixture.turn.dataset.geminiRevealing).toBe("true");
    if (reason === "disposal") view.session.finish();
    else view.session.update("A pending final answer", false, true);
    expect(content(view.tree)).toBe("A pending final answer");
    expect(getComputedStyle(fixture.footer).visibility).toBe("visible");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves completed history and unrelated markdown alone, with no repeated attribute writes or timers", () => {
    const fixture = turnFixture(), gate = createGeminiTurnRevealGate(), owner = {};
    const set = vi.spyOn(fixture.turn, "setAttribute"), remove = vi.spyOn(fixture.turn, "removeAttribute");
    follow(gate, fixture, mount("Completed history", false));
    gate.update({}, fixture.article, true);
    expect(set).not.toHaveBeenCalled();
    for (let i = 0; i < 100; i++) gate.update(owner, fixture.root, true);
    expect(set).toHaveBeenCalledExactlyOnceWith("data-gemini-revealing", "true");
    for (let i = 0; i < 100; i++) gate.update(owner, fixture.root, false);
    expect(remove).toHaveBeenCalledExactlyOnceWith("data-gemini-revealing");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Gemini native renderer bridge", () => {
  const manifest = JSON.parse(readFileSync("community/plugins/gemini-app/plugin.json", "utf8"));
  const patch = readPatches("gemini-app", manifest)!.patches.find(item => item.find === 'displayName="CustomMarkdown"')!;
  const fixture = `var VU=z.memo(({markdown:a,MermaidDiagram:b,animate:n})=>{
var N=[],Q=[],I=null,O=a;
var V=(0,z.useMemo)(()=>z.createElement(IA.default,{remarkPlugins:N,rehypePlugins:Q,urlTransform:I,components:Kib},O),[N,Q,I,O]);return z.createElement("div",{className:"native-markdown"},V)});VU.displayName="CustomMarkdown";`;

  it("installs both hook halves once and parses; a changed host remains wholly native", () => {
    const output = applySourcePatches(fixture, [{ pluginId: "gemini-app", patches: [patch] }]);
    expect(output.failures).toEqual([]);
    expect(output.changed).toBe(true);
    expect(() => new Function(output.source)).not.toThrow();
    expect(output.source.match(/bgGeminiReveal:bgGeminiReveal/g)).toHaveLength(1);
    expect(output.source.match(/ref:bgGeminiReveal\?\.ref/g)).toHaveLength(1);
    for (const changed of [fixture.replace("MermaidDiagram", "NewDiagramRenderer"), fixture.replace('"div",{className:', '"section",{className:')]) {
      const skipped = applySourcePatches(changed, [{ pluginId: "gemini-app", patches: [patch] }]);
      expect(skipped.source).toBe(changed);
      expect(skipped.failures).toHaveLength(1);
    }
  });

  it("returns the original renderer when the plugin is absent and preserves its markdown configuration", () => {
    const output = applySourcePatches(fixture, [{ pluginId: "gemini-app", patches: [patch] }]);
    const React = { memo: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) };
    const Markdown = {}, components = { p: "p" };
    const Native = new Function("z", "IA", "Kib", `${output.source};return VU;`)(React, { default: Markdown }, components);
    const props = { markdown: "unchanged", animate: false };
    const nativeElement = Native(props);
    expect(nativeElement.props).toBe(props);
    const tree = nativeElement.type(nativeElement.props);
    expect(tree.children[0].props.components).toBe(components);
    expect(tree.children[0].props.rehypePlugins).toEqual([]);
    expect(tree.children[0].children).toEqual(["unchanged"]);
    expect(tree.props.ref).toBeUndefined();
    const pluginFrame = { components: { ...components, "bg-gemini-reveal": "span" }, ref: vi.fn(), rehype: () => () => {} };
    const enhanced = nativeElement.type({ ...props, bgGeminiReveal: pluginFrame });
    expect(enhanced.children[0].props.components).toBe(pluginFrame.components);
    expect(enhanced.children[0].props.rehypePlugins).toEqual([pluginFrame.rehype]);
    expect(enhanced.type).toBe(tree.type);
    expect(enhanced.props.className).toBe(tree.props.className);
    expect(enhanced.props.ref).toBe(pluginFrame.ref);
  });

  it("uses one shared media/visibility subscription and releases both on disposal", () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const document = { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const bridge = createGeminiStreamingReveal({ performance: { now: () => Date.now() }, setTimeout, clearTimeout, document, matchMedia: () => media });
    expect(media.addEventListener).toHaveBeenCalledOnce();
    expect(document.addEventListener).toHaveBeenCalledOnce();
    bridge.dispose();
    expect(media.removeEventListener).toHaveBeenCalledExactlyOnceWith("change", media.addEventListener.mock.calls[0]?.[1]);
    expect(document.removeEventListener).toHaveBeenCalledExactlyOnceWith("visibilitychange", document.addEventListener.mock.calls[0]?.[1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reuses only unchanged code cards, including their source positions and attributes", () => {
    const first = { children: "const value = 1;", className: "language-js", node: element("code", [text("const value = 1;", 6)], 0, 22) };
    const same = structuredClone(first);
    expect(sameGeminiCodeProps(first, same)).toBe(true);
    expect(sameGeminiCodeProps(first, { ...same, children: "const value = 2;" })).toBe(false);
    expect(sameGeminiCodeProps(first, { ...same, className: "language-ts" })).toBe(false);
    same.node.position!.start.offset = 4;
    expect(sameGeminiCodeProps(first, same)).toBe(false);
    const attributes = structuredClone(first);
    attributes.node.properties = { title: "changed" };
    expect(sameGeminiCodeProps(first, attributes)).toBe(false);
    expect(sameGeminiCodeProps(first, { ...first, title: "extra" })).toBe(false);
    expect(sameGeminiCodeProps({ ...first, old: undefined }, { ...first, replacement: true })).toBe(false);
    expect(sameGeminiCodeProps({ children: {} }, { children: {} })).toBe(false);
  });
});

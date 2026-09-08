// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { desugarHas, hasQuestions } from "../src/world/has.js";

const releases: (() => void)[] = [];

/** Desugars and remembers the release, so module state cannot leak between tests. */
function desugar(css: string): string {
  const result = desugarHas(css);
  releases.push(result.release);
  return result.css;
}

/** Lets the MutationObserver callback and its microtask flush run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  while (releases.length > 0) releases.pop()?.();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("desugarHas rewriting", () => {
  it("leaves stylesheets without :has() completely alone", () => {
    const css = ".a { color: red; }\n@media (min-width: 10px) { .b > .c { top: 0; } }";
    expect(desugar(css)).toBe(css);
  });

  it("removes every :has() and keeps the rest of the rule verbatim", () => {
    const out = desugar('div.card:has(> button[aria-label="Copy"]) { color: red; }');
    expect(out).not.toContain(":has(");
    expect(out).toContain("{ color: red; }");
    expect(out).toMatch(/^div\.card\[data-bg-has-\d+\]/);
  });

  it("keeps declarations, comments and at-rule preludes untouched", () => {
    const css = [
      "/* :has( in a comment */",
      "@media (min-width: 100px) {",
      "  .a:has(.b) { background-image: url(\"a{b}.png\"); }",
      "}"
    ].join("\n");
    const out = desugar(css);
    expect(out).toContain("/* :has( in a comment */");
    expect(out).toContain("@media (min-width: 100px) {");
    expect(out).toContain('background-image: url("a{b}.png");');
    expect(out.match(/:has\(/g)).toHaveLength(1); // only the one in the comment
  });

  it("rewrites a :has() nested inside :not()", () => {
    const out = desugar(".row:not(:has(.dot)) { color: red; }");
    expect(out).not.toContain(":has(");
    expect(out).toMatch(/^\.row:not\(\[data-bg-has-\d+\]\)/);
  });

  it("leaves a rule with :has() inside :has() dropped, as Chromium does", () => {
    const css = "div:has(button:has(circle)) { color: red; }";
    expect(desugar(css)).toBe(css);
  });

  it("leaves arguments that depend on :hover alone", () => {
    const css = ".a:has(.b:hover) { color: red; }";
    expect(desugar(css)).toBe(css);
  });

  it("is idempotent: a second pass finds nothing left to do", () => {
    const once = desugar("div:has(.x) { color: red; }");
    expect(desugar(once)).toBe(once);
  });
});

describe("desugarHas specificity", () => {
  it("pads a type-only argument back to (0,0,1)", () => {
    const out = desugar("div:has(svg) { color: red; }");
    expect(out).toMatch(/^div:where\(\[data-bg-has-\d+\]\):not\(bettergravity-has-pad\)/);
  });

  it("spends the attribute itself on the first class-level unit", () => {
    const out = desugar("div:has(.x) { color: red; }");
    expect(out).toMatch(/^div\[data-bg-has-\d+\] \{/);
  });

  it("pads a two-class argument with one extra class-level unit", () => {
    const out = desugar("div:has(.x .y) { color: red; }");
    expect(out).toMatch(/^div\[data-bg-has-\d+\]:not\(\.bettergravity-has-pad\) \{/);
  });

  it("pads an id argument at the id level", () => {
    const out = desugar("div:has(#a .b) { color: red; }");
    expect(out).toMatch(/^div\[data-bg-has-\d+\]:not\(#bettergravity-has-pad\) \{/);
  });

  it("counts a :has() argument as its heaviest branch, not its longest", () => {
    const out = desugar("div:has(.a, #b, span) { color: red; }");
    expect(out).toMatch(/^div:where\(\[data-bg-has-\d+\]\):not\(#bettergravity-has-pad\) \{/);
  });
});

/**
 * The whole point of the rewrite is that it selects the same elements. These
 * compare the rewritten selector against the `:has()` it replaced by asking the
 * DOM both questions, before and after the kinds of change the app makes.
 */
describe("desugarHas equivalence", () => {
  const shows = (selector: string): string[] =>
    [...document.querySelectorAll(selector)].map((element) => element.getAttribute("data-name") ?? element.localName);

  /** Both selectors must pick the same elements, in the same order. */
  const agree = (original: string, rewritten: string): void => {
    expect(shows(rewritten)).toEqual(shows(original));
  };

  it("jsdom supports :has(), so these comparisons mean something", () => {
    document.body.innerHTML = '<div data-name="a"><span class="x"></span></div><div data-name="b"></div>';
    expect(shows("div:has(.x)")).toEqual(["a"]);
  });

  it("matches the same elements at every ancestor level", async () => {
    document.body.innerHTML = [
      '<div data-name="outer"><div data-name="middle"><p data-name="inner">',
      '<span class="dot"></span></p></div></div>',
      '<div data-name="other"><span></span></div>'
    ].join("");
    const out = desugar("div:has(.dot) { color: red; }");
    await settle();
    agree("div:has(.dot)", out.slice(0, out.indexOf(" {")));
  });

  it("follows a class being added and removed", async () => {
    document.body.innerHTML = '<div data-name="row"><span data-name="dot"></span></div>';
    const out = desugar("div:has(.dot) { color: red; }");
    const rewritten = out.slice(0, out.indexOf(" {"));
    await settle();
    agree("div:has(.dot)", rewritten);

    document.querySelector('[data-name="dot"]')?.classList.add("dot");
    await settle();
    expect(shows(rewritten)).toEqual(["row"]);
    agree("div:has(.dot)", rewritten);

    document.querySelector('[data-name="dot"]')?.classList.remove("dot");
    await settle();
    expect(shows(rewritten)).toEqual([]);
    agree("div:has(.dot)", rewritten);
  });

  it("follows a subtree being inserted and removed", async () => {
    document.body.innerHTML = '<div data-name="host"></div>';
    const out = desugar('div:has(> [data-role="bar"] button) { color: red; }');
    const rewritten = out.slice(0, out.indexOf(" {"));
    await settle();
    expect(shows(rewritten)).toEqual([]);

    const host = document.querySelector('[data-name="host"]');
    const bar = document.createElement("div");
    bar.setAttribute("data-role", "bar");
    bar.innerHTML = "<button></button>";
    host?.append(bar);
    await settle();
    expect(shows(rewritten)).toEqual(["host"]);
    agree('div:has(> [data-role="bar"] button)', rewritten);

    bar.remove();
    await settle();
    expect(shows(rewritten)).toEqual([]);
    agree('div:has(> [data-role="bar"] button)', rewritten);
  });

  it("follows an attribute value changing", async () => {
    document.body.innerHTML = '<div data-name="row"><button aria-expanded="false"></button></div>';
    const out = desugar('div:has(button[aria-expanded="true"]) { color: red; }');
    const rewritten = out.slice(0, out.indexOf(" {"));
    await settle();
    expect(shows(rewritten)).toEqual([]);

    document.querySelector("button")?.setAttribute("aria-expanded", "true");
    await settle();
    expect(shows(rewritten)).toEqual(["row"]);
    agree('div:has(button[aria-expanded="true"])', rewritten);
  });

  it("follows a sibling argument", async () => {
    document.body.innerHTML = '<div data-name="head"></div><div data-name="body"></div>';
    const out = desugar("div:has(+ .panel) { color: red; }");
    const rewritten = out.slice(0, out.indexOf(" {"));
    await settle();
    expect(shows(rewritten)).toEqual([]);

    document.querySelector('[data-name="body"]')?.classList.add("panel");
    await settle();
    expect(shows(rewritten)).toEqual(["head"]);
    agree("div:has(+ .panel)", rewritten);
  });

  it("handles a negated question, where a missing mark is the match", async () => {
    document.body.innerHTML = '<div data-name="quiet"></div><div data-name="loud"><i class="dot"></i></div>';
    const out = desugar("div:not(:has(.dot)) { color: red; }");
    const rewritten = out.slice(0, out.indexOf(" {"));
    await settle();
    expect(shows(rewritten)).toEqual(["quiet"]);
    agree("div:not(:has(.dot))", rewritten);
  });

  /*
   * The subject of a `:has()` is the compound it is attached to, which is often
   * not the compound the rule ends on. Marking the wrong element there is
   * invisible in the rewritten text and fatal to what gets drawn, so each of
   * these puts the question somewhere other than the end.
   */
  it("marks the compound the question is attached to, not the rule's last one", async () => {
    document.body.innerHTML = '<div data-name="card"><span class="dot"></span><b data-name="leaf"></b></div>';
    const out = desugar("div:has(.dot) > b { color: red; }");
    const rewritten = out.slice(0, out.indexOf(" {"));
    await settle();
    expect(shows(rewritten)).toEqual(["leaf"]);
    agree("div:has(.dot) > b", rewritten);
    expect(document.querySelector('[data-name="card"]')?.getAttributeNames()
      .some((name) => name.startsWith("data-bg-has-"))).toBe(true);
    expect(document.querySelector('[data-name="leaf"]')?.getAttributeNames()
      .some((name) => name.startsWith("data-bg-has-"))).toBe(false);
  });

  it("keeps a negated question on its own compound, the composer's shape", async () => {
    document.body.innerHTML = [
      '<div data-name="idle"><i data-name="mark"></i><p class="body" data-name="idle-body"></p></div>',
      '<div data-name="busy"><i class="dot"></i><p class="body" data-name="busy-body"></p></div>'
    ].join("");
    const out = desugar("div:not(:has(.dot)) > .body { color: red; }");
    const rewritten = out.slice(0, out.indexOf(" {"));
    await settle();
    expect(shows(rewritten)).toEqual(["idle-body"]);
    agree("div:not(:has(.dot)) > .body", rewritten);

    document.querySelector('[data-name="mark"]')?.classList.add("dot");
    await settle();
    expect(shows(rewritten)).toEqual([]);
    agree("div:not(:has(.dot)) > .body", rewritten);
  });

  it("follows a question on a middle compound", async () => {
    document.body.innerHTML = [
      '<section><div data-name="wrap"><span class="flag"></span>',
      '<u data-name="deep"></u></div></section>'
    ].join("");
    const out = desugar("section div:has(.flag) u { color: red; }");
    const rewritten = out.slice(0, out.indexOf(" {"));
    await settle();
    expect(shows(rewritten)).toEqual(["deep"]);
    agree("section div:has(.flag) u", rewritten);
  });

  it("takes its marks back off when the stylesheet goes away", async () => {
    document.body.innerHTML = '<div data-name="row"><span class="dot"></span></div>';
    const result = desugarHas("div:has(.dot) { color: red; }");
    await settle();
    expect(document.querySelectorAll("[data-bg-has-0], [class]").length).toBeGreaterThan(0);
    const marked = [...document.querySelectorAll("*")].filter((element) =>
      element.getAttributeNames().some((name) => name.startsWith("data-bg-has-")));
    expect(marked).toHaveLength(1);
    result.release();
    const after = [...document.querySelectorAll("*")].filter((element) =>
      element.getAttributeNames().some((name) => name.startsWith("data-bg-has-")));
    expect(after).toHaveLength(0);
  });
});

/**
 * A question is answered by looking up the elements its argument needs and
 * climbing to their ancestors, rather than by asking the document about every
 * element it holds. That is only allowed to be faster: for each shape below the
 * marks have to name exactly the elements the original `:has()` selects, in a
 * page busy enough that a wrong shortcut would show, and again after the page
 * changes underneath.
 */
describe("desugarHas answers questions the cheap way and gets the same answer", () => {
  const page = [
    '<main data-name="main">',
    '  <div data-name="empty"></div>',
    '  <div data-name="rowA" class="row"><span class="dot" data-role="mark"></span><p class="truncate">a</p></div>',
    '  <div data-name="rowB" class="row"><b data-name="b"><span class="dot"></span></b></div>',
    '  <div data-name="rowC" class="row"><p data-name="pC">c</p></div>',
    '  <section data-name="sect"><div data-name="wrap"><u data-name="u"></u></div></section>',
    '  <div data-name="sibHost"><i data-name="first"></i><b data-name="between"></b>',
    '<i data-name="second" class="late"></i></div>',
    '  <div data-name="deep"><div data-name="d1"><div data-name="d2"><pre data-name="pre"></pre></div></div></div>',
    "</main>"
  ].join("");

  const shapes = [
    "div:has(.dot)",
    "div:has(> .dot)",
    ".row:has(p.truncate)",
    "div:has(.dot) p",
    "section div:has(> u)",
    "div:has(> div > pre)",
    "div:has(*)",
    "div:has(> *)",
    "div:has(:not(.nothing))",
    "i:has(~ .late)",
    "i:has(+ .late)",
    "div:has(i + .late)",
    "div:has(.dot ~ .truncate)",
    'div:has([data-role="mark"])',
    'div:has(span[data-role="mark"], b)',
    "div:not(:has(.dot))",
    "div:has(.dot):has(.truncate)",
    "main > div:has(.dot)"
  ];

  const named = (selector: string): string[] =>
    [...document.querySelectorAll(selector)]
      .map((element) => element.getAttribute("data-name") ?? element.localName)
      .sort();

  /**
   * Every question put to the DOM, and what was asked. Both `document` and
   * elements are watched, since which of the two is asked is the whole point:
   * asking one element about its own subtree is what makes a change cost what the
   * change is worth rather than what the page is worth.
   */
  function watchQueries(): { asked: { root: string; selector: string }[]; stop: () => void } {
    const asked: { root: string; selector: string }[] = [];
    const onDocument = Document.prototype.querySelectorAll;
    const onElement = Element.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function patched(this: Document, selector: string) {
      asked.push({ root: "#document", selector });
      return onDocument.call(this, selector);
    } as typeof Document.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function patched(this: Element, selector: string) {
      asked.push({ root: this.getAttribute("data-name") ?? this.localName, selector });
      return onElement.call(this, selector);
    } as typeof Element.prototype.querySelectorAll;
    return {
      asked,
      stop: () => {
        Document.prototype.querySelectorAll = onDocument;
        Element.prototype.querySelectorAll = onElement;
      }
    };
  }

  it("agrees with the original selector for every shape, before and after a change", async () => {
    for (const shape of shapes) {
      document.body.innerHTML = page;
      const result = desugarHas(`${shape} { color: red; }`);
      const rewritten = result.css.slice(0, result.css.indexOf(" {"));
      await settle();
      expect(named(rewritten), `${shape} at rest`).toEqual(named(shape));

      // The argument's witness arrives somewhere new.
      const host = document.querySelector('[data-name="rowC"]');
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.setAttribute("data-role", "mark");
      host?.append(dot);
      await settle();
      expect(named(rewritten), `${shape} after an insertion`).toEqual(named(shape));

      // And leaves again.
      dot.remove();
      await settle();
      expect(named(rewritten), `${shape} after a removal`).toEqual(named(shape));

      // A class flips on an element that was never a witness.
      document.querySelector('[data-name="pC"]')?.classList.add("truncate");
      await settle();
      expect(named(rewritten), `${shape} after a class change`).toEqual(named(shape));

      // What the argument was finding moves house: a removal in one place and an
      // insertion in another, in the same batch.
      const traveller = document.querySelector('[data-name="rowA"] .dot');
      const newHome = document.querySelector('[data-name="deep"]');
      if (traveller && newHome) newHome.append(traveller);
      await settle();
      expect(named(rewritten), `${shape} after a move`).toEqual(named(shape));

      // The element between two siblings goes. Nothing the argument names has
      // changed - only what now follows what - and a mark can be won that way.
      document.querySelector('[data-name="between"]')?.remove();
      await settle();
      expect(named(rewritten), `${shape} after a sibling is removed`).toEqual(named(shape));

      // An attribute comes off.
      document.querySelector('[data-role="mark"]')?.removeAttribute("data-role");
      await settle();
      expect(named(rewritten), `${shape} after an attribute is removed`).toEqual(named(shape));

      // The whole subtree holding the witnesses is replaced, the way switching
      // conversation replaces one.
      const main = document.querySelector('[data-name="main"]');
      if (main) main.innerHTML = '<div data-name="fresh" class="row"><span class="dot"></span></div>';
      await settle();
      expect(named(rewritten), `${shape} after the page is rebuilt`).toEqual(named(shape));

      result.release();
    }
  });

  it("asks the document by index, never with :has()", async () => {
    document.body.innerHTML = page;
    const spy = watchQueries();
    try {
      const result = desugarHas("div:has(.dot) { color: red; } .row:has(p.truncate) { color: red; }");
      await settle();
      const host = document.querySelector('[data-name="rowC"]');
      host?.append(document.createElement("span"));
      await settle();
      expect(spy.asked).not.toHaveLength(0);
      expect(spy.asked.filter((query) => query.selector.includes(":has("))).toEqual([]);
      result.release();
    } finally {
      spy.stop();
    }
  });

  it("falls back to the document for an argument with nothing to look up", async () => {
    document.body.innerHTML = page;
    const result = desugarHas("div:has(> *) { color: red; }");
    await settle();
    const question = hasQuestions().find((candidate) => candidate.argument.includes("*"));
    expect(question?.seed).toBe("");
    expect(question?.broad).toBe(true);
    const rewritten = result.css.slice(0, result.css.indexOf(" {"));
    expect(named(rewritten)).toEqual(named("div:has(> *)"));
    result.release();
  });

  /**
   * A change in one corner of the page cannot put a mark on anything whose
   * argument is somewhere else, so after the first pass the document is not asked
   * again: the lookup starts at the element that changed. That is what stops the
   * cost of a burst from growing with the size of the page.
   */
  it("searches only where the page changed, not the document, after a small change", async () => {
    document.body.innerHTML = page;
    const result = desugarHas("div:has(.dot) { color: red; } .row:has(p.truncate) { color: red; }");
    await settle();

    const spy = watchQueries();
    try {
      const host = document.querySelector('[data-name="rowC"]');
      const dot = document.createElement("span");
      dot.className = "dot";
      host?.append(dot);
      await settle();
      expect(spy.asked).toEqual([{ root: "rowC", selector: ".dot" }]);
    } finally {
      spy.stop();
    }

    const rewritten = result.css.slice(0, result.css.indexOf(" {"));
    expect(named(rewritten)).toEqual(named("div:has(.dot)"));
    result.release();
  });

  /**
   * The confined search still has to find what sits *beside* what changed, which
   * is where an argument with `+` or `~` in it looks.
   */
  it("finds a sibling argument from a change that is not inside the subject", async () => {
    document.body.innerHTML = '<div data-name="head"></div><div data-name="tail"><i></i></div>';
    const result = desugarHas("div:has(+ div .panel) { color: red; }");
    const rewritten = result.css.slice(0, result.css.indexOf(" {"));
    await settle();
    expect(named(rewritten)).toEqual([]);

    document.querySelector('[data-name="tail"] i')?.classList.add("panel");
    await settle();
    expect(named(rewritten)).toEqual(["head"]);
    expect(named(rewritten)).toEqual(named("div:has(+ div .panel)"));
    result.release();
  });

  /**
   * Some answers are the page's shape rather than its contents: typing a word into
   * an empty paragraph changes no class, id, attribute or tag anywhere, so nothing
   * an index could be keyed on has moved, and the question still has to be asked
   * again.
   */
  it("follows a question about shape, where nothing the argument names has changed", async () => {
    document.body.innerHTML = '<div data-name="row"><p data-name="p"></p></div>';
    const result = desugarHas("div:has(> p:empty) { color: red; }");
    const rewritten = result.css.slice(0, result.css.indexOf(" {"));
    await settle();
    expect(hasQuestions()[0]?.positional).toBe(true);
    expect(named(rewritten)).toEqual(["row"]);

    document.querySelector('[data-name="p"]')?.append(document.createTextNode("hi"));
    await settle();
    expect(named(rewritten)).toEqual([]);
    expect(named(rewritten)).toEqual(named("div:has(> p:empty)"));
    result.release();
  });
});

/**
 * Takes `:has()` out of plugin stylesheets and answers the same questions from
 * JavaScript instead.
 *
 * Chromium charges for `:has()` at style *invalidation* time, not at match time,
 * and the charge is document wide: because any element may be the ancestor a
 * `:has()` is asking about, a single `class` write anywhere forces the engine to
 * re-check the `:has()` rules up every ancestor chain. Measured on a Gemini App
 * conversation, one class write cost 58 ms with the plugin's 60 `:has()` rules
 * loaded and 1 ms without them - and the overhead is mostly fixed, so trimming
 * some of the rules buys very little. It only goes away at zero.
 *
 * The way to zero without losing a single pixel is to notice that `:has(ARG)` is
 * a plain predicate on the element: whether the element has a match for ARG does
 * not depend on which rule is asking. So each distinct ARG gets an attribute,
 * the attribute is set on exactly the elements `:has(ARG)` selects, and the rule
 * reads the attribute. Asking in JavaScript is a one-shot query with nothing
 * registered for invalidation, which is why it is cheap.
 *
 * Two things make the swap invisible rather than merely close:
 *
 *   - The mark set is computed *with* `:has()` - `querySelectorAll('X:has(ARG)')`
 *     - so it is the engine's own answer, not a reimplementation of it.
 *   - The replacement text is padded to the specificity `:has()` contributed, so
 *     the cascade resolves exactly as before. See `substitute`.
 *
 * Marks are refreshed synchronously inside the MutationObserver callback, before
 * the frame is painted, so nothing is ever drawn in a half-marked state.
 */

/** Attribute set on elements satisfying question N. */
const MARK = "data-bg-has-";

/* Names nothing in the document will ever carry, so `:not(...)` of them is
 * always true and can be used purely as specificity ballast. */
const PAD = "bettergravity-has-pad";

/** Elements to walk through a changed subtree before giving up and re-asking everything. */
const SCAN_LIMIT = 2048;

/**
 * Places one batch may have changed before the batch is treated as changing
 * everywhere. Each one is searched separately for the elements a question needs,
 * so past some number of them searching the document once is the cheaper of the
 * two. Antigravity's bursts are a handful of parents, so this is rarely reached.
 */
const ROOT_LIMIT = 32;

interface Specificity {
  a: number;
  b: number;
  c: number;
}

/** One compound of a complex selector, with the combinator that introduced it. */
interface Token {
  combinator: string;
  compound: string;
}

interface Site {
  start: number;
  end: number;
  argument: string;
}

interface Question {
  argument: string;
  attribute: string;
  /** Union of `PREFIX:has(ARG)` over every rule that asks, so probing stays narrow. */
  probe: string;
  /** The same prefixes without the `:has()`: the half of the probe that is cheap. */
  prefixOnly: string;
  /**
   * An indexable selector for the elements the argument needs to find - the
   * rightmost compound of each of its branches. Empty when some branch has
   * nothing to look up, and the question has to be asked of the whole document.
   */
  seed: string;
  /** Set when a branch hangs off a sibling of the subject rather than inside it. */
  sibling: boolean;
  /**
   * Set when the argument uses `+` or `~` anywhere. What it needs to find can then
   * sit beside a changed element rather than inside it, so a search confined to
   * what changed has to start one level higher.
   */
  crossesSiblings: boolean;
  /** Set when the answer depends on the page's shape - see `POSITIONAL`. */
  positional: boolean;
  prefixes: Set<string>;
  specificity: Specificity;
  refs: number;
  marked: Set<Element>;
  /** DOM changes that could flip the answer, indexed the way Chromium indexes rules. */
  classes: Set<string>;
  ids: Set<string>;
  attributes: Set<string>;
  tags: Set<string>;
  /** True when nothing in the argument can be indexed, so any change may matter. */
  broad: boolean;
}

/** Index of the closing bracket of the group opening at `at`, escape and quote aware. */
function closing(text: string, at: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let scan = at; scan < text.length; scan += 1) {
    const ch = text[scan];
    if (ch === "\\") {
      scan += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return scan;
    }
  }
  return text.length - 1;
}

const IDENT = /[-\w\u00a0-\uffff]/;

/** End of the identifier starting at `at`, following backslash escapes. */
function identEnd(text: string, at: number): number {
  let scan = at;
  while (scan < text.length) {
    const ch = text[scan] ?? "";
    if (ch === "\\") {
      scan += 2;
      continue;
    }
    if (!IDENT.test(ch)) break;
    scan += 1;
  }
  return scan;
}

/** Splits on top-level separators, ignoring quotes, parens and brackets. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buffer = "";
  for (let at = 0; at < text.length; at += 1) {
    const ch = text[at] ?? "";
    if (ch === "\\") {
      buffer += ch + (text[at + 1] ?? "");
      at += 1;
      continue;
    }
    if (quote) {
      buffer += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (depth === 0 && ch === separator) {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  parts.push(buffer);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Splits a complex selector into compounds, each tagged with what led to it. */
function tokenize(selector: string): Token[] {
  const tokens: Token[] = [];
  let combinator = "";
  let compound = "";
  let depth = 0;
  let quote: string | null = null;
  for (let at = 0; at < selector.length; at += 1) {
    const ch = selector[at] ?? "";
    if (ch === "\\") {
      compound += ch + (selector[at + 1] ?? "");
      at += 1;
      continue;
    }
    if (quote) {
      compound += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      compound += ch;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth += 1;
      compound += ch;
      continue;
    }
    if (ch === ")" || ch === "]") {
      depth -= 1;
      compound += ch;
      continue;
    }
    if (depth === 0 && (ch === " " || ch === "\t" || ch === "\n" || ch === "\r")) {
      if (compound.length > 0) {
        tokens.push({ combinator, compound });
        compound = "";
        combinator = " ";
      } else if (combinator.length === 0) combinator = " ";
      continue;
    }
    if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      if (compound.length > 0) {
        tokens.push({ combinator, compound });
        compound = "";
      }
      combinator = ch;
      continue;
    }
    compound += ch;
  }
  if (compound.length > 0) tokens.push({ combinator, compound });
  return tokens;
}

/** Rebuilds selector text from tokens. */
function detokenize(tokens: Token[]): string {
  let out = "";
  for (const token of tokens) {
    if (token.combinator === "") out += token.compound;
    else if (token.combinator === " ") out += ` ${token.compound}`;
    else out += ` ${token.combinator} ${token.compound}`;
  }
  return out;
}

/** Index just past the pseudo-class or pseudo-element beginning at `at`. */
function skipPseudo(text: string, at: number): number {
  let cursor = at + 1;
  if (text[cursor] === ":") cursor += 1;
  cursor = identEnd(text, cursor);
  if (text[cursor] === "(") cursor = closing(text, cursor, "(", ")") + 1;
  return cursor;
}

/**
 * The part of a compound that survives as a probe subject: type, class, id and
 * attribute, with every pseudo-class dropped. Dropping them can only widen the
 * set of elements the probe considers, and a probe that considers extra
 * elements still marks the right ones, so widening is always safe.
 */
function staticPart(compound: string): string {
  let out = "";
  let at = 0;
  while (at < compound.length) {
    const ch = compound[at] ?? "";
    if (ch === "\\") {
      out += ch + (compound[at + 1] ?? "");
      at += 2;
      continue;
    }
    if (ch === ":") {
      at = skipPseudo(compound, at);
      continue;
    }
    if (ch === "[") {
      const end = closing(compound, at, "[", "]");
      out += compound.slice(at, end + 1);
      at = end + 1;
      continue;
    }
    out += ch;
    at += 1;
  }
  return out;
}

/** Pseudo-classes whose argument is a selector list they take the weight of. */
const MAX_OF_ARGUMENT = new Set(["is", "not", "has", "matches", "-webkit-any", "-moz-any"]);

/** Pseudo-elements that predate the double colon and so are spelled with one. */
const LEGACY_ELEMENT = new Set(["before", "after", "first-line", "first-letter"]);

const ZERO: Specificity = { a: 0, b: 0, c: 0 };

function heavier(left: Specificity, right: Specificity): Specificity {
  if (left.a !== right.a) return left.a > right.a ? left : right;
  if (left.b !== right.b) return left.b > right.b ? left : right;
  return left.c >= right.c ? left : right;
}

/** Specificity of a selector list: the weight of its heaviest branch. */
function specificityOf(list: string): Specificity {
  let best = ZERO;
  for (const selector of splitTop(list, ",")) best = heavier(best, weigh(selector));
  return best;
}

/** Specificity of one complex selector, per the Selectors 4 counting rules. */
function weigh(selector: string): Specificity {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const token of tokenize(selector)) {
    const compound = token.compound;
    let at = 0;
    while (at < compound.length) {
      const ch = compound[at] ?? "";
      if (ch === "\\") {
        at += 2;
        continue;
      }
      if (ch === "#") {
        a += 1;
        at = identEnd(compound, at + 1);
        continue;
      }
      if (ch === ".") {
        b += 1;
        at = identEnd(compound, at + 1);
        continue;
      }
      if (ch === "[") {
        b += 1;
        at = closing(compound, at, "[", "]") + 1;
        continue;
      }
      if (ch === ":") {
        const isElement = compound[at + 1] === ":";
        const nameStart = at + (isElement ? 2 : 1);
        const nameEnd = identEnd(compound, nameStart);
        const name = compound.slice(nameStart, nameEnd).toLowerCase();
        let after = nameEnd;
        let argument: string | null = null;
        if (compound[nameEnd] === "(") {
          const close = closing(compound, nameEnd, "(", ")");
          argument = compound.slice(nameEnd + 1, close);
          after = close + 1;
        }
        at = after;
        if (isElement || LEGACY_ELEMENT.has(name)) {
          c += 1;
          continue;
        }
        if (name === "where") continue;
        if (MAX_OF_ARGUMENT.has(name)) {
          if (argument !== null) {
            const inner = specificityOf(argument);
            a += inner.a;
            b += inner.b;
            c += inner.c;
          }
          continue;
        }
        b += 1;
        if (argument !== null && (name === "nth-child" || name === "nth-last-child")) {
          const of = /\bof\s+([\s\S]+)$/i.exec(argument);
          if (of?.[1]) {
            const inner = specificityOf(of[1]);
            a += inner.a;
            b += inner.b;
            c += inner.c;
          }
        }
        continue;
      }
      if (ch === "*") {
        at += 1;
        continue;
      }
      const end = identEnd(compound, at);
      if (end > at) {
        c += 1;
        at = end;
        continue;
      }
      at += 1;
    }
  }
  return { a, b, c };
}

/** Every `:has(...)` in a selector, at any nesting depth, left to right. */
function findSites(selector: string): Site[] {
  const sites: Site[] = [];
  let quote: string | null = null;
  for (let at = 0; at < selector.length; at += 1) {
    const ch = selector[at] ?? "";
    if (ch === "\\") {
      at += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch !== ":" || !selector.startsWith(":has(", at)) continue;
    const end = closing(selector, at + 4, "(", ")");
    // An unbalanced argument means this fragment is not a whole selector - a
    // comment split it, most likely. Leaving it alone is always safe.
    if (selector[end] !== ")") return sites;
    sites.push({ start: at, end, argument: selector.slice(at + 5, end).trim() });
    at = end;
  }
  return sites;
}

/**
 * End of the top-level compound that holds `at`: the next combinator outside
 * every bracket and parenthesis.
 *
 * The scan starts at the beginning of the selector rather than at the site, so a
 * `:has()` sitting inside `:not()` is still measured against the compound it
 * qualifies out in the open. Starting inside the parentheses would make the
 * enclosing `)` look like the end of nothing and run on to the end of the
 * selector, which would hand the question the wrong subject entirely.
 */
function compoundEnd(selector: string, at: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let scan = 0; scan < selector.length; scan += 1) {
    const ch = selector[scan] ?? "";
    if (ch === "\\") {
      scan += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === ")" || ch === "]") {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || scan <= at) continue;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ">" || ch === "+" || ch === "~") return scan;
  }
  return selector.length;
}

/**
 * A selector for the elements this rule could ask the question of, used to keep
 * `querySelectorAll` from having to consider the whole document. It is the
 * author's own selector up to and including the compound holding the `:has()`,
 * stripped of pseudo-classes - so it matches at least every element the original
 * rule could match, and usually far fewer than `*`.
 *
 * It has to stop at that compound. The `:has()` qualifies the element that
 * compound selects, so anything after it - `> .card > .body` - describes
 * different elements, and marking those would answer a question nobody asked.
 */
function probePrefix(selector: string, site: Site): string {
  const head = selector.slice(0, compoundEnd(selector, site.start));
  const tokens = tokenize(head).map((token) => {
    const kept = staticPart(token.compound);
    return { combinator: token.combinator, compound: kept.length > 0 ? kept : "*" };
  });
  const text = detokenize(tokens).trim();
  return text.length > 0 ? text : "*";
}

/**
 * The elements a `:has()` argument has to find for the answer to be yes, as a
 * plain selector: the rightmost compound of each branch, pseudo-classes dropped.
 * Because dropping them only widens, every element the argument could find still
 * matches this - so the elements it finds are a superset of the witnesses, and
 * every subject is an ancestor (or, for a branch that starts at a sibling, an
 * earlier sibling of one) of a witness. That is what lets the question be
 * answered without walking the document.
 *
 * Empty when a branch offers nothing to look up (`> *`, `:not(.x)`), since then
 * the witness could be anything and there is nothing cheaper than asking.
 */
function witnessSeed(argument: string): string {
  const parts: string[] = [];
  for (const branch of splitTop(argument, ",")) {
    const tokens = tokenize(branch);
    const last = tokens[tokens.length - 1];
    if (!last) return "";
    const kept = staticPart(last.compound).trim();
    if (kept.length === 0 || kept === "*") return "";
    parts.push(kept);
  }
  return parts.length > 0 ? parts.join(",") : "";
}

/**
 * True when some branch begins `+` or `~`. The witness is then inside a *later
 * sibling* of the subject rather than inside the subject, so earlier siblings
 * have to join the elements considered.
 */
function seedLeansOnSiblings(argument: string): boolean {
  for (const branch of splitTop(argument, ",")) {
    const first = tokenize(branch)[0];
    if (first && (first.combinator === "+" || first.combinator === "~")) return true;
  }
  return false;
}

/**
 * True when `+` or `~` appears anywhere in the argument, leading or not. Whatever
 * the argument needs to find can then be a sibling of the element that changed,
 * or inside one, so a search of only what changed would miss it.
 */
function argumentCrossesSiblings(argument: string): boolean {
  return /[+~]/.test(bareText(argument));
}

/*
 * Pseudo-classes whose answer is the page's shape rather than anything an
 * argument could be keyed on. `:has(+ .late)` stops matching when the element
 * between two siblings is removed, and `:has(p:empty)` when a word is typed into
 * an empty paragraph - in both cases without a single class, id, attribute or tag
 * the argument mentions appearing or disappearing anywhere. Questions like these
 * have to be re-asked on any structural change.
 */
const POSITIONAL =
  /:(?:nth-child|nth-last-child|nth-of-type|nth-last-of-type|first-child|last-child|first-of-type|last-of-type|only-child|only-of-type|nth-col|nth-last-col|empty)\b/i;

function argumentIsPositional(argument: string): boolean {
  const bare = bareText(argument);
  return /[+~]/.test(bare) || POSITIONAL.test(bare);
}

/**
 * The argument with attribute selectors taken out, so a text test cannot be
 * fooled by `[class~="x"]` or by a quoted value that reads like a selector.
 */
function bareText(argument: string): string {
  if (!argument.includes("[")) return argument;
  let out = "";
  let at = 0;
  while (at < argument.length) {
    if (argument[at] === "[") {
      at = closing(argument, at, "[", "]") + 1;
      continue;
    }
    out += argument[at];
    at += 1;
  }
  return out;
}

interface Hooks {
  classes: Set<string>;
  ids: Set<string>;
  attributes: Set<string>;
  tags: Set<string>;
  /** Set when the argument leans on state no MutationObserver can report. */
  untrackable: boolean;
}

/* State pseudo-classes this can follow, because the state is an attribute. */
const PSEUDO_ATTRIBUTE = new Map<string, string>([
  ["disabled", "disabled"],
  ["enabled", "disabled"],
  ["read-only", "readonly"],
  ["read-write", "readonly"],
  ["required", "required"],
  ["optional", "required"],
  ["open", "open"],
  ["popover-open", "popover"]
]);

/* State pseudo-classes it cannot: the engine updates these without touching the
 * DOM, so a mark would silently stop tracking them. A `:has()` naming one of
 * these is left in the stylesheet, correct but unoptimised. */
const UNTRACKABLE = new Set([
  "hover", "active", "focus", "focus-within", "focus-visible", "target", "target-within",
  "visited", "link", "any-link", "local-link", "checked", "indeterminate", "default",
  "placeholder-shown", "autofill", "user-invalid", "user-valid", "valid", "invalid",
  "in-range", "out-of-range", "playing", "paused", "muted", "seeking", "buffering",
  "stalled", "volume-locked", "current", "past", "future", "modal", "fullscreen",
  "picture-in-picture", "defined", "state"
]);

const unescape = (text: string): string => text.replace(/\\(.)/g, "$1");

/** Attribute name at the start of an attribute selector body. */
function attributeName(body: string): string {
  const match = /^\s*([^\s~|^$*=\]]+)/.exec(body);
  return match?.[1] ? unescape(match[1]).toLowerCase() : "";
}

/**
 * Records every class, id, attribute and tag the argument mentions, so a
 * mutation naming none of them can be skipped. Returns false when some compound
 * offers nothing to key on (`:has(> *)`, `:has(:not(.x))`), in which case the
 * question has to be re-asked on any change.
 */
function collectHooks(list: string, into: Hooks): boolean {
  let narrow = true;
  for (const selector of splitTop(list, ",")) {
    for (const token of tokenize(selector)) {
      if (!compoundHooks(token.compound, into)) narrow = false;
    }
  }
  return narrow;
}

function compoundHooks(compound: string, into: Hooks): boolean {
  let positive = false;
  let at = 0;
  while (at < compound.length) {
    const ch = compound[at] ?? "";
    if (ch === "#") {
      const end = identEnd(compound, at + 1);
      into.ids.add(unescape(compound.slice(at + 1, end)));
      positive = true;
      at = end;
      continue;
    }
    if (ch === ".") {
      const end = identEnd(compound, at + 1);
      into.classes.add(unescape(compound.slice(at + 1, end)));
      positive = true;
      at = end;
      continue;
    }
    if (ch === "[") {
      const end = closing(compound, at, "[", "]");
      const name = attributeName(compound.slice(at + 1, end));
      if (name.length > 0) into.attributes.add(name);
      positive = true;
      at = end + 1;
      continue;
    }
    if (ch === ":") {
      const isElement = compound[at + 1] === ":";
      const nameStart = at + (isElement ? 2 : 1);
      const nameEnd = identEnd(compound, nameStart);
      const name = compound.slice(nameStart, nameEnd).toLowerCase();
      let after = nameEnd;
      let argument: string | null = null;
      if (compound[nameEnd] === "(") {
        const close = closing(compound, nameEnd, "(", ")");
        argument = compound.slice(nameEnd + 1, close);
        after = close + 1;
      }
      at = after;
      if (UNTRACKABLE.has(name)) into.untrackable = true;
      const backing = PSEUDO_ATTRIBUTE.get(name);
      if (backing) into.attributes.add(backing);
      if (argument === null) continue;
      // Whatever the pseudo-class means, a change to what it names can flip it.
      const inner = collectHooks(argument, into);
      // Only a positive match narrows: `:not(.x)` is satisfied by anything.
      if (inner && (name === "is" || name === "where" || name === "has" || name === "matches")) positive = true;
      continue;
    }
    if (ch === "*") {
      at += 1;
      continue;
    }
    const end = identEnd(compound, at);
    if (end > at) {
      into.tags.add(unescape(compound.slice(at, end)).toLowerCase());
      positive = true;
      at = end;
      continue;
    }
    at += 1;
  }
  return positive;
}

const questions = new Map<string, Question>();
const byClass = new Map<string, Set<Question>>();
const byId = new Map<string, Set<Question>>();
const byAttribute = new Map<string, Set<Question>>();
const byTag = new Map<string, Set<Question>>();
const broadQuestions = new Set<Question>();
const positionalQuestions = new Set<Question>();
let nextMark = 0;

function fileUnder(index: Map<string, Set<Question>>, keys: Set<string>, question: Question): void {
  for (const key of keys) {
    const bucket = index.get(key);
    if (bucket) bucket.add(question);
    else index.set(key, new Set([question]));
  }
}

function dropFrom(index: Map<string, Set<Question>>, keys: Set<string>, question: Question): void {
  for (const key of keys) {
    const bucket = index.get(key);
    if (!bucket) continue;
    bucket.delete(question);
    if (bucket.size === 0) index.delete(key);
  }
}

/**
 * The replacement text for one `:has(...)`.
 *
 * The attribute alone would be (0,1,0), which is rarely what `:has()` weighed -
 * `:has()` counts as its heaviest argument. So the attribute is wrapped in
 * `:where()` when no class-level weight is wanted, and the remainder is made up
 * with `:not()` of names nothing carries: always true, so matching is untouched,
 * but each one adds exactly one unit at the level it names. The rewritten rule
 * therefore sits at the same place in the cascade as the rule it replaces.
 */
function substitute(question: Question): string {
  const { a, b, c } = question.specificity;
  const attribute = `[${question.attribute}]`;
  let out = b >= 1 ? attribute : `:where(${attribute})`;
  for (let n = 0; n < a; n += 1) out += `:not(#${PAD})`;
  for (let n = 1; n < b; n += 1) out += `:not(.${PAD})`;
  for (let n = 0; n < c; n += 1) out += `:not(${PAD})`;
  return out;
}

/** The question for this argument, created and indexed on first sight. */
function questionFor(argument: string, prefix: string): Question | null {
  const key = detokenize(tokenize(argument));
  let question = questions.get(key);
  if (!question) {
    const hooks: Hooks = {
      classes: new Set(),
      ids: new Set(),
      attributes: new Set(),
      tags: new Set(),
      untrackable: false
    };
    const narrow = collectHooks(key, hooks);
    if (hooks.untrackable) return null;
    question = {
      argument: key,
      attribute: `${MARK}${nextMark}`,
      probe: "",
      prefixOnly: "",
      seed: witnessSeed(key),
      sibling: seedLeansOnSiblings(key),
      crossesSiblings: argumentCrossesSiblings(key),
      positional: argumentIsPositional(key),
      prefixes: new Set<string>(),
      specificity: specificityOf(key),
      refs: 0,
      marked: new Set<Element>(),
      classes: hooks.classes,
      ids: hooks.ids,
      attributes: hooks.attributes,
      tags: hooks.tags,
      broad: !narrow
    };
    nextMark += 1;
    questions.set(key, question);
    fileUnder(byClass, question.classes, question);
    fileUnder(byId, question.ids, question);
    fileUnder(byAttribute, question.attributes, question);
    fileUnder(byTag, question.tags, question);
    if (question.broad) broadQuestions.add(question);
    if (question.positional) positionalQuestions.add(question);
  }
  if (!question.prefixes.has(prefix)) {
    question.prefixes.add(prefix);
    question.probe = [...question.prefixes].map((text) => `${text}:has(${question.argument})`).join(",");
    question.prefixOnly = [...question.prefixes].join(",");
  }
  return question;
}

function forget(question: Question): void {
  for (const element of question.marked) element.removeAttribute(question.attribute);
  question.marked.clear();
  dropFrom(byClass, question.classes, question);
  dropFrom(byId, question.ids, question);
  dropFrom(byAttribute, question.attributes, question);
  dropFrom(byTag, question.tags, question);
  broadQuestions.delete(question);
  positionalQuestions.delete(question);
  questions.delete(question.argument);
}

let observer: MutationObserver | null = null;
let watching = "";
let due: Set<Question> | null = null;
let everything = false;
let queued = false;
/** The elements this batch changed, or null once the batch counts as changing everywhere. */
let roots: Set<Element> | null = null;
let wide = false;

function needs(question: Question): void {
  if (!due) due = new Set<Question>();
  due.add(question);
}

/**
 * Remembers where the page changed, so the search for new marks can be confined
 * to it. For a childList change this is the parent, which contains every node
 * added and is where a removal happened, so noting the added nodes as well would
 * only search the same ground again.
 */
function note(target: Node): void {
  if (wide || target.nodeType !== 1) return;
  if (!roots) roots = new Set<Element>();
  if (roots.size >= ROOT_LIMIT) {
    wide = true;
    roots = null;
    return;
  }
  roots.add(target as Element);
}

function needsAll(bucket: Set<Question> | undefined): void {
  if (!bucket) return;
  for (const question of bucket) needs(question);
}

/** Class tokens present in one value but not the other. */
function changedTokens(before: string | null, after: string | null): string[] {
  const left = (before ?? "").split(/\s+/).filter((token) => token.length > 0);
  const right = (after ?? "").split(/\s+/).filter((token) => token.length > 0);
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const out: string[] = [];
  for (const token of left) if (!rightSet.has(token)) out.push(token);
  for (const token of right) if (!leftSet.has(token)) out.push(token);
  return out;
}

/** Notes which questions a changed subtree could affect, up to a budget. */
function scan(node: Node, budget: number): number {
  if (node.nodeType !== 1) return 0;
  let seen = 0;
  const stack: Element[] = [node as Element];
  while (stack.length > 0) {
    const element = stack.pop();
    if (!element) break;
    seen += 1;
    if (seen > budget) {
      everything = true;
      return seen;
    }
    needsAll(byTag.get(element.localName));
    if (element.id.length > 0) needsAll(byId.get(element.id));
    const classes = element.classList;
    for (let at = 0; at < classes.length; at += 1) needsAll(byClass.get(classes[at] ?? ""));
    if (byAttribute.size > 0) {
      // The live map rather than `getAttributeNames()`, which builds an array of
      // strings per element - and this runs for every element of every subtree
      // Antigravity inserts.
      const attributes = element.attributes;
      for (let at = 0; at < attributes.length; at += 1) {
        const name = attributes[at]?.name;
        if (name) needsAll(byAttribute.get(name));
      }
    }
    const children = element.children;
    for (let at = 0; at < children.length; at += 1) {
      const child = children[at];
      if (child) stack.push(child);
    }
  }
  return seen;
}

function collect(records: MutationRecord[]): void {
  let budget = SCAN_LIMIT;
  let structural = false;
  for (const record of records) {
    if (everything) return;
    if (record.type === "attributes") {
      const name = record.attributeName;
      if (!name) continue;
      note(record.target);
      needsAll(byAttribute.get(name));
      const target = record.target as Element;
      if (name === "class") {
        for (const token of changedTokens(record.oldValue, target.getAttribute("class"))) needsAll(byClass.get(token));
      } else if (name === "id") {
        if (record.oldValue) needsAll(byId.get(record.oldValue));
        if (target.id.length > 0) needsAll(byId.get(target.id));
      }
      continue;
    }
    if (record.type !== "childList") continue;
    structural = true;
    note(record.target);
    for (const node of record.addedNodes) {
      budget -= scan(node, budget);
      if (everything) return;
    }
    for (const node of record.removedNodes) {
      budget -= scan(node, budget);
      if (everything) return;
    }
  }
  // Questions with nothing to key on can only be settled by asking again, and so
  // can questions whose answer is the shape of the page rather than its contents.
  if (structural) {
    for (const question of broadQuestions) needs(question);
    for (const question of positionalQuestions) needs(question);
  }
}

/**
 * Puts the question to one element, and records the verdict so no element is
 * asked twice in a pass.
 */
function check(question: Question, element: Element, tested: Set<Element>, next: Set<Element>): void {
  if (tested.has(element)) return;
  tested.add(element);
  // The half of the probe with no `:has()` in it first: an element the rule could
  // never have selected is dismissed without evaluating anything expensive, which
  // is most of them.
  if (!element.matches(question.prefixOnly)) return;
  if (element.matches(question.probe)) next.add(element);
}

/**
 * Asks the question of every element that could carry the mark because of this
 * witness: its ancestors, and its earlier siblings when the argument starts at a
 * sibling. The walk stops as soon as it meets an element it has already climbed
 * through, because everything above that has been asked already.
 */
function climb(
  question: Question,
  witness: Element,
  climbed: Set<Element>,
  tested: Set<Element>,
  next: Set<Element>
): void {
  if (question.sibling) {
    for (let prior = witness.previousElementSibling; prior; prior = prior.previousElementSibling) {
      check(question, prior, tested, next);
    }
  }
  for (let node = witness.parentElement; node; node = node.parentElement) {
    if (climbed.has(node)) break;
    climbed.add(node);
    check(question, node, tested, next);
    if (!question.sibling) continue;
    for (let prior = node.previousElementSibling; prior; prior = prior.previousElementSibling) {
      check(question, prior, tested, next);
    }
  }
}

/**
 * Finds the elements the mark belongs on within one part of the page.
 *
 * `document.querySelectorAll('PREFIX:has(ARG)')` is the honest way to ask, and the
 * expensive one: the engine matches right to left, so a probe ending in
 * `*:has(.truncate)` is answered by evaluating `:has()` against every element
 * there is. Looking up what the argument needs first inverts that - `.truncate` is
 * one index lookup - and the subject of a `:has()` is always an ancestor of what
 * the argument found (or an earlier sibling of it, for a branch that starts at a
 * sibling), so climbing from each one reaches every element that can match.
 */
function gains(
  question: Question,
  from: Element,
  climbed: Set<Element>,
  tested: Set<Element>,
  next: Set<Element>
): void {
  if (from.matches(question.seed)) climb(question, from, climbed, tested, next);
  const witnesses = from.querySelectorAll(question.seed);
  for (let at = 0; at < witnesses.length; at += 1) {
    const witness = witnesses[at];
    if (witness) climb(question, witness, climbed, tested, next);
  }
}

/**
 * The elements this question's mark belongs on right now. However they are found,
 * the answer is the engine's: every candidate is confirmed with
 * `matches(PREFIX:has(ARG))`, the same selector `querySelectorAll` would have been
 * given, so the set cannot drift from what the original rule selected.
 *
 * `scopes` is where the page changed. A mark can only newly appear where what the
 * argument needs newly appeared, and that can only be inside a changed element -
 * or beside one, which is what `crossesSiblings` starts a level higher for - so
 * looking for new marks anywhere else is looking for something that cannot be
 * there. Marks already in place are re-confirmed either way, which is the only
 * thing that ever takes one back off. Null scopes means look everywhere: the first
 * pass, and a batch too broad to be worth confining.
 *
 * Null means give up and leave the marks alone, which is what an invalid selector
 * did before this was any faster.
 */
function answer(question: Question, scopes: Set<Element> | null): Set<Element> | null {
  const next = new Set<Element>();
  if (question.seed.length === 0) {
    let found: NodeListOf<Element>;
    try {
      found = document.querySelectorAll(question.probe);
    } catch {
      return null;
    }
    for (let at = 0; at < found.length; at += 1) {
      const element = found[at];
      if (element) next.add(element);
    }
    return next;
  }
  const climbed = new Set<Element>();
  const tested = new Set<Element>();
  try {
    for (const element of question.marked) {
      if (element.isConnected) check(question, element, tested, next);
    }
    if (scopes) {
      for (const scope of scopes) {
        if (!scope.isConnected) continue;
        const from = question.crossesSiblings ? scope.parentElement ?? scope : scope;
        gains(question, from, climbed, tested, next);
      }
    } else {
      const root = document.documentElement;
      if (root) gains(question, root, climbed, tested, next);
    }
  } catch {
    return null;
  }
  return next;
}

/**
 * Brings one question's marks up to date, given where the page changed.
 */
function reask(question: Question, scopes: Set<Element> | null): void {
  if (question.probe.length === 0) return;
  const next = answer(question, scopes);
  if (!next) return;
  for (const element of question.marked) {
    if (!next.has(element)) element.removeAttribute(question.attribute);
  }
  for (const element of next) {
    if (!question.marked.has(element)) element.setAttribute(question.attribute, "");
  }
  question.marked = next;
}

/**
 * Runs inside the same task as the mutations that caused it - a microtask, not
 * an animation frame - so the marks are in place before anything is painted. A
 * frame deferred here would show one unstyled frame on every DOM change.
 */
function flush(): void {
  queued = false;
  const all = everything;
  const set = due;
  // A batch that overran its budgets is no longer known to be confined to
  // anywhere, so it is answered the old way, from the document.
  const scopes = all || wide ? null : roots;
  everything = false;
  due = null;
  roots = null;
  wide = false;
  if (all) {
    for (const question of questions.values()) reask(question, null);
    return;
  }
  if (!set) return;
  for (const question of set) reask(question, scopes);
}

function schedule(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(flush);
}

/** Attribute names any question could be keyed on. */
function attributeFilter(): string[] {
  const names = new Set<string>();
  for (const question of questions.values()) {
    for (const name of question.attributes) names.add(name);
    if (question.classes.size > 0) names.add("class");
    if (question.ids.size > 0) names.add("id");
  }
  return [...names];
}

function ensureObserver(): void {
  const root = document.documentElement;
  if (!root) {
    document.addEventListener("DOMContentLoaded", () => {
      ensureObserver();
      everything = true;
      flush();
    }, { once: true });
    return;
  }
  const filter = attributeFilter();
  const signature = filter.join(",");
  if (observer && signature === watching) return;
  if (!observer) {
    observer = new MutationObserver((records) => {
      collect(records);
      schedule();
    });
  }
  watching = signature;
  observer.observe(root, filter.length > 0
    ? { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: filter }
    : { subtree: true, childList: true });
}

function rewriteSelector(selector: string, used: Set<Question>): string {
  const sites = findSites(selector);
  if (sites.length === 0) return selector;
  let out = selector;
  // Right to left, so the recorded offsets of the sites still to do stay valid.
  for (let index = sites.length - 1; index >= 0; index -= 1) {
    const site = sites[index];
    if (!site) continue;
    const question = questionFor(site.argument, probePrefix(selector, site));
    if (!question) continue;
    used.add(question);
    out = out.slice(0, site.start) + substitute(question) + out.slice(site.end + 1);
  }
  return out;
}

/**
 * One selector list. A `:has()` inside another `:has()` is invalid CSS, and
 * Chromium throws the whole rule away when it sees one; rewriting such a rule
 * would bring it back to life and change what is drawn, so the list is returned
 * untouched and stays dropped exactly as before.
 */
function rewriteList(list: string, used: Set<Question>): string {
  if (!list.includes(":has(")) return list;
  const parts = splitTop(list, ",");
  for (const part of parts) {
    for (const site of findSites(part)) {
      if (site.argument.includes(":has(")) return list;
    }
  }
  const leading = /^\s*/.exec(list)?.[0] ?? "";
  const trailing = /\s*$/.exec(list)?.[0] ?? "";
  return leading + parts.map((part) => rewriteSelector(part, used)).join(", ") + trailing;
}

/** Applies `rewrite` to the parts of a prelude that are not comments. */
function outsideComments(text: string, rewrite: (part: string) => string): string {
  if (!text.includes("/*")) return rewrite(text);
  let out = "";
  let at = 0;
  while (at < text.length) {
    const start = text.indexOf("/*", at);
    if (start === -1) {
      out += rewrite(text.slice(at));
      break;
    }
    if (start > at) out += rewrite(text.slice(at, start));
    const end = text.indexOf("*/", start + 2);
    if (end === -1) {
      out += text.slice(start);
      break;
    }
    out += text.slice(start, end + 2);
    at = end + 2;
  }
  return out;
}

/** The prelude with comments removed, for deciding what kind of block follows. */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Walks the stylesheet handing every selector list to `onSelectors`, leaving
 * at-rule preludes, declarations, strings and comments exactly as written.
 */
function walk(css: string, onSelectors: (list: string) => string): string {
  let out = "";
  let buffer = "";
  let quote: string | null = null;
  let comment = false;
  const stack: boolean[] = [];
  for (let at = 0; at < css.length; at += 1) {
    const ch = css[at] ?? "";
    if (comment) {
      buffer += ch;
      if (ch === "*" && css[at + 1] === "/") {
        buffer += "/";
        at += 1;
        comment = false;
      }
      continue;
    }
    if (quote) {
      buffer += ch;
      if (ch === "\\") {
        buffer += css[at + 1] ?? "";
        at += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && css[at + 1] === "*") {
      buffer += "/*";
      at += 1;
      comment = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === "{") {
      const inDeclarations = stack.length > 0 && stack[stack.length - 1] === false;
      const trimmed = withoutComments(buffer).trim();
      const atRule = trimmed.startsWith("@");
      out += !inDeclarations && !atRule && trimmed.length > 0
        ? outsideComments(buffer, onSelectors)
        : buffer;
      out += "{";
      buffer = "";
      stack.push(atRule);
      continue;
    }
    if (ch === "}") {
      out += buffer;
      buffer = "";
      stack.pop();
      out += "}";
      continue;
    }
    buffer += ch;
  }
  return out + buffer;
}

export interface Desugared {
  css: string;
  release: () => void;
}

/**
 * Rewrites one stylesheet and starts maintaining the marks it now depends on.
 * `release` must be called when the stylesheet is removed.
 */
export function desugarHas(css: string): Desugared {
  if (!css.includes(":has(")) return { css, release: () => undefined };
  const used = new Set<Question>();
  const rewritten = walk(css, (list) => rewriteList(list, used));
  for (const question of used) question.refs += 1;
  ensureObserver();
  everything = true;
  flush();
  let released = false;
  return {
    css: rewritten,
    release: () => {
      if (released) return;
      released = true;
      for (const question of used) {
        question.refs -= 1;
        if (question.refs <= 0) forget(question);
      }
      if (questions.size === 0) {
        observer?.disconnect();
        observer = null;
        watching = "";
        due = null;
        everything = false;
        roots = null;
        wide = false;
        return;
      }
      ensureObserver();
      everything = true;
      schedule();
    }
  };
}

/** Exposed for tests: the questions currently being maintained. */
export function hasQuestions(): {
  argument: string;
  attribute: string;
  probe: string;
  prefixOnly: string;
  seed: string;
  broad: boolean;
  positional: boolean;
  sibling: boolean;
  crossesSiblings: boolean;
  marked: number;
}[] {
  return [...questions.values()].map((question) => ({
    argument: question.argument,
    attribute: question.attribute,
    probe: question.probe,
    prefixOnly: question.prefixOnly,
    seed: question.seed,
    broad: question.broad,
    positional: question.positional,
    sibling: question.sibling,
    crossesSiblings: question.crossesSiblings,
    marked: question.marked.size
  }));
}

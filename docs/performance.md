# Keeping it fast

Antigravity is a big page. A conversation with a few long answers in it is several
thousand elements, and while the agent works, parts of that page re-render many
times a second. Something that costs a fraction of a millisecond per element is
free on a settings screen and unusable in a conversation — the window stops
answering the mouse, animations step instead of sliding, and the whole
application feels broken even though nothing has crashed.

Everything below is the same short list of mistakes, found by making them. None
of it is about the *amount* of CSS or the size of a script: the Gemini App plugin
in `community/plugins/` carries a quarter of a megabyte of CSS across a dozen
sheets and a five-thousand-line script, and neither is why it was ever slow.

## Use `:has()` freely — the runtime rewrites it

`:has()` is the most useful selector there is for theming someone else's
application: it lets a rule depend on what is *inside* an element, which is
usually the only way to tell two identical-looking wrappers apart.

It is also, in a browser, the most expensive thing you can put in a stylesheet.
Chromium cannot tell in advance which elements a `:has()` rule might now match,
so when anything on the page changes — one class, on one element — it re-checks
the rule against a large part of the document. On a 2830-element page, a single
class change cost **58.5 ms** with the plugin's `:has()` rules loaded. That is
four dropped frames, for one class.

BetterGravity removes the problem for plugin styles. When a plugin stylesheet is
loaded, the runtime rewrites every `:has()` out of it: each one becomes a plain
attribute selector, and the runtime keeps that attribute on the right elements by
watching the page itself. The same page, the same rules, the same rendering —
**0.81 ms**.

So write `:has()` the way you would anywhere else:

```css
[data-testid="user-input-step"]:has(img[alt*="User uploaded media" i]) > .bg-card {
  background: transparent !important;
}
```

Two things worth knowing:

- **Do not hand-roll the trick yourself.** Marking elements from your own script
  and matching on the mark is what the runtime is already doing, and doing it
  twice is slower than doing it once.
- **`:has()` inside `:has()` never worked.** `a:has(b:has(c))` is invalid CSS —
  browsers drop it, silently, and always did. One of those anywhere in a
  comma-separated list takes the whole rule down with it, including the twenty
  perfectly good selectors beside it, so a rule that does nothing at all is worth
  checking for this first. The runtime leaves such a rule exactly as it found it,
  precisely so that a rewrite cannot bring a long-dead rule back to life and
  change what you see.

## Never let a watcher wake itself

This is the one that takes the window down.

A `MutationObserver` reports the changes made to a piece of the page. If its
callback *changes that same piece*, the change is reported to the callback, which
changes it again. Observer callbacks run as microtasks, and a task does not end
until its microtasks are done — so the browser never gets back to painting, never
gets back to the mouse, and the window is gone until it is killed. There is no
error, no warning, and nothing in the console.

The slow version of the same mistake is worse to find: the loop ends, but the work
runs on every single change instead of when something actually needs doing.

The rule: **every write asks first whether it changes anything.**

```js
// Wakes itself: taking the item out and building it again is a change.
new MutationObserver(() => {
  menu.querySelector('#my-item')?.remove();
  menu.append(buildItem());
}).observe(menu, { childList: true });

// Does not: the item is built once, and moved only if it is in the wrong place.
const settle = new MutationObserver(() => {
  let item = menu.querySelector('#my-item');
  if (!item) item = buildItem();
  if (item.nextElementSibling !== anchor) menu.insertBefore(item, anchor);
  settle.takeRecords();   // drop the records this pass just made
});
settle.observe(menu, { childList: true });
```

`takeRecords()` empties the queue of changes the observer has not been told about
yet. Calling it at the end of a pass that reads the whole of what it manages is
safe — the pass has already seen the final state — and it is what stops one
change from asking for another for as long as the element lives.

Watch as little as possible, too. `attributeFilter` is one line and turns "every
attribute on every descendant" into "this one attribute":

```js
observer.observe(button, { attributes: true, attributeFilter: ['class'] });
```

## Measure everything before you write anything

Reading a position or a size — `getBoundingClientRect()`, `offsetWidth`,
`clientHeight`, `scrollTop` — has to be answered with the truth, so if anything
has been written since the last time the page was laid out, the browser lays it
out again there and then, before returning. Write, read, write, read is therefore
one full layout of everything per read, and a page like Antigravity's sidebar is
not cheap to lay out.

Same work, one layout:

```js
// One layout per heading.
for (const heading of headings) {
  hideEverythingBeforeTheTitle(heading);            // write
  const left = heading.title.getBoundingClientRect().left;  // forced layout
  heading.title.style.marginLeft = `${18 - left}px`;        // write
}

// One layout for all of them.
for (const heading of headings) hideEverythingBeforeTheTitle(heading);
const lefts = headings.map((heading) => heading.title.getBoundingClientRect().left);
headings.forEach((heading, i) => { heading.title.style.marginLeft = `${18 - lefts[i]}px`; });
```

Read, read, write, write. The shape matters more than the number of reads: six
headings measured together cost one layout, and measured one at a time cost six.

The same applies across functions that look unrelated. If one helper writes and
the next one measures, putting them in a loop over elements reintroduces the
problem, so split helpers into a "work out" half and a "write down" half when they
are going to be called for a list.

## One pass per burst, not one per change

Antigravity re-renders in bursts: one action produces several changes, and every
watcher watching any of it wakes up. Doing the work once for the burst instead of
once per change is usually the largest single win available, and it is four lines:

```js
let queued = false;
const pending = new Set();

function schedule(element) {
  pending.add(element);
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const batch = [...pending].filter((node) => node.isConnected);
    pending.clear();
    runOnePass(batch);
  });
}
```

**Use a microtask when the result must be right in the frame the change happened
in** — anything that positions, sizes, hides or inserts something the user can
see. A microtask runs at the end of the current task, before the browser paints,
so nothing flickers and nothing arrives late.

**Use `requestAnimationFrame` only for work that may be one frame behind** —
recomputing something during a scroll, for instance. Anything the eye can catch
appearing will be caught appearing.

## Search the smallest part of the page you can

`document.querySelectorAll` walks the document. Called from a scroll handler, that
is the whole document, sixty times a second.

It is worse than it sounds when the selector cannot be indexed. A browser looks up
`.sidebar` or `[data-testid="x"]` from a table, but `[class*="group/header"]`
means "any element whose class attribute contains this text", and the only way to
answer it is to read the class of every element in range. Antigravity is built with
Tailwind, so its class attributes are long.

Give it a root:

```js
const root = scroller.closest('[role="navigation"][aria-label="Sidebar"]') ?? scroller;
for (const heading of root.querySelectorAll(HEADING_SELECTOR)) { /* … */ }
```

Nothing else about the code changes, and the walk is over a few hundred elements
instead of a few thousand.

## Mark with script, draw with CSS

Script is the only thing that can answer "is this the row for the conversation
that is open" — but it should answer only that, and write down the answer:

```js
row.dataset.geminiCurrent = isCurrent ? 'true' : 'false';
```

```css
[data-gemini-current="true"] { background: var(--sidebar-secondary) !important; }
```

Everything the eye sees then comes from the stylesheet, where the browser applies
it in bulk and animates it on the compositor. A script that sets colours, sizes
and transforms element by element is doing by hand, badly, what CSS does in one
pass — and it is the reason a plugin's own animations end up stepping.

Attributes are also cheap to write and cheap to match. Setting an attribute to the
value it already has does nothing at all, which is what makes the guarded writes
above so effective.

## Cache a measurement, briefly

Some numbers need measuring but do not change from one element to the next — the
left edge every heading is being aligned to, for example. Measure it once and keep
it for a few hundred milliseconds:

```js
let cachedLeft = 0;
let cachedAt = 0;

function referenceLeft(sidebar) {
  const now = performance.now();
  if (cachedLeft > 0 && now - cachedAt < 500) return cachedLeft;
  cachedLeft = sidebar.getBoundingClientRect().left + 14;
  cachedAt = now;
  return cachedLeft;
}
```

Short enough that a resize or a collapse corrects itself immediately; long enough
that a burst of work shares one measurement.

## Disconnect what you connect

An observer holds on to the element it watches, so an observer left running for an
element Antigravity has thrown away keeps that element — and everything inside it —
in memory, and keeps waking up for it. In a session where hundreds of rows come and
go, that alone turns into a slow application.

`plugin.dom.observe` fires once per element, so the usual shape is one observer per
element with a way to take it back down:

```js
plugin.dom.observe('[data-testid="conversation-row-sidebar"]', (row) => {
  const observer = new MutationObserver(() => paint(row));
  observer.observe(row, { attributes: true, attributeFilter: ['class'] });
  // …and disconnect it when the row goes away, alongside any listener you added.
});
```

Everything the plugin API hands you — `dom.observe`, `patcher`, listeners
registered through it — is released when the plugin stops. Anything you build with
`new` is yours to release.

## Checking your own work

With BetterGravity installed, Antigravity always listens on a DevTools port. The
number is on the first line of `%APPDATA%\Antigravity\DevToolsActivePort`. Open
`http://127.0.0.1:<port>` in Chrome and pick the window: that is Chrome DevTools,
attached to Antigravity, with the console and the Performance panel.

Record a few seconds of switching between conversations, then read the bottom-up
totals:

- **Recalculate Style** in the hundreds of milliseconds means a selector problem.
- **Layout** repeated many times in one burst is the write-then-measure mistake.
  DevTools flags the individual cases as *forced reflow*.
- A block of **Script** with no rendering after it, on and on, is a watcher waking
  itself.

Two console one-liners worth keeping. Long tasks, as they happen — anything over
about 50 ms is a stutter you can see:

```js
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) console.log(Math.round(entry.duration), 'ms');
}).observe({ entryTypes: ['longtask'] });
```

And every `:has()` the browser is still tracking. Your own sheets should account
for none of them — Antigravity's own stylesheets have a few, which is not your
problem:

```js
[...document.styleSheets]
  .flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
  .filter((rule) => rule.selectorText?.includes(':has('))
  .map((rule) => rule.selectorText);
```

## When the slow part is Antigravity's own

Everything above is about not adding cost. Past a certain point the cost that is
left is not yours: it is Antigravity's, and your plugin is only making it show. A
theme that gives the sidebar its own colours makes more components ask for
colours. A restyle that adds rows to a scrolling list makes that list churn more.
Nothing in your stylesheet is wrong, and the window still stutters.

A plugin can rewrite Antigravity's own code on the way into the page. The
mechanism, and its safety rules, are in [advanced.md](advanced.md) — a `patches`
block in `plugin.json`, a `find` string that acts as a version guard, and a list
of regular expressions applied to the bundle before the page runs it. If anything
fails to match, the page gets Antigravity's original bundle, unmodified.

Two patches in the Gemini App plugin are there for this reason, and both are the
same shape: the code was right, and it ran far more often than it needed to.

**The colour table.** Antigravity keeps its sixteen theme colours in one object,
and rebuilds that object from the page every single time any component asks for a
colour — seventeen variable reads, once against the root element's inline style
and again against its computed style. That inline style attribute is 25,000
characters long, and a computed-style read has to be answered with the truth, so
each one can make the browser recalculate style first. Multiply by every
component that draws in a theme colour, on every render. In a profile of opening
four conversations, those reads alone were **375 ms**.

The patch keeps the object and hands back the same one until something that could
change a colour changes: the root element's `style` attribute, its class list, the
number of stylesheets, or the contents of `<head>`. It is not a guess about what
matters — Antigravity's own code already re-reads the table when the root's style
or class changes and at no other time, so the cache notices strictly more than the
thing it replaces. Handing back the *same object* matters as much as skipping the
reads: React compares what it is given, and an object it already has ends the
comparison immediately.

**The fading edges.** Every scrolling area in Antigravity fades at the top and
bottom when there is more to scroll to. The hook behind it watches the scroller
and each of its children for resizes, watches for rows being added and removed,
and measures the scroller on every one of those notifications — `scrollTop`,
`scrollHeight`, `clientHeight`, each a forced layout. A conversation list swapping
rows in and out as you scroll it does that continuously. In a profile of six
conversation switches, four sidebar collapses and a scroll through the list, that
one measurement was **574 ms of 1622 ms** — the largest single cost anywhere in the
application, plugin included.

The patch collects those notifications and measures once per frame instead. The
browser paints once per frame, so the fades land on exactly the same pixels; the
first measurement when a scroller appears, and the one the scroll event itself
asks for, are left alone.

If you write one of these yourself: match against the things a minifier cannot
rename — property names, string literals, CSS variable names — and reach mangled
local names with a backreference rather than by writing them down, because they
change with every Antigravity release. Check offline that your expression matches
**exactly once** against the real bundle before you ship it. And know that a new
`patches` block only takes effect when Antigravity restarts; editing CSS is live,
this is not.

## The short version

- Write `:has()` normally. The runtime takes it out of the browser's way.
- Before every write, ask whether it changes anything. End a pass over what you
  manage with `observer.takeRecords()`.
- Measure, measure, then write, write. Never write, measure, write, measure.
- Collect a burst into one pass with `queueMicrotask`. Keep
  `requestAnimationFrame` for work allowed to be a frame late.
- Give `querySelectorAll` a root, especially for `[class*="…"]` selectors.
- Script decides and marks; CSS draws and animates.
- Disconnect every observer you create, and filter every one you keep.
- When what is left is Antigravity's own work running too often, patch it — and
  keep the patch to *when* the work runs, never to what it produces.

None of these cost a pixel. Every visual detail of the Gemini App plugin — every
size, colour, radius, transition and easing curve — is the same after all of it,
which is the point: performance work that changes how something looks is a
redesign, not a fix.

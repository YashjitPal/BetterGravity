# Keeping it fast

Antigravity is a big page. A conversation with a few long answers in it is several
thousand elements, and while the agent works, parts of that page re-render many
times a second. Something that costs a fraction of a millisecond per element is
free on a settings screen and unusable in a conversation — the window stops
answering the mouse, animations step instead of sliding, and the whole
application feels broken even though nothing has crashed.

The cost depends on what each change makes the browser repeat. Stylesheet size
and script length alone do not identify a bottleneck. Profile the actual slow
interaction before adding a cache or changing when a callback runs.

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

The same applies across observer callbacks. Gemini App uses one resize observer
for its sent-message bubbles and collects mount and resize updates into a
microtask. It prepares attachment wrappers for the whole batch, reads all heights,
then updates the controls. A separate observer that measures and writes each
bubble independently recreates the same layout cost. Even setting `scrollTop = 0`
can force layout; reset it once during measurement, before changing the controls.

Also check whether the event needs a measurement at all. Gemini App's top fade
depends only on `scrollTop > 5`. It needs an initial reading and another when a
scroll event arrives, including scrolling caused by content shrinking. Replacing
virtual rows only needs to keep the fade attached to its holder. Reading
`scrollTop` after every row replacement forced layout after the sidebar's writes,
even when the scroll position had not changed.

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
const current = isCurrent ? 'true' : 'false';
if (row.dataset.geminiCurrent !== current) row.dataset.geminiCurrent = current;
```

```css
[data-gemini-current="true"] { background: var(--sidebar-secondary) !important; }
```

Everything the eye sees then comes from the stylesheet, where the browser applies
it in bulk and animates it on the compositor. A script that sets colours, sizes
and transforms element by element is doing by hand, badly, what CSS does in one
pass — and it is the reason a plugin's own animations end up stepping.

An unchanged `setAttribute` can still produce a mutation record. Reassigning
`textContent` also replaces its text nodes, even when the words stay the same.
Check the current value first. This matters for resize callbacks on message
bubbles: rewriting every unchanged expand button wakes the conversation watchers
again. The same guard on toolbar styles avoids needless root style notifications.

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

Native `document.addEventListener` and `window.addEventListener` calls also need
cleanup. A live source edit starts a new plugin instance, so an anonymous listener
without cleanup accumulates another handler on every edit:

```js
function listenToPage(target, type, listener, options) {
  target.addEventListener(type, listener, options);
  plugin.onDispose(() => target.removeEventListener(type, listener, options));
}
```

For a dropdown's outside-click and Escape handlers, attach them when the dropdown
opens and remove them when it closes or is destroyed. Keeping them on `document`
while the dropdown is closed retains its editor after navigating away.

`dom.observe` calls back immediately for elements already on screen. Initialize
the state a mount callback uses before registering it, or wait until that state
is ready before calling the later feature. A function declaration is available
before its `let` and `const` state is initialized. In Gemini App this caused an
early toolbar update to interrupt the sidebar's setup during reload. Test reloads
with an already rendered page, and use per-instance `WeakSet`s for attachment
guards so a leftover DOM flag does not prevent the next instance from attaching.

## Checking your own work

With BetterGravity installed, Antigravity always listens on a DevTools port. The
number is on the first line of `%APPDATA%\Antigravity\DevToolsActivePort`. Open
`http://127.0.0.1:<port>` in Chrome and pick the window: that is Chrome DevTools,
attached to Antigravity, with the console and the Performance panel.

Record a few seconds of switching between conversations, then read the bottom-up
totals:

- **Recalculate Style** in the hundreds of milliseconds needs investigation:
  inspect both selector matching and repeated invalidation or forced measurement.
- **Layout** repeated many times in one burst is the write-then-measure mistake.
  DevTools flags the individual cases as *forced reflow*.
- A block of **Script** with no rendering after it, on and on, is a watcher waking
  itself.

Use the same conversations, viewport, enabled plugins, and window visibility in
before/after recordings. Minimized windows throttle animation frames. Selector
statistics add substantial profiling overhead, so use them to locate expensive
rules and turn them off for timing comparisons. Passing tests alone does not
establish that an interaction became smoother.

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
of regular expressions applied to the bundle before the page runs it. Failed
replacements are reported; successful replacements can still apply, so validate
the complete result, especially when replacements depend on each other.

Six patches in the Gemini App plugin remove repeated or unused work in these
native components.

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
number of stylesheets, or stylesheet content and attributes in `<head>`. A title
change when switching conversations does not invalidate it. It is not a guess about what
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

**Clipped labels.** Measuring one label and immediately updating React state can
dirty layout before the next label is measured. The patch collects jobs by ref,
reads every label's `scrollWidth > clientWidth` first, then writes the results in
a second pass. A microtask keeps the measurements before the next paint. A
controlled check with 67 live labels returned identical clipping flags and took
0.5 ms with grouped reads versus 18.9 ms with layout dirtied between each read.
That measures this operation, not the speed of the whole application.

**Conversation-list rows.** The native virtualizer registers its row observers
immediately, then collects ref measurements for the sidebar and history list.
It reads the sizes together before notifying React, preserving its existing
measurement cache and scrolling conditions. The queued row must still be
connected and have the same index and item key when the batch runs. Other virtual
lists keep the native path.

**Following generated output.** Gemini App leaves the viewport where the user
is reading when responses or step output grow. The native hook checks a
plugin-owned policy before scheduling automatic scrolls inside a conversation,
so suppressed requests do not read layout or queue work. Initial positioning
and explicit jumps to the bottom still work. Other viewports and a disabled
Gemini App retain native following. Initial viewport tracking uses weak keys.

Remaining requests from layout effects and resize notifications are collected
by viewport ref. Read their current heights together, then apply the native
instant or smooth scroll. Recheck the policy before flushing, preserve explicit
jumps when requests merge, and discard replaced or removed viewports. The
complete hook replacement installs its helper and manual-jump path together.

**Artifact lists.** Revisiting a conversation remounts the artifact, upload, and
command-palette components. Their local memoization starts over, parsing every
file address and sorting the same lists again. A conversation with about 9,200
artifact entries spent roughly 210 ms rebuilding those projections in a live
comparison. The patch keeps the native callbacks and reuses their results for
unchanged lists across mounts.

Each component has its own cache, keyed weakly by the input array, with at most
four recent lists. Check entry identity, order, file address, workspace, and the
timestamp object and fields before reuse. Getters and unusual record types use
the native calculation. Failed palette conversions are retried as before.
Every replacement includes its own helper so a partial version mismatch cannot
leave a call to an undefined function. The original filtering, sort order,
icons, counts, hook order, and rendering stay intact.

In repeated visits to that large conversation, measured pauses fell from around
660–700 ms to around 485–505 ms with the bounded cache. The first visit still
builds the projections. These results establish a reduction in one switching
stall, not a fix for every delay during navigation or generation.

Test transitions as well as settled screens. Disabling an unused code-block
virtualizer reduced layout counts and preserved ordinary code markup, but a
live check found different scroll positions when toggling virtual rendering.
That candidate was discarded; fewer layouts alone are not enough to justify a
patch that must preserve behavior.

If you write one of these yourself: match against the things a minifier cannot
rename — property names, string literals, CSS variable names — and reach mangled
local names with a backreference rather than by writing them down, because they
change with every Antigravity release. Check offline that your expression matches
**exactly once** against the real bundle before you ship it. And know that a new
`patches` block only takes effect when Antigravity restarts; editing CSS is live,
this is not.

## Streaming text reveal

Gemini App's streaming reveal uses Willow's 610 ms opacity fade, 150 ms initial
delay, and 120 ms stagger. The stagger applies to newly introduced blocks in
each promotion and stops increasing after four steps. Long replies must not
accumulate seconds of additional waiting. Sentence/word promotions follow
Willow's cadence, with one pending timer that arriving tokens cannot postpone.

The optional native markdown hook runs inside React's existing renderer. It
decorates the fresh markdown syntax tree before React renders it; it never
rewrites React-owned DOM text. Only new text fragments receive fade spans.
Adjacent words in a promotion share a span, with a budget of 96 fragments.
Settled subtrees are skipped, and a final cleanup removes the temporary spans.
There are no animation observers, geometry reads, frame loops, blur effects,
or permanent `will-change` hints. Completed history starts on the native path;
a long running reply first encountered on navigation starts fully visible.

Native links and code retain their string children, and list task tokens remain
available to the native checkbox renderer. Code and list component types stay
stable when generation finishes, preserving mounted controls and virtualizer
state. Unchanged code cards are memoized only when all props and their complete
syntax-node data match. Context updates still reach the original renderer.

One shared motion-preference/visibility listener flushes buffered text and
cancels timers when animation should stop. Unmounting clears timer handles;
resuming after React's development cleanup can schedule them again. Finishing
generation drains the buffered suffix and lets the last fade finish. Disabling
the plugin immediately reveals the full text and releases its listeners.

The response action row waits for visual completion, including the last fade,
not just the provider's completion event. A ref on the existing markdown root
marks only its enclosing turn; multiple response segments share that gate.
The mark changes only on mount, completion, or cleanup. The existing action-row
marker covers late-mounted rows and future buttons without another observer,
timer, text scan, or geometry read. Hidden actions keep their layout space and
cannot receive keyboard focus. Their normal opacity transition starts after
the final segment settles. Unmounting or disabling the plugin releases the gate.
Visual completion is tracked separately from the native streaming flag, which
can remain true for cancelled steps. Such replies release their actions as soon
as the buffered text and fade have settled.

Verification uses an isolated root with Antigravity's real React, markdown
renderer, context providers, and follow-output hook. In a replay with 3,960
characters of existing mixed markdown and 971 final DOM elements, the reveal's
95th-percentile frame interval was 16.7–17.1 ms, with no observed long tasks
(50 ms or longer). The native comparison was 16.8 ms. Final text, block geometry,
scroll position, code/list node identity, and the user's scrolled-up position
matched. Separate checks compare intermediate markdown as formatting closes,
including links, entities, Unicode, tasks, code, and tables. These are renderer
measurements, not a guarantee about unrelated whole-application stalls.

The action/scroll changes were also checked against the installed native
renderer and footer. In a 2,104-character replay with 33 text updates, the turn
gate changed its attribute twice, the 95th-percentile frame interval was
16.8 ms, and no long tasks were observed. Code nodes, viewport position, and
the footer's layout space were retained. Separate native-hook checks cover
text growth, appended steps, manual scrolling, explicit jumps, cancellation,
late-added actions, multiple response segments, and plugin cleanup.

The source patch installs its bridge and optional renderer arguments in one
guarded replacement. A version mismatch leaves the original renderer intact;
an absent plugin also uses the original renderer. Check the real host bundle
for exactly one match and valid JavaScript before deployment.

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

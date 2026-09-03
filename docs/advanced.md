# Reaching into Antigravity

The [plugin guide](plugins.md) covers styling, storage, settings, and the DOM,
and [adding to Antigravity's interface](interface.md) covers putting your own
controls into the app. This page is about the rest: intercepting Antigravity's
own functions, reading its React tree, and watching what it sends to its
language server.

Read [what is not possible](#what-is-not-possible) first. It is short, and it
will save you time.

## What is not possible

If you have written a Vencord plugin, the technique you are reaching for is
**not available here**, and it is worth understanding why before you start.

Discord ships a webpack bundle. Vencord can ask webpack's registry for a module
by the names of its exports — `findByProps("getCurrentUser")` — because those
property names are strings that survive minification. It can then patch a
module's source before it evaluates.

Antigravity is different in both respects:

- **There is no module registry.** The interface is a single 8.7 MB script, not
  webpack chunks. There is nothing to enumerate.
- **Names do not survive.** It is compiled with Google Closure Compiler in
  advanced mode, which mangles property names as well as identifiers. Components
  are called things like `fCb` and `YM`. Searching by name finds nothing, and
  any name you did find would change next release.

So there is no `findByProps`, no `findStore`, and no patching the bundle by
component name.

You *can* still [rewrite the bundle before it runs](#rewriting-the-bundle-before-it-runs) —
just anchored on string literals, which Closure cannot mangle, rather than on
module or component names.

## What is possible

Three footholds, in rough order of usefulness.

### The language server, by name

This is the strongest one, and it has no Discord equivalent.

Antigravity's interface talks to a local language server over connect-rpc, and
**connect-rpc puts the service and method in the URL path**. Those are protobuf
names, not minified identifiers, so they survive completely:

```text
POST /exa.language_server_pb.LanguageServerService/GetLocalUserInfo
POST /exa.language_server_pb.LanguageServerService/HasAuthToken
POST /exa.language_server_pb.LanguageServerService/ReadProjects
POST /exa.language_server_pb.LanguageServerService/GetMendelFlags
POST /exa.language_server_pb.LanguageServerService/RecordAnalyticsEvent
POST /exa.language_server_pb.LanguageServerService/SubscribeToSidecars
POST /exa.language_server_pb.LanguageServerService/FetchAdminControls
POST /exa.language_server_pb.LanguageServerService/GetAuthStatus
```

That is a semantically named surface a plugin can target precisely. Watch the
log with your own plugin to discover the rest — there are many more.

```js
plugin.net.onFetch(async (request, next) => {
  const method = new URL(request.url).pathname.split("/").pop();

  if (method === "RecordAnalyticsEvent") {
    // Answer without touching the network.
    return new Response(null, { status: 200 });
  }

  const response = await next(request);
  plugin.log.info(`${method} -> ${response.status}`);
  return response;
});
```

Your plugin starts before Antigravity's own scripts, so this sees its traffic
from the first request.

**Bodies are protobuf, not JSON.** You get bytes. Reading or rewriting a body
means bringing a decoder for the message you care about; the method name in the
path is often all you need.

`plugin.net.onWebSocket` and `plugin.net.onRequest` cover sockets and
`XMLHttpRequest` the same way.

### Patching functions

Anything you can get a reference to can be intercepted, in the three shapes
BetterDiscord uses:

```js
plugin.patcher.before(target, "method", (context) => {
  context.args[0] = "changed";        // rewrite the input
});

plugin.patcher.after(target, "method", (context) => {
  return `${context.result} extra`;   // replace the result
});

plugin.patcher.instead(target, "method", (context, original) => {
  return original(...context.args);   // or do not call it at all
});
```

Several plugins can patch the same method; hooks run in registration order, and
a hook that throws is contained so the original still runs. Every patch is
removed automatically when your plugin stops.

The catch is getting the reference. With no module registry, useful targets come
from globals, from `window`, or from the React tree below.

### The React tree

React attaches its internals to DOM nodes, so any element gives you a fiber.
Component names are mangled, so **search by props** — `data-testid` is the most
stable handle Antigravity offers.

```js
const box = await plugin.dom.waitFor('[data-testid="agent-input-box"]');

plugin.react.getProps(box);
// { "data-testid": "agent-input-box", className: "...", style: {…}, children: … }

const owner = plugin.react.findOwner(box, (fiber) => fiber.memoizedProps?.onSubmit);
const rows = plugin.react.findAll(document.body, (fiber) =>
  fiber.memoizedProps?.["data-testid"] === "conversation-row-sidebar"
);
```

`findOwner` walks up, `findChild` walks down breadth-first, `findAll` collects.
`getInstance` returns a class component's instance, and `forceUpdate` re-renders
it when one exists.

Props on host elements keep their real names, which is why this works at all.
Props on Antigravity's own components are mangled like everything else, so
expect to explore.

### Rewriting the bundle before it runs

This is the closest thing here to what Vencord does, and the only capability
that cannot be expressed from inside the page: by the time your script runs,
Antigravity's has already been parsed. So these patches are declared in
`plugin.json`, read before the window opens, and applied to the bundle on its
way to the renderer.

```json
{
  "name": "No Analytics",
  "description": "Renames a sidebar entry, as a demonstration.",
  "version": "1.0.0",
  "author": "you",
  "main": "index.js",
  "patches": [
    {
      "find": "id:\"openScheduledTasks\"",
      "replace": [
        { "match": "\"Scheduled Tasks\"", "with": "\"Later\"", "all": true }
      ]
    }
  ]
}
```

`find` is a literal that must appear in the file, and acts as a version guard.
If Antigravity changes and the anchor is gone, the patch is skipped and reported
rather than applied somewhere unintended. `match` is a regular expression, so
capture groups and `$1` work; `all` replaces every occurrence instead of the
first.

Patches only run for **enabled plugins with developer mode on**, and the
interceptor is not installed at all unless some plugin declares one.

**Anchoring on strings is the whole technique.** Closure mangles identifiers but
cannot touch string literals, so `"Scheduled Tasks"`, `data-testid` values, and
RPC method names are what survive. Anchoring on anything else will not last.

Failures are reported in the log and the **Problems** tab. A patch that matches
nothing leaves the file untouched; a handler that throws serves Antigravity's
own bundle unchanged. There is no failure mode where a bad patch stops the
editor from opening.

### When to use which

| You want to | Use |
| --- | --- |
| Change what a request does | `plugin.net` |
| Intercept a function you can reach | `plugin.patcher` |
| Read or decorate rendered UI | `plugin.react` and `plugin.dom` |
| Change code that runs before you do | a `patches` block |

Reach for a source patch last. Everything else survives an Antigravity update
far better.

## Putting it together

A plugin that hides analytics calls and marks the composer:

```js
plugin.net.onFetch(async (request, next) => {
  const method = new URL(request.url).pathname.split("/").pop();
  if (method === "RecordAnalyticsEvent") return new Response(null, { status: 200 });
  return next(request);
});

plugin.dom.observe('[data-testid="agent-input-box"]', (box) => {
  box.dataset.patchedBy = plugin.manifest.id;
});

plugin.styles.add(`[data-patched-by] { outline: 1px solid var(--primary); }`);
```

Nothing here needs cleanup code: network middleware, observers, and styles are
all torn down when the plugin stops.

## A word on stability

The RPC method names are the most durable thing to build on. `data-testid`
attributes are next. Anything derived from mangled identifiers will break on the
next Antigravity release, so treat it as exploration rather than foundation.

If Antigravity changes something a plugin depends on, the plugin breaks and is
reported in the **Problems** tab — it cannot take the editor down with it.

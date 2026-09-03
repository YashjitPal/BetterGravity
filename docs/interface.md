# Adding to Antigravity's interface

`plugin.ui` puts a plugin's own controls into Antigravity: toasts, entries in
its menus, toolbar buttons, dialogs, and a screen in its settings.

Everything is built from Antigravity's own class names, so it inherits the app's
theme, spacing, and hover behaviour — including when the user switches theme.
The point is that a plugin's UI should not look bolted on.

[`examples/plugins/ui-showcase`](../examples/plugins/ui-showcase) is a working
plugin that uses every surface on this page.

## Toasts

```js
plugin.ui.toast({
  title: "Theme added",
  body: "Midnight is now available in Settings.",
  kind: "success",          // info | success | warning | error
  duration: 5000,           // 0 keeps it until dismissed
  actions: [{ label: "Show folder", onSelect: () => BetterGravity.openDirectory("themes") }]
});
```

Returns `{ dismiss() }`. Messages go into Antigravity's own toast area, so they
stack with the host's rather than covering them.

One wrinkle: plugins start before the document is parsed, so a toast shown at
startup has no host toast area to go into yet. BetterGravity puts up a stand-in
in the same position and clears it away once it empties, so this works either
way — but a startup toast is the one case where the position is ours rather than
the app's.

## Menu entries

Antigravity builds its menus with Base UI, which creates them when they open and
throws them away when they close. There is nothing to patch ahead of time, so a
plugin registers a contributor and is asked as each menu appears.

```js
plugin.ui.contextMenu((menu) => {
  if (!menu.has("conversation-rename-menu-item")) return undefined;

  const row = menu.trigger?.closest("[data-cascade-id]");
  const id = row?.dataset.cascadeId;
  if (!id) return undefined;

  return [
    {
      label: "Copy conversation id",
      icon: plugin.ui.icons.copy,
      onSelect: () => navigator.clipboard.writeText(id)
    }
  ];
});
```

Return an array of entries, or `undefined` to leave the menu alone.

**Identify a menu by `menu.has(testid)`**, not by its position or its labels.
Component names are mangled, but `data-testid` values are string literals the
compiler cannot touch, and labels change with the display language.

`menu.trigger` is the control the menu was opened from, which is usually how you
work out *what* the menu is about. `menu.testids` and `menu.labels` list the
host's own entries, and `menu.close()` closes the menu the way Escape does.

Entries can be `disabled`, or marked `danger` to draw in the app's destructive
colour like its own delete entries. They are appended after a separator, so it
stays obvious which entries came from a plugin.

One limitation: Antigravity's menus handle arrow keys through Base UI's internal
list, which does not know about entries a plugin added. Ours respond to clicks
and to Enter or Space when focused, but arrow-key navigation skips them.

## Toolbar buttons

```js
const button = plugin.ui.button({
  area: "sidebar",              // "sidebar" or "titleBar"
  label: "UI Showcase",
  icon: plugin.ui.icons.star,
  tooltip: "Open the showcase dialog",
  onClick: () => { /* … */ }
});

button.setLabel("UI Showcase (3)");
button.setActive(true);
```

`sidebar` is the column of full-width actions above the conversation list, next
to **New Conversation**. `titleBar` is the strip beside the window menus, where
buttons are icon-only.

Antigravity rebuilds its chrome as you navigate, so the button is re-added
whenever that happens. `button.element` is therefore whatever is on screen right
now, and can be `undefined` before the toolbar exists — read it each time rather
than holding on to it.

## Dialogs

```js
plugin.ui.modal({
  title: "Pick a theme",
  description: "Only one can be active at a time.",
  width: 480,
  render: (body, close) => {
    const input = plugin.ui.element("input", { class: plugin.ui.classes.input });
    body.append(input);
  }
});
```

Escape and a click outside both close it, as does the returned `{ close() }`.

## A screen in Antigravity's settings

Small options belong on the plugin's row in the BetterGravity section, where
[`plugin.settings.define`](plugin-api.md#pluginsettings) puts them for free. A
screen of its own is for plugins with enough to say to need the space.

```js
const section = plugin.ui.settingsSection({
  label: "UI Showcase",
  render: (container) => {
    container.replaceChildren(/* … */);
  }
});

section.refresh();   // re-render, if it is the screen currently showing
```

The entry appears in Antigravity's settings sidebar under BetterGravity's, named
the way the app names its own. `render` is called with an empty container each
time the screen is shown, and again on `refresh()`.

Two plugins can both call a section "Advanced" without colliding; the id is
namespaced by plugin.

## Building elements

```js
plugin.ui.element(tag, attributes?, children?): HTMLElement
plugin.ui.icon(path, size?): SVGElement
plugin.ui.classes    // the host's own class strings
plugin.ui.icons      // a few Material Symbols paths
```

`plugin.ui.classes` is the set BetterGravity's own settings screen is built from:
`button`, `buttonQuiet`, `card`, `input`, `menu`, `menuItem`, `separator`,
`title`, `subtitle`, `row`, `group`, and `groupHeading`. Using them is what makes
plugin UI match the app.

Antigravity draws its icons from Material Symbols on a `0 -960 960 960` viewBox.
`plugin.ui.icons` carries `gear`, `folder`, `trash`, `copy`, `star`, `download`,
`refresh`, `plus`, `check`, `close`, `info`, `warning`, and `error`; any other
Material Symbols path works with `plugin.ui.icon(path)`.

## Cleanup

Every registration is undone when the plugin is switched off: toasts are
dismissed, menu entries removed, buttons taken off the toolbar, dialogs closed,
and the settings entry withdrawn. There is no cleanup code to write.

## A word on stability

The class names are copied from Antigravity's rendered DOM and are the one part
of this genuinely coupled to the host's markup. If a release changes them,
plugin UI keeps working but stops matching — it is a cosmetic failure, not a
broken plugin. They are kept in a single file
([`chrome.ts`](../packages/runtime/src/world/ui/chrome.ts)) so there is one place
to update.

The containers a button attaches to and the `data-testid` values you match menus
on are more durable, for the reasons in
[a word on stability](advanced.md#a-word-on-stability).

# Making a theme

A theme is a single `.css` file. There is no build step, no toolchain, and no
reload — save the file and Antigravity restyles immediately.

## Your first theme

Open **Settings → BetterGravity**, press **Open folder** next to Themes, and
create `hello.css`:

```css
/**
 * @name        Hello
 * @description My first BetterGravity theme.
 * @author      your name
 * @version     1.0.0
 */

:root {
  --primary: #22d3ee !important;
}
```

Back in settings, switch it on. The accent colour changes everywhere at once.

## The metadata header

Metadata lives in a comment at the top of the file, so a theme stays one
portable artifact with nothing to package.

| Annotation | Used for |
| --- | --- |
| `@name` | Shown in settings. Falls back to the file name. |
| `@description` | One line under the name. |
| `@author` | Shown beside the version. |
| `@version` | Shown beside the author. |
| `@source` | Where the theme came from, so others can read it. |

Every annotation is optional.

## How far a theme reaches

Antigravity's interface is plain DOM — no shadow roots, no canvas, no iframes —
so CSS reaches all of it: the sidebar, the prompt box, messages, dialogs, menus.

### Recolour everything from the design tokens

Antigravity is built on about twenty custom properties. Override them and the
whole application follows, including screens you have never opened.

```css
:root {
  --background: #16091f !important;
  --foreground: #f4f4f5 !important;
  --primary: #22d3ee !important;
  --sidebar: #12071f !important;
  --border: #4c1d95 !important;
}
```

The full set:

`--background` `--foreground` `--primary` `--primary-foreground` `--secondary`
`--secondary-foreground` `--muted` `--muted-foreground` `--border` `--card`
`--card-border` `--sidebar` `--sidebar-secondary` `--sidebar-muted`
`--placeholder` `--link` `--error` `--warning` `--success` `--code-foreground`
`--focus-ring-color` `--max-conversation-width`

> **`!important` is required for tokens.** Antigravity applies its theme as
> inline custom properties on `<html>` — several hundred of them — and an inline
> style beats an ordinary rule. Without `!important`, token overrides are
> silently ignored. This catches everyone exactly once.

### Target components by test id

Antigravity is styled with Tailwind, so a class like `.text-sm` appears in
hundreds of places and is useless for targeting. It also ships around a hundred
`data-testid` attributes, which are specific and far more stable across
releases:

```css
[data-testid="agent-input-box"] {
  border: 2px solid #7c5cff !important;
  border-radius: 18px !important;
  box-shadow: 0 0 26px rgba(124, 92, 255, 0.35) !important;
}

[data-testid="new-conversation-button"] {
  background: linear-gradient(135deg, #7c5cff, #22d3ee) !important;
}
```

Ones you will reach for often:

| Test id | What it is |
| --- | --- |
| `agent-input-box` | The prompt box |
| `send-button` | Send |
| `model-selector-trigger` | The model dropdown |
| `new-conversation-button` | New conversation |
| `conversation-list-sidebar` | The conversation list |
| `conversation-row-sidebar` | A single conversation |
| `conversation-kebab` | A conversation's overflow menu |
| `section-header` | Sidebar section headings |
| `title-menu-bar` | The window menu bar |

To find others, open DevTools and look for `data-testid` on the element you
want.

### Replace the application's animations

Antigravity's animations are CSS keyframes, and redefining one in your theme
wins, because the last definition in document order applies:

```css
@keyframes fade-in {
  from { opacity: 0; transform: translateY(14px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}
```

Its keyframes are `fade-in`, `unread-ping`, `blobEntrance`, `parentFade`,
`logoEntrance`, `textEntrance`, `spin`, and `pulse`.

## What a theme cannot do

A theme is styling. It can change how something looks, never what it does.
Reordering a list, adding a button, changing what a click does, or reacting to
what the application is doing all need a [plugin](plugins.md). Plugins can
inject their own CSS too, so a change needing both is one plugin rather than a
plugin plus a theme.

## Two quirks

Antigravity does not render pseudo-elements on the `html` element. Use
`body::before` or `body::after` instead.

A theme file above 2 MB is skipped, and the reason is written to `runtime.log`.

## Sharing a theme

Add `@source` pointing at the file so people can read it before trusting it,
then share the `.css` however you like. Installing is dragging it onto the
BetterGravity settings page.

A complete example lives in
[`examples/themes/midnight.css`](../examples/themes/midnight.css).

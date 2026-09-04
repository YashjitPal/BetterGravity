# Making a theme

A theme is a `.css` file. There is no build step, no toolchain, and no reload —
save the file and Antigravity restyles immediately. Once a theme outgrows one
file it can become [a folder](#themes-with-more-than-one-file), and a theme
hosted online can be added [by its link](#themes-hosted-at-a-url), the way
BetterDiscord themes are.

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

Metadata lives in a comment at the top of the file (the `theme.css` of a
folder theme), so a theme stays one portable artifact with nothing to package.

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
what the application is doing all need a [plugin](plugins.md). A plugin can
carry its own stylesheets — `"styles": "look.css"` in its manifest — so a
change needing both is one plugin rather than a plugin plus a theme.

## Two quirks

Antigravity does not render pseudo-elements on the `html` element. Use
`body::before` or `body::after` instead.

A theme file above 2 MB is skipped, and the reason is written to `runtime.log`.

## Themes with more than one file

A theme can be a folder instead of a file. Put a `theme.css` in it (or
`index.css`), and keep whatever else it needs beside it: partial stylesheets,
fonts, images.

```text
themes/
└── gemini-app/
    ├── theme.css          the entry; the metadata header lives here
    ├── parts/
    │   ├── model-menu.css
    │   └── prompt-box.css
    └── fonts/
        └── google-sans-flex.woff2
```

Inside the folder, refer to files the way you would on any web page:

```css
/**
 * @name    Gemini App
 * @version 1.0.0
 */
@import "parts/model-menu.css";
@import "parts/prompt-box.css";

@font-face {
  font-family: "Google Sans Flex";
  src: url("fonts/google-sans-flex.woff2") format("woff2");
}
```

When the theme loads, BetterGravity folds the folder into one stylesheet: each
local `@import` is inlined where it stands and each local `url()` becomes an
embedded data URI. That is why relative paths work even though Antigravity's
page is served from a local web server that has never heard of your folder. A
missing file is reported in `runtime.log` and the rest of the theme still
applies. Editing any file in the folder reloads the theme, exactly like a single
file.

Folders are limited to 8 MB in total, since fonts are the usual reason to need
one. Add a folder from **Settings → BetterGravity → Themes → Add folder**, or
drop it into the themes folder yourself.

## Themes hosted at a URL

A theme can point at a stylesheet hosted elsewhere, with a remote `@import`:

```css
/**
 * @name        Gemini App
 * @description Loads the latest Gemini App theme.
 * @author      someone
 * @version     1.0.0
 */
@import url("https://someone.github.io/gemini-app/theme.css");
```

This is how BetterDiscord themes are usually distributed: the file you install
is a small stub, and the author updates the hosted stylesheet without anyone
re-downloading. It works the same here. `@import` has to be the first rule in
the file, after the header comment, or the browser ignores it. Only `https` is
loaded; Antigravity's page is `https` and the browser refuses a plain `http`
stylesheet inside it.

**Settings → BetterGravity → Themes → Add from URL** writes such a stub for you
from a pasted link.

Two things to know. The hosted stylesheet can only be as available as its host,
so a theme like this is blank while offline. And it can change at any time after
you read it — which is what you want from an author you trust, and worth
remembering about one you do not.

## Sharing a theme

Share the `.css` however you like — installing one is dragging it onto the
BetterGravity settings page. A folder theme is shared as a folder, or as a
hosted stylesheet and a stub, whichever suits.

To have it listed for everyone, submit it to
[`community/themes/`](../community/themes) as a pull request, as a file or a
folder. Submissions are reviewed and indexed into a catalog, so every listing
has a readable diff behind it. A remote `@import` is allowed and is pointed out
to the reviewer, since the review covers the stub and not what the link serves.
The rules are in [the community README](../community/README.md), and
`pnpm community:check` runs the same validation CI does.

A complete example lives in
[`community/themes/midnight.css`](../community/themes/midnight.css).

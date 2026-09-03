# Community content

Themes and plugins submitted to this repository can be browsed and installed
from inside Antigravity, under **BetterGravity → Themes** and
**BetterGravity → Plugins** in its settings.

There is no separate store to visit. Each screen lists what you have installed
and, underneath, what the catalogue offers that you do not — so finding
something new is the same act as managing what you already have.

## How it works

Listings live in [`community/`](../community) and are reviewed as pull requests.
A generated [`catalog.json`](../community/catalog.json) indexes them, validation
runs in CI, and BetterGravity reads that file directly from GitHub.

Keeping the content in git rather than on a server was deliberate. It needs no
infrastructure, every listing has a readable diff, and the review that made it a
listing stays attached to it. It also fixes the only host BetterGravity ever
talks to, which is checked on every request: a listing cannot point the client
somewhere else.

## When it reaches the network

Only when you open **Themes** or **Plugins**, and when you press **Refresh** or
**Install** on either. There is no background polling, no update check on
startup, and nothing sent the other way. An installation nobody browses makes no
requests at all.

The two screens share one fetch, and listings are cached for fifteen minutes, so
moving between them costs nothing. **Refresh** ignores the cache.

## Installing

**Install** downloads the listing and writes it into your themes or plugins
folder. It does not switch anything on: a theme changes how the app looks and a
plugin runs real code, so both wait for you to switch them on in the list above.

Something you already have is not offered again under **Available**; it is in
**Installed**, where you manage it. When the catalogue is ahead of what you
have, the **Update** button appears on that row rather than as a second listing,
because where you manage a thing is where you should be told a newer one exists.

Updating a plugin assembles the new version beside the old one and swaps it in,
so an update that fails partway through leaves the working version in place
rather than a mixture of two.

## What is checked

The catalog records a SHA-256 for every file. BetterGravity downloads a listing,
checks each file against that hash, and refuses to install anything that does
not match.

**This is an integrity check, not a signature.** It ties the bytes you install to
the bytes in a reviewed commit — CI refuses a catalog that disagrees with the
content beside it, so a file cannot change without its hash changing in a diff
someone has to approve. It is not a defence against the repository itself being
compromised, since whoever could change the content could change the catalog.
What it does rule out is a truncated download, a stale CDN copy, and a listing
quietly diverging from what was reviewed.

Alongside that, before anything is downloaded:

- Listing ids and file paths that could escape the folder they belong in are
  refused, at submission time and again at install time.
- A listing larger than the limit for its kind is refused.
- Requests are pinned to the catalog's own origin and path, and redirects are
  refused rather than followed.

## The two audiences

The gap between them is the whole design problem.

**People who want things to work** should never have to evaluate whether a
plugin is safe. They get a reviewed catalogue and links to readable source.

**People who write plugins** need to load unreviewed code from their own disk
immediately, with no publishing step. That is what developer mode is for.

A reviewed catalogue is what lets that gate become specific rather than
all-or-nothing — but it is not there yet, which is why installing a plugin still
leaves it switched off behind developer mode, and the Plugins screen says so
before you install one.

## Permissions

Plugins currently run with whatever the page can reach. A declared permission
model is the prerequisite for lifting the developer-mode gate, since it is what
allows a package to be described to a user in terms they can act on rather than
"this can do anything".

Until that exists, the honest position is the one the panel takes: plugins run
real code in the same page as your source and credentials, so only enable ones
you have read or trust.

## Submitting

Open a pull request adding your theme or plugin to `community/`. The rules are
in [the community README](../community/README.md), and `pnpm community:check`
runs the same validation CI does.

Validation is deliberately strict about the things a reviewer cannot easily
check by eye — a remote `@import` is rejected outright, because it could replace
a theme with something else after review — and deliberately lenient about things
that merely deserve a second look. Network calls, `eval`, and browser storage in
a plugin are surfaced as notes for the reviewer rather than refused, since each
is legitimate with a reason.

Themes carry their metadata inside the `.css` file itself so a theme stays a
single portable artifact; plugins carry a `plugin.json`. Both formats are
documented in [themes](themes.md) and [plugins](plugins.md).

## What will not happen

BetterGravity will not distribute Google's files, and it will not host or proxy
Antigravity itself. The catalogue carries community content only, with source
links, so anything you install can be read before you trust it.

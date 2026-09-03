# Community platform direction

This describes where the community side is going. Today you install a theme or
plugin by putting it in a folder; everything below is the plan for making that
unnecessary for people who just want things to work.

## What exists today

Community content lives in [`community/`](../community) and is reviewed as pull
requests. A generated [`catalog.json`](../community/catalog.json) indexes it,
validation runs in CI, and `packages/marketplace` holds the rules and the
catalog shape.

Keeping the content in git rather than on a server was deliberate. It needs no
infrastructure, every listing has a readable diff, and the review that made it a
listing stays attached to it. GitHub serves the files.

What does not exist yet is the part that reads the catalog: browsing and
installing from inside Antigravity. Until then, submitting shares your work and
installing means adding the file yourself.

## Where the browsing belongs

Inside Antigravity, not in the installer. The installer's job ends once the
runtime is in place. Browsing, installing, and updating community content
belongs in the settings section, alongside the themes and plugins you already
have.

## The two audiences

The gap between them is the whole design problem.

**People who want things to work** should never have to evaluate whether a
plugin is safe. They get a curated catalogue, packages with declared
permissions, and links to readable source.

**People who write plugins** need to load unreviewed code from their own disk
immediately, with no publishing step. That is what developer mode is for.

Today only the second path exists, which is why plugin loading is gated behind a
blunt switch with a frank warning. A curated catalogue is what lets that gate
become specific instead of all-or-nothing.

## Listings

A listing carries an id, name, description, version, author, an optional source
link, and the path to the content. Themes carry their metadata inside the `.css`
file itself so a theme stays a single portable artifact; plugins carry a
`plugin.json`. Both formats are documented in [themes](themes.md) and
[plugins](plugins.md).

Validation is deliberately strict about the things a reviewer cannot easily
check by eye — a remote `@import` is rejected outright, because it could replace
a theme with something else after review — and deliberately lenient about things
that merely deserve a second look. Network calls, `eval`, and browser storage in
a plugin are surfaced as notes for the reviewer rather than refused, since each
is legitimate with a reason.

## Permissions

Plugins currently run with whatever the page can reach. A declared permission
model is the prerequisite for lifting the developer-mode gate, since it is what
allows a package to be described to a user in terms they can act on rather than
"this can do anything".

Until that exists, the honest position is the one the panel takes: plugins run
real code in the same page as your source and credentials, so only enable ones
you have read or trust.

## What will not happen

BetterGravity will not distribute Google's files, and it will not host or proxy
Antigravity itself. The marketplace will carry community content only, with
source links, so anything you install can be read before you trust it.

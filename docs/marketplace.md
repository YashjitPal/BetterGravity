# Community platform direction

This describes where the community side is going. Today you install a theme or
plugin by putting it in a folder; everything below is the plan for making that
unnecessary for people who just want things to work.

## Where it belongs

Inside Antigravity, not in the installer. The installer's job ends once the
runtime is in place. Browsing, installing, and updating community content
belongs in the settings panel, alongside the themes and plugins you already
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

A marketplace listing is expected to declare an id, version, author, licence,
host compatibility, and a repository URL. `packages/marketplace` holds those
contracts; nothing consumes them yet.

Themes carry their metadata inside the `.css` file itself, in a leading comment,
so a theme stays a single portable artifact. Plugins carry a `plugin.json`.
Both formats are documented in [themes](themes.md) and [plugins](plugins.md).

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

# Community themes and plugins

This is where community content lives. Everything here is reviewed as a pull
request and indexed into [`catalog.json`](catalog.json), so every listing has a
readable diff and a review attached to it.

You do **not** need to submit anything to use a theme or plugin. Dropping a file
into your own folder works and always will — see
[themes](../docs/themes.md) and [plugins](../docs/plugins.md). Submitting here
is how you share it with everyone else.

```text
community/
├── themes/       one .css file per theme, or a folder with a theme.css inside
├── plugins/      one folder per plugin
└── catalog.json  generated; do not edit by hand
```

## Submitting

1. Fork the repository and create a branch.
2. Add your theme to `community/themes/` or your plugin folder to
   `community/plugins/`.
3. Run `pnpm community:build` to update the catalog, and commit the change.
4. Open a pull request.

`pnpm community:check` runs the same validation CI does, so you can see problems
before pushing.

## What the rules are

Both kinds must be named in lower case with hyphens — `midnight-blue.css`,
`word-count` — because the name becomes an id.

**Themes** need `@name`, `@description`, `@author`, and `@version` in the header
comment — the `theme.css` of a folder theme. A remote `@import` is allowed, as
it is for BetterDiscord themes, and is pointed out to the reviewer along with
where it points: the review covers the file in the repository, not what the link
serves later. It must be `https`. Loading a remote font or image is allowed but
flagged the same way. Limit is 2 MB for a file, 8 MB for a folder.

**Plugins** need a `plugin.json` with `name`, `description`, `version`, and
`author`. `main` must point at a file inside the folder. Do not commit
`node_modules`; a plugin has to be readable exactly as submitted. Limit is 4 MB
for the whole folder.

Some things are noted for the reviewer rather than rejected: `eval`,
`new Function`, network requests, dynamic imports, and touching browser storage.
None are forbidden, but each one needs a reason.

## What review is for

A plugin is arbitrary code running in the same page as your source and your
credentials. The point of keeping submissions in the repository is that somebody
reads them before anyone runs them, and the diff stays public afterwards.

Please make that easy: keep it readable, avoid minified or generated code, and
say what it does in the description.

## Licensing

By submitting, you agree your contribution is licensed under the repository's
[MIT licence](../LICENSE). If your work is under a different licence, say so in
the pull request.

# Plugins

One folder per plugin, named in lower case with hyphens.

```text
word-count/
├── plugin.json
└── index.js
```

```json
{
  "name": "Word Count",
  "description": "Counts words in the composer.",
  "version": "1.0.0",
  "author": "your name",
  "main": "index.js"
}
```

`name`, `description`, `version`, and `author` are required. `main` defaults to
`index.js` and must point at a file inside the folder. A plugin with a look as
well as behaviour names its stylesheets under `styles`; they must be `.css`
files inside the folder, and a `https://` `@import` in them is allowed and noted
for review, as it is for a theme.

Do not commit `node_modules`, and avoid minified or generated code — a plugin
has to be readable exactly as submitted, because that is what review depends on.

Writing one is covered in [the plugin guide](../../docs/plugins.md) and the
[API reference](../../docs/plugin-api.md). Submission rules are in
[the community README](../README.md).

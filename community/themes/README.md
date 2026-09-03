# Themes

One theme per entry, named in lower case with hyphens. An entry is either a
single `.css` file or a folder with a `theme.css` inside it and whatever that
refers to — partial stylesheets, fonts, images.

```text
themes/
├── midnight.css          a single-file theme
└── gemini-app/           a folder theme
    ├── theme.css         the entry; the header lives here
    ├── parts/menus.css
    └── fonts/…
```

```css
/**
 * @name        Midnight Blue
 * @description A calm dark theme.
 * @author      your name
 * @version     1.0.0
 * @source      https://github.com/you/midnight-blue
 */

:root {
  --primary: #22d3ee !important;
}
```

`@name`, `@description`, `@author`, and `@version` are required. `@source` is
optional. A theme may `@import` a stylesheet hosted elsewhere over `https`; the
reviewer is told where it points.

Writing one is covered in [the theme guide](../../docs/themes.md). Submission
rules are in [the community README](../README.md).

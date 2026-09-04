import fs from "node:fs";
import path from "node:path";

/**
 * Multi-file themes.
 *
 * A theme can be a folder as well as a single file. The folder holds an entry
 * stylesheet plus whatever it refers to — partial stylesheets pulled in with
 * `@import "parts/menus.css"`, fonts and images referenced with `url(...)`.
 *
 * Antigravity's page is served from a loopback origin, so a relative URL in an
 * injected stylesheet would resolve against that origin and never find the
 * file. Rather than teach the browser where the folder is, the folder is folded
 * into one stylesheet here in the main process: local imports are inlined in
 * place and local `url()` references become data URIs. What reaches the page is
 * still one string, so applying, disabling, and live-reloading a folder theme
 * work exactly as they do for a single file.
 *
 * Anything remote is left alone. A remote `@import` is hoisted to the top of the
 * bundle, where the browser requires imports to be, and fetched by the page as
 * the author intended — that is how BetterDiscord themes point at a stylesheet
 * hosted on GitHub Pages, and it works here for the same reason.
 */

/** The stylesheet a folder theme starts from, tried in this order. */
export const THEME_ENTRY_FILES = ["theme.css", "index.css"] as const;

/** Applies to the folder as a whole; fonts are the usual reason to need it. */
export const MAX_THEME_FOLDER_BYTES = 8 * 1024 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

const IMPORT_RULE = /@import\s+(?:url\(\s*(["']?)([^"')]+?)\1\s*\)|(["'])([^"']+?)\3)\s*([^;]*);/g;
const URL_REFERENCE = /url\(\s*(["']?)([^"')]+?)\1\s*\)/g;
const CHARSET_RULE = /@charset\s+["'][^"']*["']\s*;/gi;

/** Absolute in some sense: a scheme, a protocol-relative URL, a root path, or a fragment. */
const NOT_LOCAL = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|\/|#)/;

export interface ThemeBundle {
  /** The folded stylesheet, ready to inject. */
  readonly css: string;
  /** The entry file's own text, which is where the metadata header lives. */
  readonly entryCss: string;
  /** The entry file's path. */
  readonly entryFile: string;
  /** Things that did not resolve. The bundle is still usable without them. */
  readonly warnings: readonly string[];
}

export function findThemeEntry(folder: string): string | undefined {
  for (const name of THEME_ENTRY_FILES) {
    const candidate = path.join(folder, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not there; try the next name.
    }
  }
  return undefined;
}

/** Whether a folder holds any stylesheet at all, so a mistake can be reported. */
export function containsStylesheet(folder: string): boolean {
  try {
    return fs.readdirSync(folder).some((name) => name.toLowerCase().endsWith(".css"));
  } catch {
    return false;
  }
}

export function folderBytes(folder: string): number {
  let total = 0;
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  };
  walk(folder);
  return total;
}

/** Start and end offsets of every block comment, so text inside them is left alone. */
function commentRanges(text: string): readonly [number, number][] {
  const ranges: [number, number][] = [];
  const pattern = /\/\*[\s\S]*?\*\//g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

const inside = (ranges: readonly [number, number][], offset: number): boolean =>
  ranges.some(([start, end]) => offset >= start && offset < end);

/** Resolves a reference relative to the file that made it, refusing to leave the theme folder. */
function resolveLocal(root: string, from: string, reference: string): string | undefined {
  const clean = reference.split(/[?#]/)[0] ?? "";
  if (clean.length === 0) return undefined;
  const target = path.resolve(path.dirname(from), clean);
  return target === root || !target.startsWith(root + path.sep) ? undefined : target;
}

function describeReference(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

interface Context {
  readonly root: string;
  readonly hoisted: string[];
  readonly warnings: string[];
  readonly chain: readonly string[];
}

function fold(file: string, context: Context): string {
  const text = fs.readFileSync(file, "utf8").replace(CHARSET_RULE, "");
  const comments = commentRanges(text);
  const where = describeReference(context.root, file);

  const withImports = text.replace(IMPORT_RULE, (whole, _q1, urlForm: string | undefined, _q2, stringForm: string | undefined, condition: string, offset: number) => {
    if (inside(comments, offset)) return whole;
    const reference = (urlForm ?? stringForm ?? "").trim();
    if (reference.length === 0) return whole;

    if (NOT_LOCAL.test(reference)) {
      // Kept for the page to fetch, but moved to where imports are allowed.
      if (!context.hoisted.includes(whole)) context.hoisted.push(whole);
      return "";
    }

    const target = resolveLocal(context.root, file, reference);
    if (!target) {
      context.warnings.push(`${where}: @import "${reference}" points outside the theme folder and was skipped.`);
      return "";
    }
    if (context.chain.includes(target)) {
      context.warnings.push(`${where}: @import "${reference}" imports itself in a loop and was skipped.`);
      return "";
    }
    if (!fs.existsSync(target)) {
      context.warnings.push(`${where}: @import "${reference}" was not found.`);
      return "";
    }

    const inlined = fold(target, { ...context, chain: [...context.chain, target] });
    const trimmedCondition = condition.trim();
    // `layer(...)` and `supports(...)` conditions cannot be expressed by wrapping;
    // the stylesheet is inlined plainly. A media query can, and is.
    const isMedia = trimmedCondition.length > 0 && !/^(?:layer|supports)\b/i.test(trimmedCondition);
    const body = `/* ${where} → ${reference} */\n${inlined}`;
    return isMedia ? `@media ${trimmedCondition} {\n${body}\n}` : body;
  });

  const importComments = commentRanges(withImports);
  return withImports.replace(URL_REFERENCE, (whole, _quote, reference: string, offset: number) => {
    if (inside(importComments, offset)) return whole;
    const trimmed = reference.trim();
    if (trimmed.length === 0 || NOT_LOCAL.test(trimmed)) return whole;

    const target = resolveLocal(context.root, file, trimmed);
    if (!target) {
      context.warnings.push(`${where}: url(${trimmed}) points outside the theme folder and was left as written.`);
      return whole;
    }
    if (!fs.existsSync(target)) {
      context.warnings.push(`${where}: url(${trimmed}) was not found.`);
      return whole;
    }

    const mime = MIME_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream";
    const encoded = fs.readFileSync(target).toString("base64");
    return `url("data:${mime};base64,${encoded}")`;
  });
}

export interface StylesheetBundle {
  /** The folded stylesheet, ready to inject. */
  readonly css: string;
  /** Things that did not resolve. The bundle is still usable without them. */
  readonly warnings: readonly string[];
}

/**
 * Folds one stylesheet and everything it imports into a single string. Local
 * `@import`s are inlined, local `url()`s become data URIs, and remote
 * `@import`s move to the top, where the page will honour them. References are
 * confined to `root`; the same folding serves theme folders and the
 * stylesheets a plugin declares.
 */
export function bundleStylesheet(root: string, entryFile: string): StylesheetBundle {
  const resolvedRoot = path.resolve(root);
  const resolvedEntry = path.resolve(entryFile);
  const context: Context = { root: resolvedRoot, hoisted: [], warnings: [], chain: [resolvedEntry] };
  const folded = fold(resolvedEntry, context);
  const css = context.hoisted.length > 0 ? `${context.hoisted.join("\n")}\n${folded}` : folded;
  return { css, warnings: context.warnings };
}

/**
 * Folds a theme folder into one stylesheet. Throws when the folder has no entry
 * stylesheet or is over the size limit; everything else is reported as a
 * warning and the bundle is returned without it.
 */
export function bundleThemeFolder(folder: string): ThemeBundle {
  const root = path.resolve(folder);
  const entryFile = findThemeEntry(root);
  if (!entryFile) throw new Error(`The folder has no ${THEME_ENTRY_FILES.join(" or ")}.`);

  const size = folderBytes(root);
  if (size > MAX_THEME_FOLDER_BYTES) {
    throw new Error(`The folder is ${Math.round(size / 1024)} KB, above the ${Math.round(MAX_THEME_FOLDER_BYTES / 1024)} KB limit.`);
  }

  const entryCss = fs.readFileSync(entryFile, "utf8");
  const { css, warnings } = bundleStylesheet(root, entryFile);
  return { css, entryCss, entryFile, warnings };
}

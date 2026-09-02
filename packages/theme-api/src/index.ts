/**
 * A BetterGravity theme is a plain `.css` file. Rather than pairing it with a
 * separate manifest, its metadata lives in a comment at the top of the file, so
 * a theme stays a single portable artifact:
 *
 *   /**
 *    * @name        Midnight
 *    * @description A calm dark theme.
 *    * @author      someone
 *    * @version     1.0.0
 *    * @source      https://github.com/someone/midnight
 *    *\/
 */

export interface ThemeMetadata {
  readonly name?: string;
  readonly description?: string;
  readonly author?: string;
  readonly version?: string;
  /** Where the theme came from, shown so users can inspect it before trusting it. */
  readonly source?: string;
}

const RECOGNISED_KEYS = ["name", "description", "author", "version", "source"] as const;

type RecognisedKey = (typeof RECOGNISED_KEYS)[number];

const isRecognised = (key: string): key is RecognisedKey => (RECOGNISED_KEYS as readonly string[]).includes(key);

/** Matches the first block comment in the file, which is where metadata belongs. */
const LEADING_COMMENT = /^\s*\/\*+([\s\S]*?)\*\//;

/**
 * Reads `@key value` annotations out of a theme's leading comment. Unknown keys
 * are ignored, and a theme without a header is still perfectly valid.
 */
export function parseThemeMetadata(css: string): ThemeMetadata {
  const comment = LEADING_COMMENT.exec(css);
  if (!comment?.[1]) return {};

  const metadata: Record<RecognisedKey, string | undefined> = {
    name: undefined,
    description: undefined,
    author: undefined,
    version: undefined,
    source: undefined
  };

  for (const line of comment[1].split(/\r?\n/)) {
    const match = /^\s*\*?\s*@(\w+)\s+(.+?)\s*$/.exec(line);
    const key = match?.[1]?.toLowerCase();
    const value = match?.[2];
    if (!key || !value || !isRecognised(key) || metadata[key] !== undefined) continue;
    metadata[key] = value;
  }

  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
}

/** A starting header for new themes. */
export function themeMetadataTemplate(name: string): string {
  return ["/**", ` * @name        ${name}`, " * @description ", " * @author      ", " * @version     1.0.0", " */", ""].join("\n");
}

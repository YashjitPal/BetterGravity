/**
 * The contract for community submissions and the catalog built from them.
 *
 * Themes and plugins live in the repository under `community/`, are reviewed as
 * pull requests, and are indexed into a catalog that BetterGravity can read.
 * Keeping the content in git rather than on a server means every listing has a
 * readable diff and a review attached to it.
 *
 * Everything here is pure: validation takes text and returns findings, so it can
 * be exercised without a filesystem and reused by the runtime later.
 */

import { parseThemeMetadata } from "@bettergravity/theme-api";

export type ContentKind = "theme" | "plugin";

export interface CatalogEntry {
  /** The file name for a theme, the folder name for a plugin. Unique per kind. */
  readonly id: string;
  readonly kind: ContentKind;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  /** Where the author publishes it. The repository remains the source of truth. */
  readonly source?: string;
  /** Repository-relative path, so a client can fetch it without guessing. */
  readonly path: string;
  readonly bytes: number;
}

export interface Catalog {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly entries: readonly CatalogEntry[];
}

export function isCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Catalog>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.entries);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface Finding {
  /** Errors block a submission. Notes are for the reviewer's attention. */
  readonly severity: "error" | "note";
  readonly message: string;
}

export interface ValidationResult {
  readonly findings: readonly Finding[];
  /** Present only when there are no errors. */
  readonly entry?: CatalogEntry;
}

export const LIMITS = {
  themeBytes: 2 * 1024 * 1024,
  pluginBytes: 4 * 1024 * 1024
} as const;

/** Lower case, digits, and single hyphens. Keeps ids safe as path segments. */
const SAFE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const error = (message: string): Finding => ({ severity: "error", message });
const note = (message: string): Finding => ({ severity: "note", message });

function requireText(value: unknown, field: string, findings: Finding[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    findings.push(error(`${field} is required.`));
    return "";
  }
  return value.trim();
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * A remote @import can replace the entire stylesheet after review, which would
 * make reviewing it meaningless.
 */
const REMOTE_IMPORT = /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i;

export function validateTheme(fileName: string, css: string): ValidationResult {
  const findings: Finding[] = [];

  if (!fileName.toLowerCase().endsWith(".css")) findings.push(error("A theme must be a .css file."));

  const id = fileName.replace(/\.css$/i, "");
  if (!SAFE_ID.test(id)) {
    findings.push(error(`"${fileName}" should be named in lower case with hyphens, such as midnight-blue.css.`));
  }

  const bytes = byteLength(css);
  if (bytes > LIMITS.themeBytes) {
    findings.push(error(`The file is ${Math.round(bytes / 1024)} KB, above the ${LIMITS.themeBytes / 1024} KB limit.`));
  }

  const metadata = parseThemeMetadata(css);
  const name = requireText(metadata.name, "@name", findings);
  const description = requireText(metadata.description, "@description", findings);
  const author = requireText(metadata.author, "@author", findings);
  const version = requireText(metadata.version, "@version", findings);

  if (REMOTE_IMPORT.test(css)) {
    findings.push(error("Remote @import is not allowed, because it could replace the theme after review."));
  }
  if (/url\(\s*["']?https?:\/\//i.test(css)) {
    findings.push(note("Loads a remote resource. Check what it is and whether it is needed."));
  }

  if (findings.some((finding) => finding.severity === "error")) return { findings };

  return {
    findings,
    entry: {
      id: fileName,
      kind: "theme",
      name,
      description,
      version,
      author,
      ...(metadata.source ? { source: metadata.source } : {}),
      path: `community/themes/${fileName}`,
      bytes
    }
  };
}

export interface PluginFiles {
  /** Contents of plugin.json, or undefined when the file is missing. */
  readonly manifest: string | undefined;
  /** Every path inside the folder, relative to it. */
  readonly fileNames: readonly string[];
  /** Source of the resolved entry script, or undefined when it is missing. */
  readonly entrySource: string | undefined;
  readonly totalBytes: number;
}

/** Worth a reviewer's attention rather than grounds for rejection. */
const REVIEW_PATTERNS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\beval\s*\(/, why: "uses eval" },
  { pattern: /new\s+Function\s*\(/, why: "builds code with new Function" },
  { pattern: /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket\s*\(/, why: "makes network requests" },
  { pattern: /\bimport\s*\(/, why: "imports a module dynamically" },
  { pattern: /localStorage|sessionStorage|document\.cookie/, why: "touches browser storage or cookies" }
];

export function validatePlugin(folderName: string, files: PluginFiles): ValidationResult {
  const findings: Finding[] = [];

  if (!SAFE_ID.test(folderName)) {
    findings.push(error(`"${folderName}" should be named in lower case with hyphens, such as word-count.`));
  }

  if (files.manifest === undefined) {
    findings.push(error("plugin.json is missing."));
    return { findings };
  }

  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(files.manifest);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    manifest = parsed as Record<string, unknown>;
  } catch {
    findings.push(error("plugin.json is not valid JSON."));
    return { findings };
  }

  const name = requireText(manifest["name"], "name", findings);
  const description = requireText(manifest["description"], "description", findings);
  const version = requireText(manifest["version"], "version", findings);
  const author = requireText(manifest["author"], "author", findings);

  const declared = manifest["main"];
  const main = typeof declared === "string" && declared.trim() ? declared.trim() : "index.js";
  if (main.startsWith("/") || main.includes("..") || main.includes("\\")) {
    findings.push(error(`main "${main}" must stay inside the plugin folder.`));
  } else if (!files.fileNames.includes(main)) {
    findings.push(error(`main "${main}" does not exist in the folder.`));
  }

  if (files.totalBytes > LIMITS.pluginBytes) {
    findings.push(
      error(`The folder is ${Math.round(files.totalBytes / 1024)} KB, above the ${LIMITS.pluginBytes / 1024} KB limit.`)
    );
  }

  if (files.fileNames.some((file) => file === "node_modules" || file.startsWith("node_modules/"))) {
    findings.push(error("Do not commit node_modules. A plugin has to be readable exactly as submitted."));
  }

  const source = files.entrySource ?? "";
  for (const { pattern, why } of REVIEW_PATTERNS) {
    if (pattern.test(source)) findings.push(note(`Entry script ${why}.`));
  }

  if (findings.some((finding) => finding.severity === "error")) return { findings };

  const declaredSource = manifest["source"];
  return {
    findings,
    entry: {
      id: folderName,
      kind: "plugin",
      name,
      description,
      version,
      author,
      ...(typeof declaredSource === "string" ? { source: declaredSource } : {}),
      path: `community/plugins/${folderName}`,
      bytes: files.totalBytes
    }
  };
}

export function buildCatalog(entries: readonly CatalogEntry[], generatedAt = new Date().toISOString()): Catalog {
  const sorted = [...entries].sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));
  return { schemaVersion: 1, generatedAt, entries: sorted };
}

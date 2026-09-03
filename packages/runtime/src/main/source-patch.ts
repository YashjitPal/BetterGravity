/**
 * Rewriting Antigravity's own bundle before it executes.
 *
 * This is the one capability that needs the main process: by the time a plugin
 * runs in the page, the application's script has already been parsed. So
 * patches are declared statically in plugin.json, read before the page loads,
 * and applied to the response on its way to the renderer.
 *
 * The bundle is compiled by Closure Compiler, so identifiers are mangled and the
 * only durable anchors are string literals the compiler had to preserve. That
 * makes patches powerful and brittle in equal measure, which is why every one of
 * them reports whether it actually applied.
 */

export interface SourceReplacement {
  /** A regular expression source string, matched against the whole bundle. */
  readonly match: string;
  /** Replacement text. Supports $1-style group references. */
  readonly with: string;
  /** Replace every occurrence rather than only the first. */
  readonly all?: boolean;
}

export interface SourcePatch {
  /**
   * A literal that must appear in the bundle for this patch to apply. Acts as a
   * version guard: if Antigravity changes and the anchor is gone, the patch is
   * skipped and reported instead of corrupting the file.
   */
  readonly find: string;
  readonly replace: readonly SourceReplacement[];
}

export interface PluginPatches {
  readonly pluginId: string;
  readonly patches: readonly SourcePatch[];
}

export interface PatchFailure {
  readonly pluginId: string;
  readonly reason: string;
  /**
   * A missing anchor is expected when a patch targets one file and is offered
   * another, so callers can hold those back rather than reporting noise.
   */
  readonly kind: "anchor" | "match" | "invalid" | "excessive";
}

export interface PatchOutcome {
  readonly source: string;
  readonly changed: boolean;
  readonly applied: readonly string[];
  readonly failures: readonly PatchFailure[];
}

/** Guards against a replacement that would rewrite half the file. */
const MAX_REPLACEMENTS = 200;

function compile(pattern: string, all: boolean): RegExp {
  return new RegExp(pattern, all ? "g" : "");
}

export function applySourcePatches(source: string, sets: readonly PluginPatches[]): PatchOutcome {
  let current = source;
  const applied: string[] = [];
  const failures: PatchFailure[] = [];

  for (const { pluginId, patches } of sets) {
    let pluginChanged = false;

    for (const [index, patch] of patches.entries()) {
      const where = patches.length > 1 ? ` (patch ${index + 1})` : "";

      if (typeof patch.find !== "string" || patch.find.length === 0) {
        failures.push({ pluginId, kind: "invalid", reason: `${where || "patch"} has no "find" anchor.`.trim() });
        continue;
      }
      if (!current.includes(patch.find)) {
        failures.push({ pluginId, kind: "anchor", reason: `anchor not found${where}: ${JSON.stringify(patch.find.slice(0, 60))}` });
        continue;
      }

      for (const replacement of patch.replace ?? []) {
        let expression: RegExp;
        try {
          expression = compile(replacement.match, replacement.all === true);
        } catch (error) {
          failures.push({ pluginId, kind: "invalid", reason: `invalid match${where}: ${error instanceof Error ? error.message : String(error)}` });
          continue;
        }

        const matches = current.match(expression);
        if (!matches) {
          failures.push({ pluginId, kind: "match", reason: `no match${where} for ${JSON.stringify(replacement.match.slice(0, 60))}` });
          continue;
        }
        if (replacement.all === true && matches.length > MAX_REPLACEMENTS) {
          failures.push({ pluginId, kind: "excessive", reason: `refused${where}: ${matches.length} matches exceeds the ${MAX_REPLACEMENTS} limit.` });
          continue;
        }

        current = current.replace(expression, replacement.with);
        pluginChanged = true;
      }
    }

    if (pluginChanged) applied.push(pluginId);
  }

  return { source: current, changed: current !== source, applied, failures };
}

/**
 * Reads patch declarations out of a parsed plugin.json, ignoring anything
 * malformed rather than refusing to load the plugin. A plugin with a broken
 * patch block is still a usable plugin.
 */
export function readPatches(pluginId: string, manifest: unknown): PluginPatches | undefined {
  const declared = (manifest as { patches?: unknown } | null)?.patches;
  if (!Array.isArray(declared) || declared.length === 0) return undefined;

  const patches: SourcePatch[] = [];
  for (const entry of declared) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { find?: unknown; replace?: unknown };
    if (typeof candidate.find !== "string") continue;

    const replacements: SourceReplacement[] = [];
    for (const raw of Array.isArray(candidate.replace) ? candidate.replace : []) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as { match?: unknown; with?: unknown; all?: unknown };
      if (typeof item.match !== "string" || typeof item.with !== "string") continue;
      replacements.push({ match: item.match, with: item.with, ...(item.all === true ? { all: true } : {}) });
    }

    if (replacements.length > 0) patches.push({ find: candidate.find, replace: replacements });
  }

  return patches.length > 0 ? { pluginId, patches } : undefined;
}

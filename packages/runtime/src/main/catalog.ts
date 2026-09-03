import fs from "node:fs";
import path from "node:path";
import { parseThemeMetadata } from "@bettergravity/theme-api";
import type { PluginRecord, RuntimeDiagnostic, RuntimeSettings, ThemeRecord } from "../protocol.js";
import { readPatches, type PluginPatches } from "./source-patch.js";

const MAX_THEME_BYTES = 2 * 1024 * 1024;
const MAX_PLUGIN_BYTES = 4 * 1024 * 1024;

export interface CatalogResult<T> {
  readonly entries: readonly T[];
  readonly diagnostics: readonly RuntimeDiagnostic[];
}

function listEntries(directory: string): readonly fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readBounded(file: string, limit: number): string {
  const { size } = fs.statSync(file);
  if (size > limit) throw new Error(`File is ${Math.round(size / 1024)} KB, above the ${Math.round(limit / 1024)} KB limit.`);
  return fs.readFileSync(file, "utf8");
}

/**
 * A theme is a single .css file. Styling cannot read the filesystem or reach the
 * network on its own, so themes carry none of the trust weight that plugins do.
 */
export function readThemes(directory: string, settings: RuntimeSettings): CatalogResult<ThemeRecord> {
  const entries: ThemeRecord[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];

  for (const entry of listEntries(directory)) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".css")) continue;
    try {
      const css = readBounded(path.join(directory, entry.name), MAX_THEME_BYTES);
      const metadata = parseThemeMetadata(css);
      entries.push({
        id: entry.name,
        name: metadata.name ?? path.basename(entry.name, path.extname(entry.name)),
        description: metadata.description ?? "",
        author: metadata.author ?? "Unknown",
        version: metadata.version ?? "0.0.0",
        ...(metadata.source ? { source: metadata.source } : {}),
        css,
        enabled: settings.themes.enabled.includes(entry.name)
      });
    } catch (error) {
      diagnostics.push({ source: `theme ${entry.name}`, message: describe(error) });
    }
  }

  return { entries: entries.sort((a, b) => a.name.localeCompare(b.name)), diagnostics };
}

interface PluginManifest {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly version?: unknown;
  readonly author?: unknown;
  readonly main?: unknown;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/**
 * A plugin is a directory holding plugin.json plus its entry script. Plugins run
 * real code in the page, so they are only read when developer mode is enabled.
 */
export function readPlugins(directory: string, settings: RuntimeSettings): CatalogResult<PluginRecord> {
  if (!settings.plugins.developerMode) return { entries: [], diagnostics: [] };

  const entries: PluginRecord[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];

  for (const entry of listEntries(directory)) {
    if (!entry.isDirectory()) continue;
    const base = path.join(directory, entry.name);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(base, "plugin.json"), "utf8")) as PluginManifest;
      const main = asString(manifest.main, "index.js");
      const entryFile = path.resolve(base, main);
      // Keep a manifest from reaching outside its own plugin directory.
      if (entryFile !== base && !entryFile.startsWith(base + path.sep)) {
        throw new Error("The manifest entry point escapes the plugin directory.");
      }
      entries.push({
        id: entry.name,
        name: asString(manifest.name, entry.name),
        description: asString(manifest.description, ""),
        version: asString(manifest.version, "0.0.0"),
        author: asString(manifest.author, "Unknown"),
        source: readBounded(entryFile, MAX_PLUGIN_BYTES),
        enabled: settings.plugins.enabled.includes(entry.name)
      });
    } catch (error) {
      diagnostics.push({ source: `plugin ${entry.name}`, message: describe(error) });
    }
  }

  return { entries: entries.sort((a, b) => a.name.localeCompare(b.name)), diagnostics };
}

/**
 * Patch declarations, read straight from the manifests before any window opens.
 *
 * This runs earlier than everything else in the catalog: the application's
 * bundle has to be rewritten on its way to the renderer, so the declarations
 * must be in hand before the page starts loading. Only enabled plugins count,
 * and only while developer mode is on.
 */
export function readPluginPatches(directory: string, settings: RuntimeSettings): readonly PluginPatches[] {
  if (!settings.plugins.developerMode) return [];

  const sets: PluginPatches[] = [];
  for (const entry of listEntries(directory)) {
    if (!entry.isDirectory() || !settings.plugins.enabled.includes(entry.name)) continue;
    try {
      const manifest: unknown = JSON.parse(fs.readFileSync(path.join(directory, entry.name, "plugin.json"), "utf8"));
      const declared = readPatches(entry.name, manifest);
      if (declared) sets.push(declared);
    } catch {
      // A manifest that cannot be read is reported by readPlugins instead.
    }
  }
  return sets;
}

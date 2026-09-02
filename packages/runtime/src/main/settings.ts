import fs from "node:fs";
import { DEFAULT_SETTINGS, type RuntimeSettings, type SettingsPatch } from "../protocol.js";

function uniqueStrings(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
}

/**
 * Settings are user-editable on disk, so every read is treated as untrusted and
 * normalised back to a known shape rather than trusted as parsed.
 */
export function normalizeSettings(value: unknown): RuntimeSettings {
  const candidate = (value ?? {}) as Record<string, unknown>;
  const themes = (candidate["themes"] ?? {}) as Record<string, unknown>;
  const plugins = (candidate["plugins"] ?? {}) as Record<string, unknown>;
  return {
    schemaVersion: 1,
    themes: { enabled: uniqueStrings(themes["enabled"], DEFAULT_SETTINGS.themes.enabled) },
    plugins: {
      developerMode: plugins["developerMode"] === true,
      enabled: uniqueStrings(plugins["enabled"], DEFAULT_SETTINGS.plugins.enabled)
    }
  };
}

export function readSettings(file: string): RuntimeSettings {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(file: string, settings: RuntimeSettings): void {
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

export function applyPatch(current: RuntimeSettings, patch: SettingsPatch): RuntimeSettings {
  return normalizeSettings({
    themes: { enabled: patch.themes?.enabled ?? current.themes.enabled },
    plugins: {
      developerMode: patch.plugins?.developerMode ?? current.plugins.developerMode,
      enabled: patch.plugins?.enabled ?? current.plugins.enabled
    }
  });
}

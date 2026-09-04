import fs from "node:fs";
import path from "node:path";
import type { DirectoryKey } from "../protocol.js";

export interface RuntimePaths {
  readonly root: string;
  readonly themes: string;
  readonly plugins: string;
  readonly settings: string;
  readonly storage: string;
  readonly log: string;
  /** Certificate material and the audit log for the Gemini translator. */
  readonly gemini: string;
}

/**
 * User content lives in the user's own data directory, not inside Antigravity's
 * installation. Themes, plugins, and saved plugin data then survive Antigravity
 * being updated, reinstalled, or removed entirely; only the runtime code sits
 * next to the application.
 */
export function runtimePaths(userDataDirectory: string): RuntimePaths {
  return {
    root: userDataDirectory,
    themes: path.join(userDataDirectory, "themes"),
    plugins: path.join(userDataDirectory, "plugins"),
    settings: path.join(userDataDirectory, "settings.json"),
    storage: path.join(userDataDirectory, "storage.json"),
    log: path.join(userDataDirectory, "runtime.log"),
    gemini: path.join(userDataDirectory, "gemini")
  };
}

export function ensureDirectories(paths: RuntimePaths): void {
  for (const directory of [paths.root, paths.themes, paths.plugins]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function directoryFor(paths: RuntimePaths, key: DirectoryKey): string {
  return key === "plugins" ? paths.plugins : key === "themes" ? paths.themes : paths.root;
}

/** Content that used to be written beside the installation, before 0.1.4. */
const MIGRATED_ENTRIES = ["themes", "plugins", "settings.json", "storage.json"] as const;

/** Superseded by the copy in the user data directory rather than moved. */
const DISCARDED_ENTRIES = ["runtime.log"] as const;

/**
 * Moves content from the old in-installation location to the user data
 * directory. Anything already present in the new location wins, and the old
 * directory is left in place because installation backups still live there.
 */
export function migrateLegacyContent(legacyRoot: string, paths: RuntimePaths): readonly string[] {
  if (!fs.existsSync(legacyRoot)) return [];

  const moved: string[] = [];
  for (const entry of MIGRATED_ENTRIES) {
    const from = path.join(legacyRoot, entry);
    const to = path.join(paths.root, entry);
    if (!fs.existsSync(from)) continue;

    // A themes or plugins directory created empty by an earlier install is not
    // worth reporting, and must not shadow content already in the new location.
    const isEmptyDirectory = fs.statSync(from).isDirectory() && fs.readdirSync(from).length === 0;
    if (isEmptyDirectory) {
      fs.rmSync(from, { recursive: true, force: true });
      continue;
    }

    if (fs.existsSync(to) && (!fs.statSync(to).isDirectory() || fs.readdirSync(to).length > 0)) continue;

    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
    moved.push(entry);
  }

  for (const entry of DISCARDED_ENTRIES) {
    fs.rmSync(path.join(legacyRoot, entry), { force: true });
  }

  return moved;
}

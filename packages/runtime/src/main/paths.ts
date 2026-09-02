import fs from "node:fs";
import path from "node:path";
import type { DirectoryKey } from "../protocol.js";

export interface RuntimePaths {
  readonly root: string;
  readonly themes: string;
  readonly plugins: string;
  readonly settings: string;
  readonly storage: string;
}

export function runtimePaths(runtimeDirectory: string): RuntimePaths {
  return {
    root: runtimeDirectory,
    themes: path.join(runtimeDirectory, "themes"),
    plugins: path.join(runtimeDirectory, "plugins"),
    settings: path.join(runtimeDirectory, "settings.json"),
    storage: path.join(runtimeDirectory, "storage.json")
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

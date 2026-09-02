import nodeFs from "node:fs";

export type FileSystem = typeof nodeFs;

/**
 * Electron rewrites `fs` so that any path containing `.asar` is treated as a
 * path *inside* an archive. That is right for application code and fatal here:
 * the patcher's entire job is to copy, rename, and replace the archive files
 * themselves, and under the rewritten module `copyFileSync` on `app.asar` fails
 * with an ENOENT for an empty filename rather than copying the file.
 *
 * Electron ships `original-fs` for exactly this case. Outside Electron there is
 * nothing to work around, so the standard module is used.
 */
function resolveFileSystem(): FileSystem {
  if (!("electron" in process.versions)) return nodeFs;
  try {
    // Marked external in every bundle, so this resolves to Electron's built-in.
    return require("original-fs") as FileSystem;
  } catch {
    return nodeFs;
  }
}

export const fs = resolveFileSystem();

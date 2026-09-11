import path from "node:path";
import { fs } from "./fs.js";

export interface InstallationPaths {
  readonly root: string;
  readonly executable: string;
  readonly resources: string;
  /** The live bundle Electron boots. Holds the BetterGravity bootstrap once patched. */
  readonly currentAsar: string;
  /** Antigravity's untouched bundle, moved aside during patching. */
  readonly originalAsar: string;
  readonly stagedAsar: string;
  readonly runtimeRoot: string;
  readonly runtimeCode: string;
  readonly backups: string;
}

export const RUNTIME_DIRECTORY_NAME = ".bettergravity";
export const MARKER_NAME = ".bettergravity.json";

function normalizeRoot(root: string): string {
  const normalized = path.normalize(root);
  if (path.basename(normalized) === "Resources" && path.basename(path.dirname(normalized)) === "Contents") {
    return path.dirname(path.dirname(normalized));
  }
  if (path.basename(normalized) === "Contents") {
    return path.dirname(normalized);
  }
  return normalized;
}

function isMacAppBundle(root: string): boolean {
  return root.endsWith(".app") || fs.existsSync(path.join(root, "Contents", "Resources"));
}

export function installationPaths(targetRoot: string): InstallationPaths {
  const root = normalizeRoot(targetRoot);
  const isMac = isMacAppBundle(root);
  const resources = isMac ? path.join(root, "Contents", "Resources") : path.join(root, "resources");
  const executable = isMac ? path.join(root, "Contents", "MacOS", "Antigravity") : path.join(root, "Antigravity.exe");
  const runtimeRoot = path.join(resources, RUNTIME_DIRECTORY_NAME);
  return {
    root,
    executable,
    resources,
    currentAsar: path.join(resources, "app.asar"),
    originalAsar: path.join(resources, "_app.asar"),
    stagedAsar: path.join(resources, "app.asar.bettergravity-staged"),
    runtimeRoot,
    runtimeCode: path.join(runtimeRoot, "runtime"),
    backups: path.join(runtimeRoot, "backups")
  };
}

function candidateRoots(): readonly string[] {
  if (process.platform === "darwin") {
    const home = process.env.HOME;
    return [
      "/Applications/Antigravity.app",
      home && path.join(home, "Applications", "Antigravity.app")
    ].filter((candidate): candidate is string => typeof candidate === "string");
  }

  const { LOCALAPPDATA, ProgramFiles } = process.env;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  return [
    LOCALAPPDATA && path.join(LOCALAPPDATA, "Programs", "Antigravity"),
    ProgramFiles && path.join(ProgramFiles, "Antigravity"),
    programFilesX86 && path.join(programFilesX86, "Antigravity")
  ].filter((candidate): candidate is string => typeof candidate === "string");
}

export function findAntigravityInstallation(): string | undefined {
  return candidateRoots().find((candidate) => fs.existsSync(installationPaths(candidate).executable));
}

/**
 * Rewrites a path inside a packaged `app.asar` to its unpacked twin.
 *
 * The patcher reads and writes through `original-fs`, which has no idea that
 * asar archives can be browsed as directories, so files it needs must exist as
 * real files. electron-builder is told to unpack the runtime, and this maps the
 * path to where they actually land. Outside a packaged app there is no
 * `app.asar` segment and the path is returned unchanged.
 */
export function unpackedPath(target: string): string {
  const packaged = `app.asar${path.sep}`;
  return target.includes(packaged) ? target.replace(packaged, `app.asar.unpacked${path.sep}`) : target;
}

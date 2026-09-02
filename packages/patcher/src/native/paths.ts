import fs from "node:fs";
import path from "node:path";

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

export function installationPaths(root: string): InstallationPaths {
  const resources = path.join(root, "resources");
  const runtimeRoot = path.join(resources, RUNTIME_DIRECTORY_NAME);
  return {
    root,
    executable: path.join(root, "Antigravity.exe"),
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

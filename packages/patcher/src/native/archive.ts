import crypto from "node:crypto";
import asar from "@electron/asar";
import { fs } from "./fs.js";
import type { InstallationMarker } from "@bettergravity/shared";
import { MARKER_NAME } from "./paths.js";

export interface HostManifest {
  readonly name: string;
  readonly productName: string;
  readonly version: string;
  readonly main: string;
}

function readJsonFromArchive(archivePath: string, entry: string): unknown {
  asar.uncache(archivePath);
  return JSON.parse(asar.extractFile(archivePath, entry).toString("utf8"));
}

/**
 * Reads and validates an Antigravity bundle manifest. Guards against pointing
 * the patcher at some unrelated Electron application.
 */
export function readHostManifest(archivePath: string): HostManifest {
  const manifest = readJsonFromArchive(archivePath, "package.json") as Partial<HostManifest>;
  if (manifest.name !== "antigravity" || manifest.productName !== "Antigravity" || typeof manifest.main !== "string") {
    throw new Error("The selected application is not a supported Antigravity installation.");
  }
  return {
    name: manifest.name,
    productName: manifest.productName,
    version: typeof manifest.version === "string" ? manifest.version : "unknown",
    main: manifest.main
  };
}

export function readMarker(archivePath: string): InstallationMarker | undefined {
  try {
    return readJsonFromArchive(archivePath, MARKER_NAME) as InstallationMarker;
  } catch {
    return undefined;
  }
}

/**
 * Identified by the marker file, never by package name: the bootstrap mirrors
 * the host's name and productName so Electron derives the same app name,
 * userData path, and deep-link protocol that stock Antigravity would.
 */
export function isBootstrapArchive(archivePath: string): boolean {
  return readMarker(archivePath) !== undefined;
}

export function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function uncacheAll(): void {
  asar.uncacheAll();
}

export async function createArchive(sourceDirectory: string, destination: string): Promise<void> {
  await asar.createPackage(sourceDirectory, destination);
}

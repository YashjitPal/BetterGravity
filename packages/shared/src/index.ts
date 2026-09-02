export const BETTERGRAVITY_VERSION = "0.1.3";
export const SUPPORTED_HOST = "Google Antigravity";

/**
 * Antigravity's Electron shell was mapped against the 2.x line. Bumping this
 * requires re-verifying that the shell still loads its UI from a loopback
 * language server and still uses a single createWindow chokepoint.
 */
export const SUPPORTED_HOST_MAJOR = 2;

export function isSupportedHostVersion(version: string | undefined): boolean {
  if (typeof version !== "string") return false;
  const [major] = version.split(".");
  return Number.parseInt(major ?? "", 10) === SUPPORTED_HOST_MAJOR;
}

/** Written into the bootstrap archive so an installation can describe itself. */
export interface InstallationMarker {
  readonly schemaVersion: 1;
  readonly betterGravityVersion: string;
  readonly antigravityVersion: string;
  readonly originalAsarSha256: string;
  readonly installedAt: string;
}

export type BetterGravityPackageKind = "plugin" | "theme";

export interface PackageAuthor {
  readonly name: string;
  readonly id?: string;
  readonly url?: string;
}

export interface PackageManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly kind: BetterGravityPackageKind;
  readonly author: PackageAuthor;
  readonly license: string;
  readonly hostCompatibility: string;
  readonly permissions?: readonly string[];
}

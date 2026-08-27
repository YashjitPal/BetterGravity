export const BETTERGRAVITY_VERSION = "0.1.3";
export const SUPPORTED_HOST = "Google Antigravity";

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

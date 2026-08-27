import type { PackageManifest } from "@bettergravity/shared";

export interface MarketplaceListing {
  readonly manifest: PackageManifest;
  readonly downloads: number;
  readonly rating?: number;
  readonly repositoryUrl: string;
}

export interface MarketplaceCatalog {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly listings: readonly MarketplaceListing[];
}

export function isMarketplaceCatalog(value: unknown): value is MarketplaceCatalog {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MarketplaceCatalog>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.listings);
}

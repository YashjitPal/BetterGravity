import type { PackageManifest } from "@bettergravity/shared";

export interface BetterGravityTheme {
  readonly manifest: PackageManifest & { readonly kind: "theme" };
  readonly variables: Readonly<Record<`--${string}`, string>>;
  readonly css?: string;
}

export function themeToCss(theme: BetterGravityTheme): string {
  const variables = Object.entries(theme.variables).map(([key, value]) => `  ${key}: ${value};`).join("\n");
  return `:root {\n${variables}\n}\n${theme.css ?? ""}`;
}

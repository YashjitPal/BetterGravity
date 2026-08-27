import type { PackageManifest } from "@bettergravity/shared";

export interface BetterGravityPluginContext {
  readonly log: (message: string) => void;
  readonly storage: {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
  };
}

export interface BetterGravityPlugin {
  readonly manifest: PackageManifest & { readonly kind: "plugin" };
  activate(context: BetterGravityPluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export type PluginFactory = (context: BetterGravityPluginContext) => BetterGravityPlugin;

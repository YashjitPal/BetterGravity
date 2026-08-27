import type { BetterGravityPlugin } from "@bettergravity/plugin-api";
import type { BetterGravityTheme } from "@bettergravity/theme-api";

export interface BetterGravityRuntime {
  registerPlugin(plugin: BetterGravityPlugin): void;
  registerTheme(theme: BetterGravityTheme): void;
  listPlugins(): readonly BetterGravityPlugin[];
  listThemes(): readonly BetterGravityTheme[];
}

export function createRuntime(): BetterGravityRuntime {
  const plugins: BetterGravityPlugin[] = [];
  const themes: BetterGravityTheme[] = [];
  return {
    registerPlugin: (plugin) => plugins.push(plugin),
    registerTheme: (theme) => themes.push(theme),
    listPlugins: () => [...plugins],
    listThemes: () => [...themes]
  };
}

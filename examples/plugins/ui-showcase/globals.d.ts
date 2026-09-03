// Declares the two values BetterGravity puts in scope for a plugin's entry
// script. Copy this file into your own plugin to get full type checking and
// editor completion without any build step.

import type { BetterGravityGlobal, PluginContext } from "@bettergravity/plugin-api";

declare global {
  /** This plugin's own capabilities. */
  const plugin: PluginContext;
  /** The shared runtime, common to every plugin. */
  const BetterGravity: BetterGravityGlobal;
}

export {};

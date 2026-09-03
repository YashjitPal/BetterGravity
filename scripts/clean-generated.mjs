// Removes build output and release artifacts. Never touches anything under
// version control or outside the workspace.

import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const workspace = resolve(import.meta.dirname, "..");

const targets = [
  ".electron-builder-cache",
  ".playwright-cli",
  "coverage",
  "output",
  "release",
  "apps/installer/dist",
  "apps/installer/dist-electron",
  "packages/marketplace/dist",
  "packages/patcher/dist",
  "packages/plugin-api/dist",
  "packages/runtime/dist",
  "packages/shared/dist",
  "packages/theme-api/dist"
];

for (const relativeTarget of targets) {
  const target = resolve(workspace, relativeTarget);
  if (!target.startsWith(`${workspace}${sep}`)) throw new Error(`Refusing to remove path outside workspace: ${target}`);
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  console.log(`Removed ${relativeTarget}`);
}

import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const targets = [
  ".electron-builder-cache",
  ".playwright-cli",
  "output",
  "release",
  "release-0.1.2",
  "release-0.1.2-final",
  "release-0.1.3/win-unpacked",
  "release-0.1.3/builder-debug.yml",
  "release-0.1.3/builder-effective-config.yaml",
  "release-0.1.3/@bettergravityinstaller-0.1.3-x64.nsis.7z",
  "apps/installer/dist",
  "packages/core/dist",
  "packages/marketplace/dist",
  "packages/patcher/dist",
  "packages/plugin-api/dist",
  "packages/shared/dist",
  "packages/theme-api/dist"
];

for (const relativeTarget of targets) {
  const target = resolve(workspace, relativeTarget);
  if (!target.startsWith(`${workspace}${sep}`)) throw new Error(`Refusing to remove path outside workspace: ${target}`);
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  console.log(`Removed ${relativeTarget}`);
}

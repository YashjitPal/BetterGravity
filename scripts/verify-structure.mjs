import { existsSync } from "node:fs";

const required = [
  "apps/installer/index.html",
  "apps/installer/src/main.ts",
  "apps/installer/src/ui/installer-controller.ts",
  "packages/patcher/src/index.ts",
  "packages/core/src/index.ts",
  "packages/plugin-api/src/index.ts",
  "packages/theme-api/src/index.ts",
  "packages/marketplace/src/index.ts",
  "docs/ARCHITECTURE.md",
  "docs/INSTALLER.md",
  "docs/COMMUNITY.md"
];

const missing = required.filter((file) => !existsSync(file));
if (missing.length > 0) {
  console.error(`Missing required project files:\n${missing.join("\n")}`);
  process.exit(1);
}

console.log(`Structure verified: ${required.length} required files present.`);

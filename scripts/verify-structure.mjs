// Guards the package boundaries the architecture depends on. This is a cheap
// pre-flight for `pnpm check`, not a substitute for the test suite.

import { existsSync, readFileSync } from "node:fs";

const required = [
  "apps/installer/index.html",
  "apps/installer/src/main.ts",
  "apps/installer/src/ui/installer-controller.ts",
  "apps/installer/electron/main.ts",
  "apps/installer/electron/preload.ts",
  "packages/patcher/src/index.ts",
  "packages/patcher/src/native/index.ts",
  "packages/runtime/src/protocol.ts",
  "packages/runtime/src/main/index.ts",
  "packages/runtime/src/preload/index.ts",
  "packages/runtime/src/world/index.ts",
  "examples/plugins/session-timer/plugin.json",
  "examples/themes/midnight.css",
  "packages/plugin-api/src/index.ts",
  "packages/theme-api/src/index.ts",
  "packages/marketplace/src/index.ts",
  "docs/ARCHITECTURE.md",
  "docs/INSTALLER.md",
  "docs/COMMUNITY.md",
  "docs/AUTHORING.md"
];

const missing = required.filter((file) => !existsSync(file));
if (missing.length > 0) {
  console.error(`Missing required project files:\n${missing.map((file) => `  - ${file}`).join("\n")}`);
  process.exit(1);
}

// The renderer bundle must never be able to reach privileged filesystem code.
// A stray `@bettergravity/patcher/native` import in src/ would ship node:fs to
// the browser build, so it is treated as a hard failure rather than a lint.
const browserSources = ["apps/installer/src/main.ts", "apps/installer/src/ui/installer-controller.ts", "apps/installer/src/services/patcher-gateway.ts"];
const leaked = browserSources.filter((file) => existsSync(file) && readFileSync(file, "utf8").includes("patcher/native"));
if (leaked.length > 0) {
  console.error(`Renderer sources must not import the privileged patcher:\n${leaked.map((file) => `  - ${file}`).join("\n")}`);
  process.exit(1);
}

console.log(`Structure verified: ${required.length} required files present, no privileged imports in renderer sources.`);

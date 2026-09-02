import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    // The patcher writes real archives to temp directories, which is slower than
    // a pure unit test but is the only way to cover the ASAR handling honestly.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/index.ts"],
      reporter: ["text", "html"]
    }
  }
});

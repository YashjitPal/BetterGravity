import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "./",
  server: {
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true
  }
});

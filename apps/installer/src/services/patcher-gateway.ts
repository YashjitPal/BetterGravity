import { createPreviewPatcher, type Patcher } from "@bettergravity/patcher";

// The browser build uses a safe preview adapter. A desktop shell will replace
// this with the native filesystem patcher once Antigravity's format is mapped.
export function createPatcherGateway(): Patcher {
  const previewPatcher = createPreviewPatcher();
  return {
    async detect() {
      const detectedPath = await window.betterGravityDesktop?.detectInstallation();
      if (detectedPath) {
        return { kind: "detected", path: detectedPath, antigravityVersion: "Unknown" };
      }
      return previewPatcher.detect();
    },
    run: (operation, path, onProgress) => previewPatcher.run(operation, path, onProgress)
  };
}

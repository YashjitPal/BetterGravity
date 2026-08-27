import { createPreviewPatcher, type Patcher } from "@bettergravity/patcher";

// The browser build uses a safe preview adapter. A desktop shell will replace
// this with the native filesystem patcher once Antigravity's format is mapped.
export function createPatcherGateway(): Patcher {
  const previewPatcher = createPreviewPatcher();
  return {
    async detect() {
      const detected = await window.betterGravityDesktop?.detectInstallation();
      if (!detected) return previewPatcher.detect();
      return window.betterGravityDesktop?.inspectInstallation(detected) ?? previewPatcher.detect();
    },
    async run(operation, path, onProgress) {
      if (!window.betterGravityDesktop) return previewPatcher.run(operation, path, onProgress);
      const unsubscribe = window.betterGravityDesktop.onProgress(onProgress ?? (() => undefined));
      try {
        return await window.betterGravityDesktop.runOperation(operation, path);
      } finally {
        unsubscribe();
      }
    }
  };
}

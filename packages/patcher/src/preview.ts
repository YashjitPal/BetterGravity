import { BETTERGRAVITY_VERSION, SUPPORTED_HOST } from "@bettergravity/shared";
import type { InstallOperation, InstallationState, OperationProgress, Patcher } from "./types.js";

const operationMessages: Record<InstallOperation, string> = {
  install: "BetterGravity installed successfully.",
  update: "BetterGravity updated successfully.",
  reinstall: "BetterGravity reinstalled successfully.",
  repair: "BetterGravity repaired successfully.",
  uninstall: "BetterGravity removed successfully."
};

/**
 * Stand-in used when the installer UI runs in a plain browser (`pnpm dev`).
 * It simulates the operation timeline and never reads or writes Antigravity files.
 */
export function createPreviewPatcher(): Patcher {
  let state: InstallationState = { kind: "not-found" };

  return {
    async detect() {
      return state;
    },
    async run(operation, path, onProgress) {
      const steps: readonly OperationProgress[] = [
        { percent: 18, stage: "backup", message: "Preparing an automatic backup…" },
        { percent: 42, stage: "inspect", message: `Checking ${SUPPORTED_HOST} compatibility…` },
        { percent: 72, stage: "apply", message: "Applying the BetterGravity runtime…" },
        { percent: 92, stage: "verify", message: "Verifying the installation…" },
        { percent: 100, stage: "complete", message: "All done. Your original files remain protected." }
      ];

      for (const step of steps) {
        await new Promise((resolve) => setTimeout(resolve, 240));
        onProgress?.(step);
      }

      state =
        operation === "uninstall"
          ? { kind: "detected", patchState: "unpatched", path, antigravityVersion: "Unknown", nativePatchAvailable: true }
          : {
              kind: "patched",
              patchState: "patched",
              path,
              antigravityVersion: "Unknown",
              betterGravityVersion: BETTERGRAVITY_VERSION,
              nativePatchAvailable: true
            };

      return { installation: state, message: operationMessages[operation] };
    }
  };
}

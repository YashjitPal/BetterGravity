import { BETTERGRAVITY_VERSION, SUPPORTED_HOST } from "@bettergravity/shared";

export type InstallOperation = "install" | "update" | "reinstall" | "repair";
export type InstallationKind = "not-found" | "detected" | "patched" | "needs-repatch" | "corrupted";

export type PatchState = "unpatched" | "patched" | "needs-repatch" | "corrupted" | "unknown";

export interface InstallationState {
  readonly kind: InstallationKind;
  readonly path?: string;
  readonly antigravityVersion?: string;
  readonly betterGravityVersion?: string;
  readonly patchState?: PatchState;
  readonly nativePatchAvailable?: boolean;
}

export interface OperationProgress {
  readonly percent: number;
  readonly stage: "backup" | "inspect" | "apply" | "verify" | "complete";
  readonly message: string;
}

export interface OperationResult {
  readonly installation: InstallationState;
  readonly message: string;
}

export interface Patcher {
  detect(): Promise<InstallationState>;
  run(operation: InstallOperation, path: string, onProgress?: (progress: OperationProgress) => void): Promise<OperationResult>;
}

const operationMessages: Record<InstallOperation, string> = {
  install: "BetterGravity installed successfully.",
  update: "BetterGravity updated successfully.",
  reinstall: "BetterGravity reinstalled successfully.",
  repair: "BetterGravity installation repaired successfully."
};

/**
 * A safe UI adapter used until the native desktop installer is connected.
 * It never reads or writes Antigravity files.
 */
export function createPreviewPatcher(): Patcher {
  let state: InstallationState = { kind: "not-found" };
  return {
    async detect() {
      return state;
    },
    async run(operation, path, onProgress) {
      const steps: OperationProgress[] = [
        { percent: 18, stage: "backup", message: "Preparing an automatic backup…" },
        { percent: 42, stage: "inspect", message: `Checking ${SUPPORTED_HOST} compatibility…` },
        { percent: 72, stage: "apply", message: "Applying the BetterGravity core…" },
        { percent: 92, stage: "verify", message: "Verifying the installation…" },
        { percent: 100, stage: "complete", message: "All done. Your original files remain protected." }
      ];
      for (const step of steps) {
        await new Promise((resolve) => setTimeout(resolve, 240));
        onProgress?.(step);
      }
      state = { kind: "patched", path, antigravityVersion: "Unknown", betterGravityVersion: BETTERGRAVITY_VERSION };
      return { installation: state, message: operationMessages[operation] };
    }
  };
}

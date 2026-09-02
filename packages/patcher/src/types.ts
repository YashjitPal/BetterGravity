export type InstallOperation = "install" | "update" | "reinstall" | "repair" | "uninstall";

export type InstallationKind = "not-found" | "detected" | "patched" | "needs-repatch" | "corrupted";

export type PatchState = "unpatched" | "patched" | "needs-repatch" | "corrupted" | "unknown";

export interface InstallationState {
  readonly kind: InstallationKind;
  readonly path?: string;
  readonly antigravityVersion?: string;
  readonly betterGravityVersion?: string;
  readonly patchState?: PatchState;
  readonly nativePatchAvailable?: boolean;
  readonly error?: string;
}

export interface OperationProgress {
  readonly percent: number;
  readonly stage: "inspect" | "backup" | "apply" | "verify" | "complete";
  readonly message: string;
}

export interface OperationResult {
  readonly installation: InstallationState;
  readonly message: string;
}

export type ProgressReporter = (progress: OperationProgress) => void;

export interface Patcher {
  detect(): Promise<InstallationState>;
  run(operation: InstallOperation, path: string, onProgress?: ProgressReporter): Promise<OperationResult>;
}

/**
 * Which operations make sense for a given installation. The installer uses this
 * so the UI never has to re-derive the state machine.
 */
export function availableOperations(state: InstallationState): readonly InstallOperation[] {
  switch (state.kind) {
    case "detected":
      return ["install"];
    case "patched":
      return ["reinstall", "repair", "uninstall"];
    case "needs-repatch":
      return ["update", "uninstall"];
    case "corrupted":
      return ["repair", "uninstall"];
    default:
      return [];
  }
}

import type { InstallOperation, InstallationState, OperationProgress } from "@bettergravity/patcher";

export interface InstallerViewState {
  readonly installation: InstallationState;
  readonly runningOperation?: InstallOperation;
  readonly progress?: OperationProgress;
}

/** Present progressive tense, shown while an operation runs. */
export const operationLabels: Record<InstallOperation, string> = {
  install: "Installing BetterGravity",
  update: "Updating BetterGravity",
  reinstall: "Reinstalling BetterGravity",
  repair: "Repairing BetterGravity",
  uninstall: "Removing BetterGravity"
};

/** Imperative, shown on the button itself. */
export const operationActions: Record<InstallOperation, string> = {
  install: "Install",
  update: "Update",
  reinstall: "Reinstall",
  repair: "Repair",
  uninstall: "Uninstall"
};

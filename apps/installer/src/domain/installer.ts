import type { InstallOperation, InstallationState, OperationProgress } from "@bettergravity/patcher";

export interface InstallerViewState {
  readonly installation: InstallationState;
  readonly runningOperation?: InstallOperation;
  readonly progress?: OperationProgress;
}

export const operationLabels: Record<InstallOperation, string> = {
  install: "Installing BetterGravity",
  update: "Updating BetterGravity",
  reinstall: "Reinstalling BetterGravity",
  repair: "Repairing BetterGravity"
};

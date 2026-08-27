import type { InstallOperation, InstallationState, OperationProgress, OperationResult } from "@bettergravity/patcher";

export {};

declare global {
interface BetterGravityDesktopBridge {
  detectInstallation(): Promise<string | undefined>;
  inspectInstallation(path: string): Promise<InstallationState>;
  runOperation(operation: InstallOperation, path: string): Promise<OperationResult>;
  onProgress(callback: (progress: OperationProgress) => void): () => void;
  chooseDirectory(): Promise<string | undefined>;
  closeInstaller(): void;
  readonly platform: string;
}

interface Window {
  readonly betterGravityDesktop?: BetterGravityDesktopBridge;
}
}

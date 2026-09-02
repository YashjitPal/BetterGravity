import { contextBridge, ipcRenderer } from "electron";
import type { InstallOperation, InstallationState, OperationProgress, OperationResult } from "@bettergravity/patcher";
import { INSTALLER_CHANNEL } from "./ipc.js";

const bridge = {
  detectInstallation: (): Promise<string | undefined> => ipcRenderer.invoke(INSTALLER_CHANNEL.detectInstallation),
  inspectInstallation: (installationPath: string): Promise<InstallationState> =>
    ipcRenderer.invoke(INSTALLER_CHANNEL.inspectInstallation, installationPath),
  runOperation: (operation: InstallOperation, installationPath: string): Promise<OperationResult> =>
    ipcRenderer.invoke(INSTALLER_CHANNEL.runOperation, operation, installationPath),
  onProgress: (callback: (progress: OperationProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: OperationProgress) => callback(progress);
    ipcRenderer.on(INSTALLER_CHANNEL.progress, listener);
    return () => {
      ipcRenderer.removeListener(INSTALLER_CHANNEL.progress, listener);
    };
  },
  chooseDirectory: (): Promise<string | undefined> => ipcRenderer.invoke(INSTALLER_CHANNEL.chooseDirectory),
  openRuntimeLog: (installationPath: string): Promise<string> => ipcRenderer.invoke(INSTALLER_CHANNEL.openLogs, installationPath),
  closeInstaller: (): void => ipcRenderer.send(INSTALLER_CHANNEL.close),
  platform: process.platform
};

export type BetterGravityDesktopBridge = typeof bridge;

contextBridge.exposeInMainWorld("betterGravityDesktop", bridge);

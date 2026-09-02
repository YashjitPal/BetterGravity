/** Channel names shared by the installer's main process and its preload. */
export const INSTALLER_CHANNEL = {
  chooseDirectory: "installer:choose-directory",
  detectInstallation: "installer:detect-installation",
  inspectInstallation: "installer:inspect-installation",
  runOperation: "installer:run-operation",
  progress: "installer:progress",
  openLogs: "installer:open-logs",
  close: "installer:close"
} as const;

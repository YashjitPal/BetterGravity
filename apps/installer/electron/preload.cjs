const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("betterGravityDesktop", {
  detectInstallation: () => ipcRenderer.invoke("installer:detect-installation"),
  inspectInstallation: (installationPath) => ipcRenderer.invoke("installer:inspect-installation", installationPath),
  runOperation: (operation, installationPath) => ipcRenderer.invoke("installer:run-operation", operation, installationPath),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("installer:progress", listener);
    return () => ipcRenderer.removeListener("installer:progress", listener);
  },
  chooseDirectory: () => ipcRenderer.invoke("installer:choose-directory"),
  closeInstaller: () => ipcRenderer.send("installer:close"),
  platform: process.platform
});

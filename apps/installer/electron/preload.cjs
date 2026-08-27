const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("betterGravityDesktop", {
  detectInstallation: () => ipcRenderer.invoke("installer:detect-installation"),
  chooseDirectory: () => ipcRenderer.invoke("installer:choose-directory"),
  platform: process.platform
});

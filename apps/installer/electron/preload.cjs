const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("betterGravityDesktop", {
  chooseDirectory: () => ipcRenderer.invoke("installer:choose-directory"),
  platform: process.platform
});

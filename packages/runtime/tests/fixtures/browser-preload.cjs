const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("browserHarness", {
  request: (action, args) => ipcRenderer.invoke("bettergravity:browser-request", "in-built-browser", action, args),
  setBounds: bounds => ipcRenderer.send("bettergravity:browser-bounds", "in-built-browser", bounds),
  onStateChanged: callback => ipcRenderer.on("bettergravity:browser-state", (_event, state) => callback(state))
});

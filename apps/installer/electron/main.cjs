const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const nativePatcher = require("./native-patcher.cjs");

const isDevelopment = !app.isPackaged;

function createWindow() {
  const window = new BrowserWindow({
    width: 720,
    height: 610,
    minWidth: 620,
    minHeight: 540,
    show: false,
    title: "BetterGravity Installer",
    backgroundColor: "#080b12",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDevelopment) {
    window.loadURL("http://127.0.0.1:4173");
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("installer:choose-directory", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose the Antigravity installation folder",
    properties: ["openDirectory", "dontAddToRecent"]
  });
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle("installer:detect-installation", () => nativePatcher.findAntigravityInstallation());
ipcMain.handle("installer:inspect-installation", (_event, installationPath) => nativePatcher.inspectInstallation(installationPath));
ipcMain.handle("installer:run-operation", (event, operation, installationPath) => nativePatcher.runOperation(operation, installationPath, (progress) => event.sender.send("installer:progress", progress)));
ipcMain.on("installer:close", () => app.quit());

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

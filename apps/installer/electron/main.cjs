const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const isDevelopment = !app.isPackaged;

function isAntigravityInstallation(directory) {
  return Boolean(directory) && fs.existsSync(path.join(directory, "Antigravity.exe"));
}

function findAntigravityInstallation() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Antigravity"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Antigravity"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Antigravity")
  ].filter(Boolean);

  return candidates.find(isAntigravityInstallation);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 720,
    minHeight: 620,
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

ipcMain.handle("installer:detect-installation", () => findAntigravityInstallation());

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

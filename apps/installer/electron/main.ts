import path from "node:path";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import type { InstallOperation, OperationProgress } from "@bettergravity/patcher";
import {
  findAntigravityInstallation,
  inspectInstallation,
  installationPaths,
  runOperation,
  uninstall
} from "@bettergravity/patcher/native";
import { INSTALLER_CHANNEL } from "./ipc.js";

// Set only by the dev script. Without it the built files are loaded, so the
// packaged app and a local `start:desktop` behave identically.
const devServerUrl = process.env["BG_DEV_SERVER_URL"];

// The runtime bundles sit next to the compiled main process in both the dev and
// the packaged layout, so one path works for each.
const runtimeSource = path.join(__dirname, "runtime");

function createWindow(): void {
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

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle(INSTALLER_CHANNEL.chooseDirectory, async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose the Antigravity installation folder",
    properties: ["openDirectory", "dontAddToRecent"]
  });
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle(INSTALLER_CHANNEL.detectInstallation, () => findAntigravityInstallation());

ipcMain.handle(INSTALLER_CHANNEL.inspectInstallation, (_event, installationPath: string) => inspectInstallation(installationPath));

ipcMain.handle(INSTALLER_CHANNEL.runOperation, (event, operation: InstallOperation, installationPath: string) => {
  const onProgress = (progress: OperationProgress) => event.sender.send(INSTALLER_CHANNEL.progress, progress);
  if (operation === "uninstall") return uninstall(installationPath, onProgress);
  return runOperation(operation, installationPath, { runtimeSource }, onProgress);
});

// The runtime writes its log beside the user's content, not into the
// installation, so this does not depend on which Antigravity was patched.
ipcMain.handle(INSTALLER_CHANNEL.openLogs, () =>
  shell.openPath(path.join(app.getPath("appData"), "BetterGravity", "runtime.log"))
);

ipcMain.on(INSTALLER_CHANNEL.close, () => app.quit());

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

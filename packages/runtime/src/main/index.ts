import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, app, ipcMain, session, shell } from "electron";
import {
  CHANNEL,
  type DirectoryKey,
  type RuntimeContext,
  type RuntimeState,
  type SettingsPatch
} from "../protocol.js";
import { readPlugins, readThemes } from "./catalog.js";
import { logger } from "./logger.js";
import { directoryFor, ensureDirectories, runtimePaths, type RuntimePaths } from "./paths.js";
import { applyPatch, readSettings, writeSettings } from "./settings.js";
import { attachPreload, relaxContentSecurityPolicy } from "./session.js";
import { PluginStorageStore } from "./storage.js";

const WATCH_DEBOUNCE_MS = 150;

function buildState(paths: RuntimePaths, context: RuntimeContext): RuntimeState {
  const settings = readSettings(paths.settings);
  const themes = readThemes(paths.themes, settings);
  const plugins = readPlugins(paths.plugins, settings);
  return {
    version: context.version,
    hostVersion: context.hostVersion,
    directories: { root: paths.root, themes: paths.themes, plugins: paths.plugins },
    settings,
    themes: themes.entries,
    plugins: plugins.entries,
    diagnostics: [...themes.diagnostics, ...plugins.diagnostics]
  };
}

function broadcast(state: RuntimeState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    const contents = window.webContents;
    if (!contents.isDestroyed()) contents.send(CHANNEL.stateChanged, state);
  }
}

function watchForChanges(paths: RuntimePaths, onChange: () => void): void {
  for (const directory of [paths.themes, paths.plugins]) {
    try {
      let timer: NodeJS.Timeout | undefined;
      fs.watch(directory, { persistent: false }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
      });
    } catch (error) {
      logger.error(`Could not watch ${directory}. Live reload is unavailable for it.`, error);
    }
  }
}

function registerChannels(paths: RuntimePaths, context: RuntimeContext, storage: PluginStorageStore): void {
  ipcMain.handle(CHANNEL.getState, () => buildState(paths, context));

  ipcMain.handle(CHANNEL.readStorage, () => storage.snapshot());

  ipcMain.on(CHANNEL.writeStorage, (_event, pluginId: string, key: string, value: unknown) => {
    storage.write(pluginId, key, value);
  });

  ipcMain.handle(CHANNEL.setSettings, (_event, patch: SettingsPatch) => {
    const next = applyPatch(readSettings(paths.settings), patch ?? {});
    writeSettings(paths.settings, next);
    const state = buildState(paths, context);
    broadcast(state);
    return state;
  });

  ipcMain.handle(CHANNEL.openDirectory, async (_event, key: DirectoryKey) => {
    const target = directoryFor(paths, key);
    fs.mkdirSync(target, { recursive: true });
    return shell.openPath(target);
  });

  ipcMain.on(CHANNEL.log, (_event, message: string) => logger.info(`renderer: ${message}`));
}

/**
 * Entry point invoked by the bootstrap before Antigravity's own main module.
 * Anything that throws here is caught by the bootstrap, which then continues
 * into a stock launch.
 */
export function activate(context: RuntimeContext): void {
  const paths = runtimePaths(context.runtimeDirectory);
  ensureDirectories(paths);
  logger.open(context.runtimeDirectory);
  logger.info(`Activating ${context.version} on Antigravity ${context.hostVersion} (Electron ${process.versions.electron}).`);

  if (!fs.existsSync(paths.settings)) writeSettings(paths.settings, readSettings(paths.settings));

  const storage = new PluginStorageStore(paths.storage);
  // Storage writes are debounced, so a quit has to force the last one out.
  app.on("before-quit", () => storage.flush());
  registerChannels(paths, context, storage);

  app.whenReady().then(
    () => {
      try {
        const preloadPath = path.join(__dirname, "preload.cjs");
        if (!fs.existsSync(preloadPath)) throw new Error(`The runtime preload is missing at ${preloadPath}.`);
        const target = session.defaultSession;
        relaxContentSecurityPolicy(target);
        const method = attachPreload(target, preloadPath);
        watchForChanges(paths, () => broadcast(buildState(paths, context)));
        logger.info(`Runtime active. Preload registered via ${method}.`);
      } catch (error) {
        logger.error("Runtime activation failed after app ready. Antigravity continues unmodified.", error);
      }
    },
    (error: unknown) => logger.error("Electron never became ready.", error)
  );
}

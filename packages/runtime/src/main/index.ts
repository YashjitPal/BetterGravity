import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, app, ipcMain, session, shell } from "electron";
import {
  CHANNEL,
  type CatalogEntry,
  type ContentKind,
  type ContentResult,
  type DirectoryKey,
  type PresenceActivity,
  type PresenceStatus,
  type RuntimeContext,
  type RuntimeState,
  type SettingsPatch
} from "../protocol.js";
import { readPluginPatches, readPlugins, readThemes } from "./catalog.js";
import { importPlugin, importThemeFolder, importThemes, installThemeText, removeItem, revealItem } from "./content.js";
import { fetchCatalog, installEntry } from "./marketplace.js";
import { logger } from "./logger.js";
import { directoryFor, ensureDirectories, migrateLegacyContent, runtimePaths, type RuntimePaths } from "./paths.js";
import { applyPatch, readSettings, writeSettings } from "./settings.js";
import { attachPreload, relaxContentSecurityPolicy } from "./session.js";
import { PluginStorageStore } from "./storage.js";
import { spawnGuardian } from "./guardian.js";
import { installSourceInterceptor } from "./intercept.js";
import { PresenceConnection } from "./presence.js";

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
    let timer: NodeJS.Timeout | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
    };

    // Plugins are directories, so a plugin's entry script is a level down and
    // a non-recursive watch would never see it being edited.
    try {
      fs.watch(directory, { persistent: false, recursive: true }, schedule);
    } catch {
      try {
        fs.watch(directory, { persistent: false }, schedule);
        logger.info(`Watching ${directory} without recursion; edits inside a plugin folder need a restart.`);
      } catch (error) {
        logger.error(`Could not watch ${directory}. Live reload is unavailable for it.`, error);
      }
    }
  }
}

function registerPresenceChannels(presence: PresenceConnection): void {
  const push = (status: PresenceStatus) => {
    for (const window of BrowserWindow.getAllWindows()) {
      const contents = window.webContents;
      if (!contents.isDestroyed()) contents.send(CHANNEL.presenceStatus, status);
    }
  };
  presence.onStatusChanged(push);

  ipcMain.handle(CHANNEL.presenceOpen, (_event, clientId: string) => presence.open(clientId));
  ipcMain.handle(CHANNEL.presenceUpdate, (_event, activity: PresenceActivity | undefined) =>
    presence.update(activity ?? undefined)
  );
  ipcMain.handle(CHANNEL.presenceClose, () => presence.close());
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

  // Adding or deleting content changes what is on disk, so each one answers with
  // the rebuilt state; the watcher would otherwise race the reply.
  const afterChange = (result: ContentResult): ContentResult => {
    if (result.ok) broadcast(buildState(paths, context));
    return result;
  };

  ipcMain.handle(CHANNEL.importThemes, async () => afterChange(await importThemes(paths)));
  ipcMain.handle(CHANNEL.importThemeFolder, async () => afterChange(await importThemeFolder(paths)));
  ipcMain.handle(CHANNEL.importPlugin, async () => afterChange(await importPlugin(paths)));
  ipcMain.handle(CHANNEL.installThemeText, (_event, fileName: string, css: string) =>
    afterChange(installThemeText(paths, fileName, css))
  );
  ipcMain.handle(CHANNEL.removeItem, async (_event, kind: ContentKind, id: string, label: string) =>
    afterChange(await removeItem(paths, kind, id, label))
  );
  ipcMain.handle(CHANNEL.revealItem, (_event, kind: ContentKind, id: string) => revealItem(paths, kind, id));

  ipcMain.handle(CHANNEL.fetchCatalog, async (_event, force: boolean) => fetchCatalog(force === true));
  ipcMain.handle(CHANNEL.installFromCatalog, async (_event, entry: CatalogEntry) =>
    afterChange(await installEntry(paths, entry))
  );
}

/**
 * Entry point invoked by the bootstrap before Antigravity's own main module.
 * Anything that throws here is caught by the bootstrap, which then continues
 * into a stock launch.
 */
export function activate(context: RuntimeContext): void {
  // Deliberately not app.getPath("userData"): the bootstrap restores the host's
  // app name, so that path belongs to Antigravity. BetterGravity keeps its own.
  const paths = runtimePaths(path.join(app.getPath("appData"), "BetterGravity"));
  ensureDirectories(paths);
  logger.open(paths.log);
  logger.info(`Activating ${context.version} on Antigravity ${context.hostVersion} (Electron ${process.versions.electron}).`);
  logger.info(`Content directory: ${paths.root}`);

  const migrated = migrateLegacyContent(context.runtimeDirectory, paths);
  if (migrated.length > 0) logger.info(`Moved ${migrated.join(", ")} out of the installation directory.`);

  if (!fs.existsSync(paths.settings)) writeSettings(paths.settings, readSettings(paths.settings));

  const storage = new PluginStorageStore(paths.storage);
  const presence = new PresenceConnection();
  registerChannels(paths, context, storage);
  registerPresenceChannels(presence);

  // Antigravity's own before-quit handler cancels the first quit to run its
  // shutdown, so this fires more than once.
  let shuttingDown = false;
  app.on("before-quit", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Storage writes are debounced, so a quit has to force the last one out.
    storage.flush();
    presence.dispose();
    if (readSettings(paths.settings).reapplyAfterHostUpdate) {
      spawnGuardian(path.join(context.runtimeDirectory, "runtime"), paths.log);
    }
  });

  app.whenReady().then(
    () => {
      try {
        const preloadPath = path.join(__dirname, "preload.cjs");
        if (!fs.existsSync(preloadPath)) throw new Error(`The runtime preload is missing at ${preloadPath}.`);
        const target = session.defaultSession;
      relaxContentSecurityPolicy(target);
      const method = attachPreload(target, preloadPath);

      // Read before any window opens: the bundle has to be rewritten on its way
      // to the renderer, so declarations must already be in hand.
      const patches = readPluginPatches(paths.plugins, readSettings(paths.settings));
      installSourceInterceptor(target, patches);

        watchForChanges(paths, () => broadcast(buildState(paths, context)));
        logger.info(`Runtime active. Preload registered via ${method}.`);
      } catch (error) {
        logger.error("Runtime activation failed after app ready. Antigravity continues unmodified.", error);
      }
    },
    (error: unknown) => logger.error("Electron never became ready.", error)
  );
}

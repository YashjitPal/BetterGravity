import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, app, ipcMain, session, shell } from "electron";
import {
  CHANNEL,
  SETTING_PREFIX,
  type CatalogEntry,
  type ContentKind,
  type ContentResult,
  type DirectoryKey,
  type GeminiConfig,
  type GeminiStatus,
  type PresenceActivity,
  type PresenceStatus,
  type RuntimeContext,
  type RuntimeState,
  type SettingsPatch
} from "../protocol.js";
import { readAccountProfile } from "./account.js";
import { readGeminiPlugins, readPluginPatches, readPlugins, readThemes } from "./catalog.js";
import { importPlugin, importThemeFolder, importThemes, installThemeText, removeItem, revealItem } from "./content.js";
import { GeminiTranslator } from "./gemini/index.js";
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

function registerGeminiChannels(gemini: GeminiTranslator): void {
  gemini.onStatusChanged((status: GeminiStatus) => {
    for (const window of BrowserWindow.getAllWindows()) {
      const contents = window.webContents;
      if (!contents.isDestroyed()) contents.send(CHANNEL.geminiStatus, status);
    }
  });

  ipcMain.handle(CHANNEL.geminiConfigure, (_event, config: GeminiConfig | undefined) => gemini.configure(config));
  ipcMain.handle(CHANNEL.geminiRead, () => gemini.status());
  ipcMain.handle(CHANNEL.geminiTest, () => gemini.test());
}

/**
 * The settings a Gemini plugin saved last time, read out of its own storage
 * bucket. The panel writes them there behind {@link SETTING_PREFIX}, and this is
 * the only way the main process can know the user's key before the page — and
 * with it the plugin — has loaded.
 */
function storedGeminiConfig(storage: PluginStorageStore, pluginId: string): GeminiConfig {
  const values = storage.namespace(pluginId);
  const read = (key: string): unknown => values[`${SETTING_PREFIX}${key}`];
  const text = (key: string): string | undefined => {
    const value = read(key);
    return typeof value === "string" ? value : undefined;
  };
  const flag = (key: string): boolean | undefined => {
    const value = read(key);
    return typeof value === "boolean" ? value : undefined;
  };

  const apiKey = text("apiKey");
  const baseUrl = text("baseUrl");
  const stream = flag("stream");
  const thoughts = flag("thoughts");
  const audit = flag("audit");
  // `bypass` is deliberately not read. The panel no longer offers it, so a value
  // left behind by an older version would switch the translator off at every
  // launch with nothing on screen to explain it.
  return {
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(stream === undefined ? {} : { stream }),
    ...(thoughts === undefined ? {} : { thoughts }),
    ...(audit === undefined ? {} : { audit })
  };
}

function registerChannels(
  paths: RuntimePaths,
  context: RuntimeContext,
  storage: PluginStorageStore,
  gemini: GeminiTranslator
): void {
  ipcMain.handle(CHANNEL.getState, () => buildState(paths, context));

  ipcMain.handle(CHANNEL.readStorage, () => storage.snapshot());

  ipcMain.on(CHANNEL.writeStorage, (_event, pluginId: string, key: string, value: unknown) => {
    storage.write(pluginId, key, value);
  });

  ipcMain.handle(CHANNEL.setSettings, (_event, patch: SettingsPatch) => {
    const next = applyPatch(readSettings(paths.settings), patch ?? {});
    writeSettings(paths.settings, next);
    // The translator follows the enabled list, not just the settings a running
    // plugin sends it. Switching the plugin off has to put chat back on the
    // bundled subscription there and then, and switching it on has to arm the
    // translator before the plugin's own script has had a chance to load.
    const owner = readGeminiPlugins(paths.plugins, next)[0];
    if (owner === undefined) gemini.suspend();
    else gemini.resume(() => storedGeminiConfig(storage, owner));
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

  // Read on demand rather than cached: signing into a different Google account
  // rewrites the profile while Antigravity is running, and the read is one small
  // file.
  ipcMain.handle(CHANNEL.readAccount, () => readAccountProfile(app.getPath("home")));

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
  const gemini = new GeminiTranslator(paths.gemini);
  registerChannels(paths, context, storage, gemini);
  registerPresenceChannels(presence);
  registerGeminiChannels(gemini);

  // Armed here rather than after app.whenReady() because Antigravity spawns its
  // language server from the ready handler, and the endpoint it is given has to
  // already be ours by then. Everything on this path is synchronous apart from
  // the listener binding, which finishes long before the spawn.
  const geminiPlugins = readGeminiPlugins(paths.plugins, readSettings(paths.settings));
  const firstGeminiPlugin = geminiPlugins[0];
  if (firstGeminiPlugin !== undefined) {
    if (geminiPlugins.length > 1) {
      logger.info(`Several plugins asked for the Gemini translator; ${firstGeminiPlugin} is the one it follows.`);
    }
    gemini.arm(storedGeminiConfig(storage, firstGeminiPlugin));
  } else {
    // Nothing asks for the translator, so its authority comes back out of the
    // trust store. Launch is the one moment that is safe: no language server has
    // been pointed at a certificate signed by it yet.
    void gemini.retire();
  }

  // Antigravity's own before-quit handler cancels the first quit to run its
  // shutdown, so this fires more than once.
  let shuttingDown = false;
  app.on("before-quit", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Storage writes are debounced, so a quit has to force the last one out.
    storage.flush();
    presence.dispose();
    void gemini.dispose();
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

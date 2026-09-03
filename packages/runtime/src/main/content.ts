import fs from "node:fs";
import path from "node:path";
import {
  BrowserWindow,
  dialog,
  shell,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue
} from "electron";
import type { ContentKind, ContentResult } from "../protocol.js";
import { logger } from "./logger.js";
import type { RuntimePaths } from "./paths.js";
import { MAX_THEME_FOLDER_BYTES, THEME_ENTRY_FILES, findThemeEntry, folderBytes } from "./theme-bundle.js";

const MAX_THEME_BYTES = 2 * 1024 * 1024;

const focused = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

function directoryFor(paths: RuntimePaths, kind: ContentKind): string {
  return kind === "theme" ? paths.themes : paths.plugins;
}

/**
 * Resolves an id supplied by the renderer to a path, refusing anything that
 * escapes the content directory. Ids come from the page, so they are treated as
 * untrusted even though the page is ours.
 */
function resolveContent(paths: RuntimePaths, kind: ContentKind, id: string): string | undefined {
  const base = directoryFor(paths, kind);
  const target = path.resolve(base, id);
  if (target === base || !target.startsWith(base + path.sep)) return undefined;
  return target;
}

/** Keeps a chosen name usable as a filename and unique within its directory. */
function availableName(directory: string, name: string): string {
  const extension = path.extname(name);
  const stem = path.basename(name, extension).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").trim() || "untitled";

  let candidate = `${stem}${extension}`;
  let counter = 2;
  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${stem} (${counter})${extension}`;
    counter += 1;
  }
  return candidate;
}

function describe(count: number, kind: string): string {
  return `Added ${count} ${kind}${count === 1 ? "" : "s"}.`;
}

/** Dialogs are shown against the window when there is one, so they stay modal. */
function openDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
  const window = focused();
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

function confirmDialog(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const window = focused();
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

export async function importThemes(paths: RuntimePaths): Promise<ContentResult> {
  const result = await openDialog({
    title: "Choose one or more theme files",
    filters: [{ name: "CSS themes", extensions: ["css"] }],
    properties: ["openFile", "multiSelections", "dontAddToRecent"]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false };

  fs.mkdirSync(paths.themes, { recursive: true });
  let added = 0;
  for (const source of result.filePaths) {
    try {
      if (fs.statSync(source).size > MAX_THEME_BYTES) {
        return { ok: false, message: `${path.basename(source)} is larger than 2 MB.` };
      }
      fs.copyFileSync(source, path.join(paths.themes, availableName(paths.themes, path.basename(source))));
      added += 1;
    } catch (error) {
      logger.error(`Could not add theme ${source}.`, error);
      return { ok: false, message: `Could not add ${path.basename(source)}.` };
    }
  }
  return { ok: true, message: describe(added, "theme") };
}

export async function importThemeFolder(paths: RuntimePaths): Promise<ContentResult> {
  const result = await openDialog({
    title: `Choose a theme folder (one containing ${THEME_ENTRY_FILES.join(" or ")})`,
    properties: ["openDirectory", "dontAddToRecent"]
  });
  const source = result.filePaths[0];
  if (result.canceled || !source) return { ok: false };

  if (!findThemeEntry(source)) {
    return { ok: false, message: `That folder has no ${THEME_ENTRY_FILES.join(" or ")}, so it is not a theme.` };
  }
  const size = folderBytes(source);
  if (size > MAX_THEME_FOLDER_BYTES) {
    return { ok: false, message: `${path.basename(source)} is larger than ${Math.round(MAX_THEME_FOLDER_BYTES / 1024 / 1024)} MB.` };
  }

  try {
    fs.mkdirSync(paths.themes, { recursive: true });
    const name = availableName(paths.themes, path.basename(source));
    fs.cpSync(source, path.join(paths.themes, name), { recursive: true });
    return { ok: true, message: `Added ${name}.` };
  } catch (error) {
    logger.error(`Could not add theme folder ${source}.`, error);
    return { ok: false, message: "Could not add that theme folder." };
  }
}

/** Used by the drag-and-drop path, where only the file's text is available. */
export function installThemeText(paths: RuntimePaths, fileName: string, css: string): ContentResult {
  if (!fileName.toLowerCase().endsWith(".css")) return { ok: false, message: `${fileName} is not a .css file.` };
  if (css.length > MAX_THEME_BYTES) return { ok: false, message: `${fileName} is larger than 2 MB.` };
  try {
    fs.mkdirSync(paths.themes, { recursive: true });
    fs.writeFileSync(path.join(paths.themes, availableName(paths.themes, fileName)), css);
    return { ok: true, message: `Added ${fileName}.` };
  } catch (error) {
    logger.error(`Could not add dropped theme ${fileName}.`, error);
    return { ok: false, message: `Could not add ${fileName}.` };
  }
}

export async function importPlugin(paths: RuntimePaths): Promise<ContentResult> {
  const result = await openDialog({
    title: "Choose a plugin folder",
    properties: ["openDirectory", "dontAddToRecent"]
  });
  const source = result.filePaths[0];
  if (result.canceled || !source) return { ok: false };

  if (!fs.existsSync(path.join(source, "plugin.json"))) {
    return { ok: false, message: "That folder has no plugin.json, so it is not a plugin." };
  }

  try {
    fs.mkdirSync(paths.plugins, { recursive: true });
    const name = availableName(paths.plugins, path.basename(source));
    fs.cpSync(source, path.join(paths.plugins, name), { recursive: true });
    return { ok: true, message: `Added ${name}. Enable it below to run it.` };
  } catch (error) {
    logger.error(`Could not add plugin ${source}.`, error);
    return { ok: false, message: "Could not add that plugin folder." };
  }
}

export async function removeItem(paths: RuntimePaths, kind: ContentKind, id: string, label: string): Promise<ContentResult> {
  const target = resolveContent(paths, kind, id);
  if (!target || !fs.existsSync(target)) return { ok: false, message: "That item is no longer there." };

  const choice = await confirmDialog({
    type: "warning",
    buttons: ["Cancel", "Delete"],
    defaultId: 0,
    cancelId: 0,
    title: `Delete ${label}?`,
    message: `Delete ${label}?`,
    detail: `This permanently removes it from your ${kind}s folder. It cannot be undone.`
  });
  if (choice.response !== 1) return { ok: false };

  try {
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, message: `Deleted ${label}.` };
  } catch (error) {
    logger.error(`Could not delete ${target}.`, error);
    return { ok: false, message: `Could not delete ${label}.` };
  }
}

export function revealItem(paths: RuntimePaths, kind: ContentKind, id: string): ContentResult {
  const target = resolveContent(paths, kind, id);
  if (!target || !fs.existsSync(target)) return { ok: false, message: "That item is no longer there." };
  shell.showItemInFolder(target);
  return { ok: true };
}

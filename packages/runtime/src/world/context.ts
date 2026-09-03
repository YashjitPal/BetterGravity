import type { PluginContext, PluginSettingsSchema, PluginStorage } from "@bettergravity/plugin-api";
import type { PluginRecord } from "../protocol.js";
import { createDomUtilities } from "./dom.js";
import { createNetworkTools } from "./hooks/net.js";
import { createPatcher } from "./hooks/patcher.js";
import { createReactTools } from "./hooks/react.js";
import { createUiTools } from "./ui/index.js";

export const PLUGIN_STYLE_ATTRIBUTE = "data-bettergravity-plugin-style";

/** Settings live in the plugin's own storage bucket behind a reserved prefix. */
export const SETTING_PREFIX = "setting:";

export interface ContextDependencies {
  /** Values loaded before the plugin started, so reads can stay synchronous. */
  readonly initialStorage: Readonly<Record<string, unknown>>;
  readonly persist: (pluginId: string, key: string, value: unknown) => void;
  readonly report: (message: string) => void;
}

export interface RegisteredPlugin {
  readonly record: PluginRecord;
  readonly context: PluginContext;
  schema: PluginSettingsSchema;
  readSetting(key: string): unknown;
  writeSetting(key: string, value: unknown): void;
  dispose(): void;
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const describe = (parts: readonly unknown[]) =>
  parts.map((part) => (typeof part === "string" ? part : safeStringify(part))).join(" ");

/**
 * Builds the `plugin` value handed to a plugin's entry script, and holds on to
 * everything it creates so the plugin can be torn down when it is disabled.
 */
export function createPluginContext(record: PluginRecord, dependencies: ContextDependencies): RegisteredPlugin {
  const { initialStorage, persist, report } = dependencies;
  const values: Record<string, unknown> = { ...initialStorage };
  const cleanups: (() => void)[] = [];
  const settingsListeners = new Set<(key: string, value: unknown) => void>();

  const track = (cleanup: () => void) => void cleanups.push(cleanup);

  const storage: PluginStorage = {
    get: (<Value>(key: string, fallback?: Value) => (key in values ? (values[key] as Value) : fallback)) as PluginStorage["get"],
    set: (key, value) => {
      values[key] = value;
      persist(record.id, key, value);
    },
    delete: (key) => {
      delete values[key];
      persist(record.id, key, undefined);
    },
    keys: () => Object.keys(values).filter((key) => !key.startsWith(SETTING_PREFIX))
  };

  const writeSetting = (key: string, value: unknown): void => {
    values[`${SETTING_PREFIX}${key}`] = value;
    persist(record.id, `${SETTING_PREFIX}${key}`, value);
    for (const listener of settingsListeners) {
      try {
        listener(key, value);
      } catch (error) {
        report(`${record.id}: a settings listener threw: ${safeStringify(error)}`);
      }
    }
  };

  const registered: RegisteredPlugin = {
    record,
    schema: {},
    readSetting: (key) => {
      const stored = values[`${SETTING_PREFIX}${key}`];
      return stored === undefined ? registered.schema[key]?.default : stored;
    },
    writeSetting,
    context: {
      manifest: {
        id: record.id,
        name: record.name,
        description: record.description,
        version: record.version,
        author: record.author
      },
      log: {
        info: (...parts) => report(`${record.id}: ${describe(parts)}`),
        warn: (...parts) => report(`${record.id} [warn]: ${describe(parts)}`),
        error: (...parts) => report(`${record.id} [error]: ${describe(parts)}`)
      },
      storage,
      settings: {
        define: (schema) => {
          registered.schema = schema;
          // A live view rather than a snapshot, so a plugin holding the accessor
          // always sees what the settings panel most recently wrote.
          const accessor: Record<string, unknown> = {};
          for (const key of Object.keys(schema)) {
            Object.defineProperty(accessor, key, {
              enumerable: true,
              get: () => registered.readSetting(key),
              set: (value: unknown) => writeSetting(key, value)
            });
          }
          return accessor as never;
        },
        get: <Value = unknown>(key: string) => registered.readSetting(key) as Value,
        set: writeSetting,
        onChange: (listener) => {
          settingsListeners.add(listener);
          return () => settingsListeners.delete(listener);
        }
      },
      styles: {
        add: (css) => {
          const style = document.createElement("style");
          style.setAttribute(PLUGIN_STYLE_ATTRIBUTE, record.id);
          style.textContent = css;
          // Plugins now start before the document is parsed, so head may not
          // exist yet.
          const attach = () => (document.head ?? document.documentElement)?.appendChild(style);
          if (document.head ?? document.documentElement) attach();
          else document.addEventListener("DOMContentLoaded", attach, { once: true });
          const remove = () => style.remove();
          track(remove);
          return remove;
        }
      },
      dom: createDomUtilities(track),
      patcher: createPatcher(track),
      react: createReactTools(),
      net: createNetworkTools(track),
      ui: createUiTools(record.id, track),
      onDispose: track
    },
    dispose: () => {
      while (cleanups.length > 0) {
        try {
          cleanups.pop()?.();
        } catch (error) {
          report(`${record.id}: cleanup threw: ${safeStringify(error)}`);
        }
      }
      settingsListeners.clear();
      for (const style of document.querySelectorAll(`style[${PLUGIN_STYLE_ATTRIBUTE}="${CSS.escape(record.id)}"]`)) {
        style.remove();
      }
    }
  };

  return registered;
}

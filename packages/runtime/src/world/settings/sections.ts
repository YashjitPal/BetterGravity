import type { PluginSetting } from "@bettergravity/plugin-api";
import type { ContentResult, RuntimeState } from "../../protocol.js";
import type { BetterGravityApi, PluginSummary } from "../api.js";
import { el } from "../el.js";
import {
  ICON,
  NATIVE,
  controlGroup,
  emptyState,
  expandedOptions,
  iconButton,
  nativeButton,
  nativeNumberInput,
  nativeSelect,
  nativeSwitch,
  nativeTextInput,
  optionRow,
  screenShell,
  settingGroup,
  settingRow
} from "./native.js";

export interface SectionCallbacks {
  /** Re-renders the section after something changes locally. */
  readonly refresh: () => void;
  /** Shows the outcome of an add or remove, which happens out of view. */
  readonly notify: (message: string) => void;
  readonly isExpanded: (pluginId: string) => boolean;
  readonly toggleExpanded: (pluginId: string) => void;
}

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

function run(action: Promise<ContentResult>, callbacks: SectionCallbacks): void {
  void action.then((result) => {
    // A cancelled dialog reports neither success nor a message; say nothing.
    if (result.message) callbacks.notify(result.message);
    callbacks.refresh();
  });
}

const credit = (author: string, version: string) => `${author} · ${version}`;

function themeRows(state: RuntimeState, api: BetterGravityApi, callbacks: SectionCallbacks): readonly Node[] {
  if (state.themes.length === 0) {
    return [
      emptyState("No themes yet. A theme is a single .css file.", "Add a theme", () =>
        run(api.content.addThemes(), callbacks)
      )
    ];
  }

  return state.themes.map((theme) =>
    settingRow(
      theme.name,
      [theme.description, credit(theme.author, theme.version)].filter(Boolean).join("\n"),
      controlGroup([
        iconButton(ICON.folder, `Show ${theme.id} in Explorer`, () => void api.content.reveal("theme", theme.id)),
        iconButton(ICON.trash, `Delete ${theme.name}`, () => run(api.content.remove("theme", theme.id, theme.name), callbacks)),
        nativeSwitch(theme.enabled, `Enable ${theme.name}`, () => {
          void api.setSettings({ themes: { enabled: toggled(state.settings.themes.enabled, theme.id) } });
        })
      ])
    )
  );
}

function optionControl(api: BetterGravityApi, pluginId: string, key: string, setting: PluginSetting, onChanged: () => void): Node {
  const current = api.plugins.getSetting(pluginId, key);
  const commit = (value: unknown) => {
    api.plugins.setSetting(pluginId, key, value);
    onChanged();
  };

  if (setting.type === "boolean") return nativeSwitch(current === true, setting.label, () => commit(current !== true));
  if (setting.type === "select") return nativeSelect(setting.options, current, commit);
  if (setting.type === "number") {
    return nativeNumberInput(typeof current === "number" ? current : setting.default, setting.min, setting.max, commit);
  }
  return nativeTextInput(typeof current === "string" ? current : setting.default, setting.placeholder, commit);
}

function pluginEntry(
  plugin: PluginSummary,
  state: RuntimeState,
  api: BetterGravityApi,
  callbacks: SectionCallbacks
): readonly Node[] {
  const options = Object.entries(plugin.schema);
  const configurable = plugin.running && options.length > 0;
  const expanded = configurable && callbacks.isExpanded(plugin.id);

  const controls: Node[] = [];
  if (configurable) {
    controls.push(
      iconButton(ICON.gear, `${expanded ? "Hide" : "Show"} ${plugin.name} options`, () => callbacks.toggleExpanded(plugin.id), expanded)
    );
  }
  controls.push(
    iconButton(ICON.folder, `Show ${plugin.id} in Explorer`, () => void api.content.reveal("plugin", plugin.id)),
    iconButton(ICON.trash, `Delete ${plugin.name}`, () => run(api.content.remove("plugin", plugin.id, plugin.name), callbacks)),
    nativeSwitch(plugin.enabled, `Enable ${plugin.name}`, () => {
      void api.setSettings({ plugins: { enabled: toggled(state.settings.plugins.enabled, plugin.id) } });
    })
  );

  const row = settingRow(
    plugin.name,
    [plugin.description, credit(plugin.author, plugin.version)].filter(Boolean).join("\n"),
    controlGroup(controls)
  );

  if (!expanded) return [row];

  return [
    row,
    expandedOptions(
      options.map(([key, setting]) =>
        optionRow(setting.label, setting.description, optionControl(api, plugin.id, key, setting, callbacks.refresh))
      )
    )
  ];
}

function pluginRows(
  state: RuntimeState,
  api: BetterGravityApi,
  plugins: readonly PluginSummary[],
  callbacks: SectionCallbacks
): readonly Node[] {
  const developerMode = state.settings.plugins.developerMode;

  const gate = settingRow(
    "Developer mode",
    "Plugins run real code inside Antigravity, with access to the same page your source and credentials appear in. Only turn this on for plugins you have read or trust.",
    nativeSwitch(developerMode, "Enable developer mode", () => {
      void api.setSettings({ plugins: { developerMode: !developerMode } });
    })
  );

  if (!developerMode) return [gate];

  if (plugins.length === 0) {
    return [
      gate,
      emptyState("No plugins yet. A plugin is a folder with a plugin.json and a script.", "Add a plugin", () =>
        run(api.content.addPlugin(), callbacks)
      )
    ];
  }

  return [gate, ...plugins.flatMap((plugin) => pluginEntry(plugin, state, api, callbacks))];
}

function generalRows(state: RuntimeState, api: BetterGravityApi): readonly Node[] {
  return [
    settingRow(
      "Reapply after Antigravity updates",
      "Antigravity replaces its own program files when it updates, which removes BetterGravity. Leave this on and it is put back automatically once the update finishes.",
      nativeSwitch(state.settings.reapplyAfterHostUpdate, "Reapply after Antigravity updates", () => {
        void api.setSettings({ reapplyAfterHostUpdate: !state.settings.reapplyAfterHostUpdate });
      })
    ),
    settingRow(
      "Where your files are kept",
      `${state.directories.root}\nThis is outside Antigravity, so your themes and plugins survive updates and reinstalls.`,
      nativeButton("Open", () => void api.openDirectory("root"))
    )
  ];
}

export function buildSettingsScreen(api: BetterGravityApi, callbacks: SectionCallbacks, notice?: string): HTMLElement {
  const state = api.state();
  if (!state) return screenShell("BetterGravity", "Starting up.", []);

  const plugins = api.plugins.list();

  const groups: Node[] = [
    settingGroup("Themes", themeRows(state, api, callbacks), [
      nativeButton("Add theme", () => run(api.content.addThemes(), callbacks)),
      nativeButton("Open folder", () => void api.openDirectory("themes"))
    ]),
    settingGroup("Plugins", pluginRows(state, api, plugins, callbacks), [
      nativeButton("Add plugin", () => run(api.content.addPlugin(), callbacks)),
      nativeButton("Open folder", () => void api.openDirectory("plugins"))
    ]),
    settingGroup("General", generalRows(state, api))
  ];

  if (state.diagnostics.length > 0) {
    groups.push(
      settingGroup(
        "Problems",
        state.diagnostics.map((diagnostic) => settingRow(diagnostic.source, diagnostic.message, undefined))
      )
    );
  }

  const shell = screenShell("BetterGravity", `Community themes and plugins. Version ${state.version}.`, groups, notice);
  shell.append(
    el("div", { class: "px-6 pb-6 -mt-2" }, [
      el("span", { class: NATIVE.emptyNote, text: "Tip: you can also drag a .css file onto this page to add it as a theme." })
    ])
  );
  return shell;
}

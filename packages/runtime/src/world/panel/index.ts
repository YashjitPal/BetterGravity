import type { PluginSetting } from "@bettergravity/plugin-api";
import type { RuntimeState, ThemeRecord } from "../../protocol.js";
import type { BetterGravityApi, PluginSummary } from "../api.js";
import { el, toggleSwitch } from "./dom.js";
import { PANEL_STYLES } from "./styles.js";

const HOST_ID = "bettergravity-panel";
const SHORTCUT = { key: "g", ctrl: true, shift: true };

type Tab = "themes" | "plugins" | "general" | "problems";

export interface Panel {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  destroy(): void;
}

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

/**
 * The BetterGravity settings panel. It is mounted into a shadow root attached to
 * the document element rather than the body, so Antigravity's single-page app
 * cannot remove it during a re-render, and neither side's CSS reaches the other.
 */
export function createPanel(api: BetterGravityApi): Panel {
  const host = el("div", { id: HOST_ID });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(el("style", { text: PANEL_STYLES }));

  const mount = el("div");
  shadow.append(mount);
  document.documentElement.append(host);

  let open = false;
  let tab: Tab = "themes";

  const render = (): void => {
    mount.replaceChildren();
    if (!open) return;

    const state = api.state();
    if (!state) return;

    const scrim = el("div", { class: "scrim" });
    scrim.addEventListener("click", (event) => {
      if (event.target === scrim) close();
    });

    scrim.append(
      el("div", { class: "panel" }, [buildHeader(state), buildTabs(state), buildBody(state), buildFooter()])
    );
    mount.append(scrim);
  };

  const buildHeader = (state: RuntimeState): HTMLElement => {
    const close_ = el("button", { class: "close", type: "button", "aria-label": "Close", text: "×" });
    close_.addEventListener("click", () => close());
    return el("header", {}, [
      el("div", { class: "mark" }),
      el("div", {}, [
        el("div", { class: "title", text: "BetterGravity" }),
        el("div", { class: "subtitle", text: `${state.version} · Antigravity ${state.hostVersion}` })
      ]),
      el("div", { class: "grow" }),
      close_
    ]);
  };

  const buildTabs = (state: RuntimeState): HTMLElement => {
    const nav = el("nav");
    const tabs: readonly { id: Tab; label: string }[] = [
      { id: "themes", label: `Themes (${state.themes.length})` },
      { id: "plugins", label: `Plugins (${state.plugins.length})` },
      { id: "general", label: "General" },
      ...(state.diagnostics.length > 0 ? [{ id: "problems" as Tab, label: `Problems (${state.diagnostics.length})` }] : [])
    ];
    for (const entry of tabs) {
      const button = el("button", { type: "button", "aria-selected": tab === entry.id, text: entry.label });
      button.addEventListener("click", () => {
        tab = entry.id;
        render();
      });
      nav.append(button);
    }
    return nav;
  };

  const buildBody = (state: RuntimeState): HTMLElement => {
    const main = el("main");
    if (tab === "themes") main.append(...buildThemes(state));
    else if (tab === "plugins") main.append(...buildPlugins(state));
    else if (tab === "general") main.append(...buildGeneral(state));
    else main.append(...state.diagnostics.map((entry) => el("div", { class: "diagnostic", text: `${entry.source}: ${entry.message}` })));
    return main;
  };

  const buildGeneral = (state: RuntimeState): readonly HTMLElement[] => [
    el("div", { class: "row" }, [
      el("div", { class: "grow" }, [
        el("div", { class: "row-name", text: "Reapply after Antigravity updates" }),
        el("div", {
          class: "row-desc",
          text: "Antigravity replaces its own program files when it updates, which removes BetterGravity. Leave this on and it is put back automatically after the update finishes."
        })
      ]),
      toggleSwitch(state.settings.reapplyAfterHostUpdate, "Reapply after Antigravity updates", () => {
        void api.setSettings({ reapplyAfterHostUpdate: !state.settings.reapplyAfterHostUpdate });
      })
    ]),
    el("div", { class: "row" }, [
      el("div", { class: "grow" }, [
        el("div", { class: "row-name", text: "Where your files live" }),
        el("div", { class: "row-desc", text: state.directories.root }),
        el("div", {
          class: "row-meta",
          text: "Themes, plugins, and saved plugin data are kept here, outside Antigravity, so they survive updates and reinstalls."
        })
      ])
    ])
  ];

  const buildThemes = (state: RuntimeState): readonly HTMLElement[] => {
    if (state.themes.length === 0) {
      return [
        el("div", { class: "empty" }, [
          "No themes yet.",
          el("br"),
          "Drop a .css file into the themes folder and it appears here."
        ])
      ];
    }
    return state.themes.map((theme) => buildThemeRow(theme, state));
  };

  const buildThemeRow = (theme: ThemeRecord, state: RuntimeState): HTMLElement =>
    el("div", { class: "row" }, [
      el("div", { class: "grow" }, [
        el("div", { class: "row-name", text: theme.name }),
        el("div", { class: "row-meta", text: `${theme.version} · ${theme.author} · ${theme.id}` }),
        theme.description ? el("div", { class: "row-desc", text: theme.description }) : undefined
      ]),
      toggleSwitch(theme.enabled, `Enable ${theme.name}`, () => {
        void api.setSettings({ themes: { enabled: toggled(state.settings.themes.enabled, theme.id) } });
      })
    ]);

  const buildPlugins = (state: RuntimeState): readonly HTMLElement[] => {
    const developerMode = state.settings.plugins.developerMode;

    const gate = el("div", { class: "row" }, [
      el("div", { class: "grow" }, [
        el("div", { class: "row-name", text: "Developer mode" }),
        el("div", {
          class: "row-desc",
          text: "Plugins run real code inside Antigravity, with access to the same page your source and credentials appear in. Only turn this on for plugins you have read or trust."
        })
      ]),
      toggleSwitch(developerMode, "Enable developer mode", () => {
        void api.setSettings({ plugins: { developerMode: !developerMode } });
      })
    ]);

    if (!developerMode) return [gate];

    const summaries = api.plugins.list();
    if (summaries.length === 0) {
      return [
        gate,
        el("div", { class: "empty" }, [
          "No plugins found.",
          el("br"),
          "Each plugin is a folder with a plugin.json and an entry script."
        ])
      ];
    }

    return [gate, ...summaries.map((plugin) => buildPluginRow(plugin, state))];
  };

  const buildPluginRow = (plugin: PluginSummary, state: RuntimeState): HTMLElement => {
    const details = el("div", { class: "grow" }, [
      el("div", { class: "row-name", text: plugin.name }),
      el("div", { class: "row-meta", text: `${plugin.version} · ${plugin.author}` }),
      plugin.description ? el("div", { class: "row-desc", text: plugin.description }) : undefined
    ]);

    const fields = Object.entries(plugin.schema);
    if (plugin.running && fields.length > 0) {
      details.append(el("div", { class: "settings" }, fields.map(([key, setting]) => buildField(plugin.id, key, setting))));
    }

    return el("div", { class: "row" }, [
      details,
      toggleSwitch(plugin.enabled, `Enable ${plugin.name}`, () => {
        void api.setSettings({ plugins: { enabled: toggled(state.settings.plugins.enabled, plugin.id) } });
      })
    ]);
  };

  const buildField = (pluginId: string, key: string, setting: PluginSetting): HTMLElement => {
    const current = api.plugins.getSetting(pluginId, key);
    const label = el("div", { class: "grow" }, [
      el("div", { class: "field-label", text: setting.label }),
      setting.description ? el("div", { class: "field-hint", text: setting.description }) : undefined
    ]);

    const commit = (value: unknown) => api.plugins.setSetting(pluginId, key, value);

    if (setting.type === "boolean") {
      return el("div", { class: "field" }, [label, toggleSwitch(current === true, setting.label, () => {
        commit(current !== true);
        render();
      })]);
    }

    if (setting.type === "select") {
      const select = el("select", {});
      for (const option of setting.options) {
        select.append(el("option", { value: option.value, text: option.label, selected: option.value === current }));
      }
      select.addEventListener("change", () => commit(select.value));
      return el("div", { class: "field" }, [label, select]);
    }

    const input = el("input", {
      type: setting.type === "number" ? "number" : "text",
      value: String(current ?? ""),
      ...(setting.type === "number" && setting.min !== undefined ? { min: setting.min } : {}),
      ...(setting.type === "number" && setting.max !== undefined ? { max: setting.max } : {}),
      ...(setting.type === "string" && setting.placeholder ? { placeholder: setting.placeholder } : {})
    });
    input.addEventListener("change", () => commit(setting.type === "number" ? Number(input.value) : input.value));
    return el("div", { class: "field" }, [label, input]);
  };

  const buildFooter = (): HTMLElement => {
    const themesButton = el("button", { type: "button", text: "Open themes folder" });
    themesButton.addEventListener("click", () => void api.openDirectory("themes"));
    const pluginsButton = el("button", { type: "button", text: "Open plugins folder" });
    pluginsButton.addEventListener("click", () => void api.openDirectory("plugins"));
    return el("footer", {}, [
      themesButton,
      pluginsButton,
      el("div", { class: "grow" }),
      el("div", { class: "hint", text: "Ctrl+Shift+G" })
    ]);
  };

  function open_(): void {
    open = true;
    render();
  }

  function close(): void {
    open = false;
    render();
  }

  // Captured on the window so Antigravity's own handlers cannot swallow it.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
      return;
    }
    const matches = event.ctrlKey === SHORTCUT.ctrl && event.shiftKey === SHORTCUT.shift && event.key.toLowerCase() === SHORTCUT.key;
    if (!matches) return;
    event.preventDefault();
    event.stopPropagation();
    open ? close() : open_();
  };

  window.addEventListener("keydown", onKeyDown, true);
  const unsubscribe = api.onStateChanged(() => {
    if (open) render();
  });

  return {
    open: open_,
    close,
    toggle: () => (open ? close() : open_()),
    isOpen: () => open,
    destroy: () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe();
      host.remove();
    }
  };
}

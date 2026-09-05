import type { PluginSetting } from "@bettergravity/plugin-api";
import { remoteThemeStub } from "@bettergravity/theme-api";
import type { CatalogEntry, ContentKind, ContentResult, RuntimeState } from "../../protocol.js";
import type { BetterGravityApi, PluginSummary } from "../api.js";
import { el } from "../el.js";
import { openModal } from "../ui/modal.js";
import { installedVersion, isNewer, type CatalogStore } from "./catalog-store.js";
import {
  ICON,
  NATIVE,
  controlGroup,
  emptyState,
  expandedOptions,
  iconButton,
  nativeButton,
  nativeNote,
  nativeNumberInput,
  nativePalette,
  nativeSecretInput,
  nativeSelect,
  nativeSwitch,
  nativeTextInput,
  optionRow,
  screenShell,
  settingGroup,
  settingRow
} from "./native.js";

export interface SectionCallbacks {
  /** Re-renders the screen after something changes locally. */
  readonly refresh: () => void;
  /** Shows the outcome of an add or remove, which happens out of view. */
  readonly notify: (message: string) => void;
  readonly isExpanded: (pluginId: string) => boolean;
  readonly toggleExpanded: (pluginId: string) => void;
  /** The search text for the screen being drawn. */
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly catalog: CatalogStore;
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

const matches = (query: string, ...fields: readonly string[]): boolean => {
  if (query === "") return true;
  const haystack = fields.join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

const centred = (label: string): HTMLElement =>
  el("div", { class: "py-6 px-3 w-full flex justify-center text-center" }, [el("span", { class: NATIVE.emptyNote, text: label })]);

/** The search box that heads the Themes and Plugins screens. */
function searchField(callbacks: SectionCallbacks, label: string): HTMLInputElement {
  const input = el("input", {
    type: "search",
    class: NATIVE.input,
    placeholder: label,
    value: callbacks.query,
    "aria-label": label
  });
  input.addEventListener("input", () => callbacks.setQuery(input.value));
  return input;
}

// ---------------------------------------------------------------------------
// Listings from the catalog
// ---------------------------------------------------------------------------

/**
 * An update offered on the row of something already installed, rather than as a
 * separate listing further down. Where you look to manage a thing is where you
 * should be told a newer one exists.
 */
function updateAction(
  id: string,
  kind: ContentKind,
  version: string,
  callbacks: SectionCallbacks
): Node | undefined {
  const listing = callbacks.catalog.available(kind).find((entry) => entry.id === id);
  if (!listing || !isNewer(listing.version, version)) return undefined;
  if (callbacks.catalog.isInstalling(listing)) return el("span", { class: NATIVE.emptyNote, text: "Updating…" });
  return nativeButton(`Update to ${listing.version}`, () => callbacks.catalog.install(listing), `Installed: ${version}`);
}

function availableRow(entry: CatalogEntry, callbacks: SectionCallbacks): Node {
  const controls: Node[] = [];
  if (entry.source) {
    const source = entry.source;
    controls.push(iconButton(ICON.link, `Open the source for ${entry.name}`, () => window.open(source, "_blank", "noopener")));
  }
  controls.push(
    callbacks.catalog.isInstalling(entry)
      ? el("span", { class: NATIVE.emptyNote, text: "Installing…" })
      : nativeButton("Install", () => callbacks.catalog.install(entry))
  );

  return settingRow(
    entry.name,
    [entry.description, credit(entry.author, entry.version)].filter(Boolean).join("\n"),
    controlGroup(controls)
  );
}

/**
 * The second half of the Themes and Plugins screens: what the catalog offers
 * that is not already on disk. Installed listings are left out because the
 * group above is already showing them, with an update if there is one.
 */
function availableGroup(
  kind: ContentKind,
  state: RuntimeState | undefined,
  callbacks: SectionCallbacks,
  installedIds: ReadonlySet<string>
): Node {
  const { catalog } = callbacks;

  const actions = [
    nativeButton(catalog.status === "loading" ? "Refreshing…" : "Refresh", () => catalog.refresh())
  ];

  if (catalog.status === "error") {
    return settingGroup(
      "Available",
      [
        settingRow(
          "Could not load the catalog",
          catalog.message ?? "Something went wrong.",
          nativeButton("Try again", () => catalog.refresh())
        )
      ],
      actions
    );
  }

  if (catalog.status === "loading" || catalog.status === "idle") {
    return settingGroup("Available", [centred("Loading listings…")], actions);
  }

  const listings = catalog
    .available(kind)
    .filter((entry) => !installedIds.has(entry.id))
    .filter((entry) => matches(callbacks.query, entry.name, entry.description, entry.author));

  if (listings.length === 0) {
    const nothing = callbacks.query === "" ? `Nothing else to install yet.` : `Nothing available matches that search.`;
    return settingGroup("Available", [centred(nothing)], actions);
  }

  return settingGroup(
    "Available",
    listings.map((entry) => availableRow(entry, callbacks)),
    actions
  );
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/**
 * Adding a theme by URL, the way BetterDiscord users expect to. The URL is not
 * fetched here: a small local .css is written whose only rule imports it, so the
 * page loads it like any other stylesheet and the author can update it in place.
 */
function openAddFromUrl(api: BetterGravityApi, callbacks: SectionCallbacks): void {
  openModal(
    {
      title: "Add theme from URL",
      description: "Paste a link to a hosted .css file. A small local theme is created that loads it, so updates by its author show up without re-adding.",
      render: (body, close) => {
        const input = el("input", {
          type: "url",
          class: `${NATIVE.input} w-full`,
          placeholder: "https://example.github.io/theme.css",
          spellcheck: "false"
        });
        const problem = el("div", { class: NATIVE.emptyNote });

        const submit = () => {
          const stub = remoteThemeStub(input.value);
          if (!stub) {
            problem.textContent = "That is not an http(s) link.";
            return;
          }
          close();
          run(api.content.addThemeText(stub.fileName, stub.css), callbacks);
        };

        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        });

        body.append(
          el("div", { class: "flex flex-col gap-3" }, [
            input,
            problem,
            el("div", { class: "flex justify-end gap-2" }, [nativeButton("Cancel", close), nativeButton("Add theme", submit)])
          ])
        );
        queueMicrotask(() => input.focus());
      }
    },
    () => undefined
  );
}

function installedThemeRows(state: RuntimeState, api: BetterGravityApi, callbacks: SectionCallbacks): readonly Node[] {
  const themes = state.themes.filter((theme) => matches(callbacks.query, theme.name, theme.description, theme.author));

  if (state.themes.length === 0) {
    return [
      emptyState("No themes yet. A theme is a .css file, or a folder with a theme.css inside.", "Add a theme", () =>
        run(api.content.addThemes(), callbacks)
      )
    ];
  }
  if (themes.length === 0) return [centred("No installed themes match that search.")];

  return themes.map((theme) => {
    const update = updateAction(theme.id, "theme", theme.version, callbacks);
    return settingRow(
      theme.name,
      [theme.description, credit(theme.author, theme.version) + (theme.folder ? " · folder" : "")].filter(Boolean).join("\n"),
      controlGroup([
        update,
        iconButton(ICON.folder, `Show ${theme.id} in Explorer`, () => void api.content.reveal("theme", theme.id)),
        iconButton(ICON.trash, `Delete ${theme.name}`, () => run(api.content.remove("theme", theme.id, theme.name), callbacks)),
        nativeSwitch(theme.enabled, `Enable ${theme.name}`, () => {
          void api.setSettings({ themes: { enabled: toggled(state.settings.themes.enabled, theme.id) } });
        })
      ].filter((node): node is Node => node !== undefined))
    );
  });
}

export function buildThemesScreen(api: BetterGravityApi, callbacks: SectionCallbacks, notice?: string): HTMLElement {
  const state = api.state();
  if (!state) return screenShell("Themes", "Starting up.", []);

  callbacks.catalog.ensure();
  const installedIds = new Set(state.themes.map((theme) => theme.id));

  const shell = screenShell(
    "Themes",
    "A theme is a .css file, or a folder with a theme.css inside. Install one from the catalogue, or add your own.",
    [
      settingGroup("Installed", installedThemeRows(state, api, callbacks), [
        nativeButton("Add file", () => run(api.content.addThemes(), callbacks), "Add one or more .css files"),
        nativeButton("Add folder", () => run(api.content.addThemeFolder(), callbacks), "Add a folder containing theme.css"),
        nativeButton("Add from URL", () => openAddFromUrl(api, callbacks), "Add a theme hosted at a link"),
        nativeButton("Open folder", () => void api.openDirectory("themes"))
      ]),
      availableGroup("theme", state, callbacks, installedIds)
    ],
    notice,
    [searchField(callbacks, "Search themes")]
  );

  shell.append(
    el("div", { class: "px-6 pb-6 -mt-2" }, [
      el("span", { class: NATIVE.emptyNote, text: "Tip: you can also drag a .css file onto this page to add it as a theme." })
    ])
  );
  return shell;
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

/**
 * One row inside a plugin's expanded options. Most rows are a value the user
 * sets; an action row is a button the plugin answers, and a note row is the
 * plugin reporting something back.
 */
function optionControl(
  api: BetterGravityApi,
  pluginId: string,
  key: string,
  setting: PluginSetting,
  callbacks: SectionCallbacks
): Node {
  const onChanged = callbacks.refresh;

  if (setting.type === "note") {
    try {
      return nativeNote(setting.read());
    } catch (error) {
      return nativeNote(error instanceof Error ? error.message : "Unavailable.");
    }
  }

  if (setting.type === "action") {
    // The button is disabled while the plugin is working, so a slow action —
    // installing a certificate means PowerShell — cannot be started twice.
    const button = nativeButton(setting.action, () => {
      button.disabled = true;
      void Promise.resolve()
        .then(() => setting.onSelect())
        .then((message) => {
          if (typeof message === "string" && message !== "") callbacks.notify(message);
        })
        .catch((error: unknown) => callbacks.notify(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          button.disabled = false;
          onChanged();
        });
    });
    return button;
  }

  const current = api.plugins.getSetting(pluginId, key);
  const commit = (value: unknown) => {
    api.plugins.setSetting(pluginId, key, value);
    onChanged();
  };

  if (setting.type === "boolean") return nativeSwitch(current === true, setting.label, () => commit(current !== true));
  if (setting.type === "select") return nativeSelect(setting.options, current, commit);
  if (setting.type === "palette") {
    return nativePalette(setting.options, typeof current === "string" ? current : setting.default, commit);
  }
  if (setting.type === "number") {
    return nativeNumberInput(typeof current === "number" ? current : setting.default, setting.min, setting.max, commit);
  }

  const text = typeof current === "string" ? current : setting.default;
  return setting.secret === true
    ? nativeSecretInput(text, setting.placeholder, commit)
    : nativeTextInput(text, setting.placeholder, commit);
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
  const update = updateAction(plugin.id, "plugin", plugin.version, callbacks);
  if (update) controls.push(update);
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
        optionRow(setting.label, setting.description, optionControl(api, plugin.id, key, setting, callbacks))
      )
    )
  ];
}

function installedPluginRows(
  state: RuntimeState,
  api: BetterGravityApi,
  plugins: readonly PluginSummary[],
  callbacks: SectionCallbacks
): readonly Node[] {
  if (plugins.length === 0) {
    return [
      emptyState("No plugins yet. A plugin is a folder with a plugin.json and a script.", "Add a plugin", () =>
        run(api.content.addPlugin(), callbacks)
      )
    ];
  }

  const visible = plugins.filter((plugin) => matches(callbacks.query, plugin.name, plugin.description, plugin.author));
  if (visible.length === 0) return [centred("No installed plugins match that search.")];

  return visible.flatMap((plugin) => pluginEntry(plugin, state, api, callbacks));
}

export function buildPluginsScreen(api: BetterGravityApi, callbacks: SectionCallbacks, notice?: string): HTMLElement {
  const state = api.state();
  if (!state) return screenShell("Plugins", "Starting up.", []);

  callbacks.catalog.ensure();
  const plugins = api.plugins.list();
  const developerMode = state.settings.plugins.developerMode;

  const gate = settingGroup("Running plugins", [
    settingRow(
      "Developer mode",
      "Plugins run real code inside Antigravity, with access to the same page your source and credentials appear in. Only turn this on for plugins you have read or trust.",
      nativeSwitch(developerMode, "Enable developer mode", () => {
        void api.setSettings({ plugins: { developerMode: !developerMode } });
      })
    )
  ]);

  const groups: Node[] = [gate];

  if (developerMode) {
    groups.push(
      settingGroup("Installed", installedPluginRows(state, api, plugins, callbacks), [
        nativeButton("Add plugin", () => run(api.content.addPlugin(), callbacks)),
        nativeButton("Open folder", () => void api.openDirectory("plugins"))
      ])
    );
  }

  groups.push(availableGroup("plugin", state, callbacks, new Set(state.plugins.map((plugin) => plugin.id))));

  if (!developerMode) {
    groups.push(
      settingGroup("Before you install", [
        settingRow(
          "Nothing will run until developer mode is on",
          "A plugin can be installed either way, but it stays inert until the switch above is on.",
          undefined
        )
      ])
    );
  }

  return screenShell(
    "Plugins",
    "A plugin is a folder with a manifest and a script. Install one from the catalogue, or add your own.",
    groups,
    notice,
    [searchField(callbacks, "Search plugins")]
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function buildSettingsScreen(api: BetterGravityApi, callbacks: SectionCallbacks, notice?: string): HTMLElement {
  const state = api.state();
  if (!state) return screenShell("BetterGravity", "Starting up.", []);

  const groups: Node[] = [
    settingGroup("General", [
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
    ]),
    settingGroup("What you have", [
      settingRow(
        "Themes",
        `${state.themes.length} installed, ${state.themes.filter((theme) => theme.enabled).length} on.`,
        undefined
      ),
      settingRow(
        "Plugins",
        `${state.plugins.length} installed, ${api.plugins.list().filter((plugin) => plugin.running).length} running.`,
        undefined
      )
    ])
  ];

  if (state.diagnostics.length > 0) {
    groups.push(
      settingGroup(
        "Problems",
        state.diagnostics.map((diagnostic) => settingRow(diagnostic.source, diagnostic.message, undefined))
      )
    );
  }

  return screenShell("BetterGravity", `Version ${state.version} on Antigravity ${state.hostVersion}.`, groups, notice);
}

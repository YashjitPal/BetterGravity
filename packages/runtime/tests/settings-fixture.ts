import type { BetterGravityApi, PluginSummary } from "../src/world/api.js";
import type { ContentKind, ContentResult, RuntimeState, SettingsPatch } from "../src/protocol.js";

/**
 * A stand-in for Antigravity's settings dialog, matching the structure the
 * integration keys off: a nav list, a separate account footer that must not be
 * mistaken for it, and a container holding one div per screen toggled with
 * inline `display`.
 */
export function mountHostSettings(screens: readonly string[] = ["General", "Appearance"]): HTMLElement {
  const navButtons = screens
    .map(
      (name) =>
        `<button type="button" data-testid="settings-nav-item-${name}" class="flex items-center gap-1.5 group mx-2 px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none hover:bg-sidebar-muted"><span class="text-sm transition-colors select-none truncate flex-1 text-secondary-foreground group-hover:text-foreground">${name}</span></button>`
    )
    .join("");

  const screenDivs = screens
    .map((name, index) => `<div style="display: ${index === 0 ? "block" : "none"};"><h2>${name}</h2></div>`)
    .join("");

  const modal = document.createElement("div");
  modal.className = "settings-modal-container";
  modal.innerHTML = `
    <div class="relative flex w-full h-full outline-none">
      <div class="flex">
        <div class="h-full w-full flex flex-col bg-sidebar">
          <div class="flex-1 flex flex-col gap-1 py-3 overflow-y-auto">
            <div class="flex flex-col gap-0.5">${navButtons}</div>
          </div>
          <div class="flex flex-col border-t border-solid border-sidebar-border py-2">
            <button type="button" data-testid="settings-nav-item-Account"><span>Account</span></button>
          </div>
        </div>
      </div>
      <div style="position: relative; flex-grow: 1; min-width: 0px;">
        <div class="flex h-full overflow-auto">
          <div class="grow w-full">${screenDivs}</div>
        </div>
      </div>
    </div>`;

  document.body.append(modal);
  return modal;
}

export function unmountHostSettings(): void {
  document.querySelectorAll(".settings-modal-container").forEach((node) => node.remove());
}

export const theme = (id: string, enabled = false) => ({
  id,
  name: id.replace(".css", ""),
  description: "A theme.",
  author: "someone",
  version: "1.0.0",
  css: "body {}",
  enabled
});

export const pluginSummary = (overrides: Partial<PluginSummary> = {}): PluginSummary => ({
  id: "timer",
  name: "Session Timer",
  description: "Counts.",
  version: "1.0.0",
  author: "someone",
  enabled: true,
  running: true,
  schema: {},
  ...overrides
});

export function runtimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    version: "0.1.3",
    hostVersion: "2.11.0",
    directories: { root: "C:/bg", themes: "C:/bg/themes", plugins: "C:/bg/plugins" },
    settings: {
      schemaVersion: 1,
      themes: { enabled: [] },
      plugins: { developerMode: false, enabled: [] },
      reapplyAfterHostUpdate: true
    },
    themes: [],
    plugins: [],
    diagnostics: [],
    ...overrides
  };
}

export interface FakeApi {
  readonly api: BetterGravityApi;
  state: RuntimeState;
  summaries: PluginSummary[];
  readonly patches: SettingsPatch[];
  readonly opened: string[];
  readonly calls: string[];
  readonly settingValues: Record<string, unknown>;
  nextResult: ContentResult;
}

export function createFakeApi(): FakeApi {
  const fake: FakeApi = {
    state: runtimeState(),
    summaries: [],
    patches: [],
    opened: [],
    calls: [],
    settingValues: {},
    nextResult: { ok: true, message: "Done." },
    api: undefined as unknown as BetterGravityApi
  };

  const record = (name: string): Promise<ContentResult> => {
    fake.calls.push(name);
    return Promise.resolve(fake.nextResult);
  };

  (fake as { api: BetterGravityApi }).api = {
    version: "0.1.3",
    hostVersion: "2.11.0",
    state: () => fake.state,
    getState: () => Promise.resolve(fake.state),
    setSettings: (patch) => {
      fake.patches.push(patch);
      return Promise.resolve(fake.state);
    },
    openDirectory: (key) => {
      fake.opened.push(key);
      return Promise.resolve("");
    },
    onStateChanged: () => () => undefined,
    plugins: {
      list: () => fake.summaries,
      isRunning: (id) => fake.summaries.some((entry) => entry.id === id && entry.running),
      getSetting: (_pluginId, key) => fake.settingValues[key],
      setSetting: (_pluginId, key, value) => {
        fake.settingValues[key] = value;
      }
    },
    panel: { open: () => undefined, close: () => undefined, toggle: () => undefined },
    content: {
      addThemes: () => record("addThemes"),
      addPlugin: () => record("addPlugin"),
      addThemeText: (fileName) => record(`addThemeText:${fileName}`),
      remove: (kind: ContentKind, id: string) => record(`remove:${kind}:${id}`),
      reveal: (kind: ContentKind, id: string) => record(`reveal:${kind}:${id}`)
    }
  };

  return fake;
}

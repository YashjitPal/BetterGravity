import type { CatalogEntry, ContentResult, RuntimeState } from "../../protocol.js";
import type { BetterGravityApi } from "../api.js";
import { el } from "../el.js";
import { ICON, NATIVE, controlGroup, iconButton, nativeButton, screenShell, settingGroup, settingRow } from "./native.js";

/**
 * Browsing the community catalog from inside Antigravity.
 *
 * The catalog is fetched when this screen is first opened and not before, so an
 * installation nobody browses never reaches the network. Everything on screen
 * comes from that one request; there is no background polling and no telemetry
 * going the other way.
 */
export interface CommunityPanel {
  render(container: HTMLElement): void;
}

type Status = "idle" | "loading" | "ready" | "error";

/**
 * Compares dotted versions numerically where both sides are numbers, which
 * covers ordinary semver without pretending to implement it. Anything else
 * falls back to "different means newer", so an update is offered rather than
 * silently withheld.
 */
export function isNewer(candidate: string, installed: string): boolean {
  if (candidate === installed) return false;

  const left = candidate.split(".");
  const right = installed.split(".");
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = Number(left[index] ?? "0");
    const b = Number(right[index] ?? "0");
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    if (a !== b) return a > b;
  }
  return false;
}

function installedVersion(state: RuntimeState | undefined, entry: CatalogEntry): string | undefined {
  if (!state) return undefined;
  const found =
    entry.kind === "theme"
      ? state.themes.find((theme) => theme.id === entry.id)
      : state.plugins.find((plugin) => plugin.id === entry.id);
  return found?.version;
}

const matches = (entry: CatalogEntry, query: string): boolean => {
  if (query === "") return true;
  const haystack = `${entry.name} ${entry.description} ${entry.author}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

export function createCommunityPanel(api: BetterGravityApi): CommunityPanel {
  let status: Status = "idle";
  let entries: readonly CatalogEntry[] = [];
  let message: string | undefined;
  let query = "";
  /** Listings with an install in flight, so a second click cannot start one. */
  const busy = new Set<string>();
  let container: HTMLElement | undefined;

  /** An install lands on disk out of view, so it has to be reported here. */
  let notice: string | undefined;
  let noticeTimer: number | undefined;

  const draw = (): void => {
    if (container) render(container);
  };

  const notify = (text: string): void => {
    notice = text;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      notice = undefined;
      draw();
    }, 6000);
    draw();
  };

  const load = (force: boolean): void => {
    status = "loading";
    message = undefined;
    draw();

    void api.community.catalog(force).then((result) => {
      if (result.ok) {
        entries = result.entries ?? [];
        status = "ready";
      } else {
        status = "error";
        message = result.message;
      }
      draw();
    });
  };

  const install = (entry: CatalogEntry): void => {
    const key = `${entry.kind}:${entry.id}`;
    if (busy.has(key)) return;
    busy.add(key);
    draw();

    void api.community
      .install(entry)
      .catch((error: unknown): ContentResult => ({ ok: false, message: String(error) }))
      .then((result) => {
        busy.delete(key);
        if (result.message) notify(result.message);
        else draw();
      });
  };

  const actionFor = (entry: CatalogEntry, state: RuntimeState | undefined): Node => {
    const key = `${entry.kind}:${entry.id}`;
    if (busy.has(key)) return el("span", { class: NATIVE.emptyNote, text: "Installing…" });

    const current = installedVersion(state, entry);
    if (current === undefined) return nativeButton("Install", () => install(entry));
    if (isNewer(entry.version, current)) {
      return nativeButton(`Update to ${entry.version}`, () => install(entry), `Installed: ${current}`);
    }
    return el("span", { class: NATIVE.emptyNote, text: "Installed" });
  };

  const rowFor = (entry: CatalogEntry, state: RuntimeState | undefined): Node => {
    const controls: Node[] = [];
    if (entry.source) {
      controls.push(
        iconButton(ICON.folder, `Open the source for ${entry.name}`, () => window.open(entry.source, "_blank", "noopener"))
      );
    }
    controls.push(actionFor(entry, state));

    return settingRow(
      entry.name,
      [entry.description, `${entry.author} · ${entry.version}`].filter(Boolean).join("\n"),
      controlGroup(controls)
    );
  };

  const render = (target: HTMLElement): void => {
    container = target;
    const state = api.state();

    if (status === "idle") {
      // First look at this screen; nothing has been fetched yet.
      target.replaceChildren(screenShell("Community", "Loading listings…", []));
      load(false);
      return;
    }

    const search = el("input", {
      type: "search",
      class: NATIVE.input,
      placeholder: "Search listings",
      value: query,
      "aria-label": "Search community listings"
    });
    search.addEventListener("input", () => {
      query = search.value;
      draw();
      // Redrawing replaces the field, so the caret has to be put back.
      const replacement = target.querySelector<HTMLInputElement>('input[type="search"]');
      replacement?.focus();
      replacement?.setSelectionRange(replacement.value.length, replacement.value.length);
    });

    const refresh = nativeButton(status === "loading" ? "Refreshing…" : "Refresh", () => load(true));
    if (status === "loading") refresh.setAttribute("disabled", "true");

    const groups: Node[] = [];

    const note = (heading: string, body: Node): Node => settingGroup(heading, [body]);
    const centred = (label: string): Node =>
      el("div", { class: "py-6 px-3 w-full flex justify-center" }, [el("span", { class: NATIVE.emptyNote, text: label })]);

    if (status === "error") {
      groups.push(
        settingGroup("Community", [
          settingRow("Could not load the catalog", message ?? "Something went wrong.", nativeButton("Try again", () => load(true)))
        ])
      );
    } else if (status === "loading" && entries.length === 0) {
      // Empty Themes and Plugins groups would read as "there is nothing here"
      // rather than "this has not arrived yet".
      groups.push(note("Community", centred("Loading listings…")));
    } else {
      const visible = entries.filter((entry) => matches(entry, query));
      const themes = visible.filter((entry) => entry.kind === "theme");
      const plugins = visible.filter((entry) => entry.kind === "plugin");

      const group = (heading: string, listed: readonly CatalogEntry[], emptyNote: string): Node =>
        settingGroup(heading, listed.length > 0 ? listed.map((entry) => rowFor(entry, state)) : [centred(emptyNote)]);

      groups.push(
        group("Themes", themes, query === "" ? "No themes listed yet." : "No themes match that search."),
        group("Plugins", plugins, query === "" ? "No plugins listed yet." : "No plugins match that search.")
      );

      if (plugins.length > 0 && state && !state.settings.plugins.developerMode) {
        groups.push(
          settingGroup("Before you install a plugin", [
            settingRow(
              "Developer mode is off",
              "A plugin can be installed either way, but it will not run until developer mode is on under Plugins. Plugins run real code in the same page as your source and credentials.",
              undefined
            )
          ])
        );
      }
    }

    target.replaceChildren(
      screenShell(
        "Community",
        "Themes and plugins submitted to the BetterGravity repository and reviewed there.",
        groups,
        notice,
        [search, refresh]
      )
    );
  };

  return { render };
}

import type { CatalogEntry, ContentKind, ContentResult, RuntimeState } from "../../protocol.js";
import type { BetterGravityApi } from "../api.js";

/**
 * The community catalog, shared by the Themes and Plugins screens.
 *
 * Both screens list what you have and what you could have, so they need the
 * same listings. One store means one request between them rather than one each,
 * and means switching between the two screens does not refetch.
 *
 * Nothing is fetched until a screen asks, so an installation whose owner never
 * opens Themes or Plugins makes no network request at all.
 */
export type CatalogStatus = "idle" | "loading" | "ready" | "error";

export interface CatalogStore {
  readonly status: CatalogStatus;
  /** Listings of one kind, or an empty list until they have arrived. */
  available(kind: ContentKind): readonly CatalogEntry[];
  readonly message: string | undefined;
  /** Fetches on the first call and does nothing afterwards. */
  ensure(): void;
  refresh(): void;
  isInstalling(entry: CatalogEntry): boolean;
  install(entry: CatalogEntry): void;
}

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

export function installedVersion(state: RuntimeState | undefined, entry: CatalogEntry): string | undefined {
  if (!state) return undefined;
  const found =
    entry.kind === "theme"
      ? state.themes.find((theme) => theme.id === entry.id)
      : state.plugins.find((plugin) => plugin.id === entry.id);
  return found?.version;
}

export interface CatalogStoreCallbacks {
  /** Re-renders whichever screen is showing. */
  readonly changed: () => void;
  /** Reports an install, which lands on disk out of view. */
  readonly notify: (message: string) => void;
}

export function createCatalogStore(api: BetterGravityApi, callbacks: CatalogStoreCallbacks): CatalogStore {
  let status: CatalogStatus = "idle";
  let entries: readonly CatalogEntry[] = [];
  let message: string | undefined;
  const installing = new Set<string>();

  const key = (entry: CatalogEntry) => `${entry.kind}:${entry.id}`;

  const load = (force: boolean): void => {
    status = "loading";
    message = undefined;
    callbacks.changed();

    void api.community.catalog(force).then((result) => {
      if (result.ok) {
        entries = result.entries ?? [];
        status = "ready";
      } else {
        status = "error";
        message = result.message;
      }
      callbacks.changed();
    });
  };

  return {
    get status() {
      return status;
    },
    get message() {
      return message;
    },
    available: (kind) => entries.filter((entry) => entry.kind === kind),
    ensure: () => {
      if (status === "idle") load(false);
    },
    refresh: () => load(true),
    isInstalling: (entry) => installing.has(key(entry)),
    install: (entry) => {
      if (installing.has(key(entry))) return;
      installing.add(key(entry));
      callbacks.changed();

      void api.community
        .install(entry)
        .catch((error: unknown): ContentResult => ({ ok: false, message: String(error) }))
        .then((result) => {
          installing.delete(key(entry));
          if (result.message) callbacks.notify(result.message);
          else callbacks.changed();
        });
    }
  };
}

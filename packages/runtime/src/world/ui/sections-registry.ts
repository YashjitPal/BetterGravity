/**
 * Plugin-contributed entries in Antigravity's settings sidebar.
 *
 * The settings host owns the sidebar and the screen container: it is the one
 * place that knows how to hide the host's screens and put them back. Plugins
 * therefore register their sections here and the host renders them, rather than
 * each plugin injecting into the dialog and fighting the others over which
 * screen is visible.
 */
export interface RegisteredSection {
  /** Unique across plugins; also the suffix of the nav entry's test id. */
  readonly id: string;
  readonly pluginId: string;
  readonly label: string;
  render(container: HTMLElement): void;
}

const sections = new Map<string, RegisteredSection>();
const listeners = new Set<() => void>();
const refreshListeners = new Set<(id: string) => void>();

function announce(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A stale listener must not stop the others from being told.
    }
  }
}

export function registerSection(section: RegisteredSection): () => void {
  sections.set(section.id, section);
  announce();
  return () => {
    if (sections.delete(section.id)) announce();
  };
}

export function listSections(): readonly RegisteredSection[] {
  return [...sections.values()];
}

export function onSectionsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Asks the host to re-render a section, if it happens to be the one showing. */
export function requestSectionRefresh(id: string): void {
  for (const listener of [...refreshListeners]) {
    try {
      listener(id);
    } catch {
      // As above: one bad listener must not silence the rest.
    }
  }
}

export function onSectionRefresh(listener: (id: string) => void): () => void {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

/** Test seam: the registry is process-wide otherwise. */
export function resetSections(): void {
  sections.clear();
  listeners.clear();
  refreshListeners.clear();
}

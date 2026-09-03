import { el } from "../el.js";

/**
 * Antigravity's settings interface is built with Tailwind utility classes over a
 * set of CSS custom properties. Rather than approximate it, BetterGravity reuses
 * the exact class strings its own screens use, so the section inherits the app's
 * theme, spacing, and hover behaviour for free — including when the user changes
 * the Antigravity theme.
 *
 * These strings are copied from the rendered DOM of Antigravity 2.11. They are
 * the one part of BetterGravity genuinely coupled to the host's markup, so they
 * are kept together here rather than spread through the UI code.
 */
export const NATIVE = {
  navItem: "flex items-center gap-1.5 group mx-2 px-2 py-1 rounded-lg cursor-pointer border-none text-left transition-all outline-none",
  navItemActive: "bg-sidebar-secondary",
  navItemIdle: "hover:bg-sidebar-muted",
  navLabel: "text-sm transition-colors select-none truncate flex-1",
  navLabelActive: "text-foreground",
  navLabelIdle: "text-secondary-foreground group-hover:text-foreground",

  screen: "w-full bg-transparent h-full overflow-y-auto",
  page: "p-6 flex flex-col gap-4 w-full max-w-2xl mx-auto",
  headerBlock: "flex flex-col gap-2 w-full mb-2 bg-transparent",
  headerRow: "flex justify-between items-start gap-4 w-full bg-transparent pr-8 lg:pr-0",
  headerText: "flex-1 flex flex-col gap-1 min-w-0 bg-transparent",
  title: "m-0 text-xl font-semibold truncate flex-1 text-foreground",
  subtitle: "text-sm text-muted-foreground bg-transparent",

  groups: "flex flex-col gap-8 w-full",
  group: "space-y-2",
  groupHeading: "m-0 text-sm font-medium",
  card: "bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border",

  row: "py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center",
  rowText: "flex-1 flex flex-col gap-0.5",
  rowTitleLine: "flex items-center gap-1.5",
  rowTitle: "text-sm",
  rowDescription: "text-xs text-muted-foreground whitespace-pre-wrap",
  rowControl: "shrink-0",

  switchBase: "relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out shrink-0 h-6 w-11 cursor-pointer",
  switchOn: "bg-primary",
  switchOff: "bg-secondary",
  switchThumb: "inline-block rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm h-4 w-4",

  buttonSecondary:
    "inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer justify-center disabled:opacity-50 bg-secondary text-secondary-foreground hover:text-foreground border-none h-7 text-sm rounded-md gap-1.5 px-2.5",

  selectShell:
    "appearance-none px-2 py-1 pr-7 text-sm bg-secondary text-secondary-foreground hover:text-foreground rounded-md shadow-sm border-none cursor-pointer min-w-[140px]",

  input:
    "px-2 py-1 text-sm bg-secondary text-secondary-foreground rounded-md shadow-sm border-none outline-none min-w-[140px]",

  emptyNote: "text-xs text-muted-foreground whitespace-pre-wrap"
} as const;

export const NAV_ATTRIBUTE = "data-bettergravity-nav";

export function navButton(id: string, label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const button = el(
    "button",
    {
      type: "button",
      // Matches the host's own naming so the entry is indistinguishable, while
      // the BetterGravity attribute is what the host code keys off.
      "data-testid": `settings-nav-item-${label}`,
      [NAV_ATTRIBUTE]: id,
      class: `${NATIVE.navItem} ${active ? NATIVE.navItemActive : NATIVE.navItemIdle}`
    },
    [el("span", { class: `${NATIVE.navLabel} ${active ? NATIVE.navLabelActive : NATIVE.navLabelIdle}`, text: label })]
  );
  button.addEventListener("click", onClick);
  return button;
}

export function nativeSwitch(checked: boolean, label: string, onChange: () => void): HTMLButtonElement {
  const thumb = el("span", { class: NATIVE.switchThumb });
  thumb.style.transform = `translateX(${checked ? 24 : 4}px)`;

  const button = el(
    "button",
    {
      type: "button",
      role: "switch",
      "aria-checked": checked,
      "aria-label": label,
      class: `${NATIVE.switchBase} ${checked ? NATIVE.switchOn : NATIVE.switchOff}`
    },
    [thumb]
  );
  button.addEventListener("click", onChange);
  return button;
}

export function nativeButton(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const button = el("button", { type: "button", class: NATIVE.buttonSecondary, text: label, title });
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Antigravity draws its icons from Material Symbols on a `0 -960 960 960`
 * viewBox, so BetterGravity uses the same set and the same box.
 */
export const ICON = {
  gear: "M370-80l-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z",
  folder: "M180-180h600v-360H460l-80-80H180v440Zm0 60q-24 0-42-18t-18-42v-540q0-24 18-42t42-18h224l80 80h316q24 0 42 18t18 42v460q0 24-18 42t-42 18H180Z",
  trash: "M292-120q-29 0-49.5-20.5T222-190v-547h-49v-60h176v-38h262v38h176v60h-49v547q0 29-20.5 49.5T668-120H292Zm376-617H292v547h376v-547ZM378-267h60v-397h-60v397Zm144 0h60v-397h-60v397ZM292-737v547-547Z"
} as const;

function icon(pathData: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor" class="w-4 h-4"><path d="${pathData}"></path></svg>`;
}

/**
 * A quiet, square action that sits beside a row's main control. Kept icon-only
 * so a list of plugins stays scannable rather than becoming a wall of words.
 */
export function iconButton(pathData: string, label: string, onClick: () => void, pressed?: boolean): HTMLButtonElement {
  const button = el("button", {
    type: "button",
    "aria-label": label,
    title: label,
    ...(pressed === undefined ? {} : { "aria-pressed": pressed }),
    class: `inline-flex items-center justify-center h-7 w-7 rounded-md border-none cursor-pointer transition-colors bg-transparent ${
      pressed ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
    }`,
    html: icon(pathData)
  });
  button.addEventListener("click", onClick);
  return button;
}

/** A full-width call to action, used where a list would otherwise be empty. */
export function emptyState(message: string, actionLabel: string, onAction: () => void): HTMLElement {
  return el("div", { class: "py-6 px-3 w-full bg-transparent flex flex-col items-center gap-2 text-center" }, [
    el("span", { class: NATIVE.emptyNote, text: message }),
    nativeButton(actionLabel, onAction)
  ]);
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Antigravity's dropdown is a Base UI combobox with its own popup. Reproducing
 * that would mean copying interaction behaviour as well as markup, so this uses
 * a native select styled to match the closed state exactly. The open state is
 * the platform's, which is honest about what it is.
 */
export function nativeSelect(options: readonly SelectOption[], selected: unknown, onChange: (value: string) => void): HTMLElement {
  const select = el("select", { class: NATIVE.selectShell });
  for (const option of options) {
    select.append(el("option", { value: option.value, text: option.label, selected: option.value === selected }));
  }
  select.addEventListener("change", () => onChange(select.value));

  const chevron = el("span", {
    class: "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-70",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor" class="w-3 h-3"><path d="M480-357.85L253.85-584L296-626.15l184,184l184-184L706.15-584L480-357.85Z"></path></svg>'
  });

  return el("span", { class: "relative inline-flex items-center" }, [select, chevron]);
}

export function nativeNumberInput(value: number, min: number | undefined, max: number | undefined, onChange: (value: number) => void): HTMLInputElement {
  const input = el("input", {
    type: "number",
    class: NATIVE.input,
    value: String(value),
    min: min === undefined ? undefined : String(min),
    max: max === undefined ? undefined : String(max)
  });
  input.addEventListener("change", () => onChange(Number(input.value)));
  return input;
}

export function nativeTextInput(value: string, placeholder: string | undefined, onChange: (value: string) => void): HTMLInputElement {
  const input = el("input", { type: "text", class: NATIVE.input, value, placeholder });
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

/**
 * A plugin's own options, revealed under its row. Indented and tinted so it
 * reads as belonging to the plugin above it rather than as a sibling setting.
 */
export function expandedOptions(rows: readonly Node[]): HTMLElement {
  return el("div", { class: "bg-secondary/20 divide-y divide-border" }, rows);
}

export function optionRow(title: string, description: string | undefined, control: Node): HTMLElement {
  return el("div", { class: `${NATIVE.row} pl-6` }, [
    el("div", { class: NATIVE.rowText }, [
      el("div", { class: NATIVE.rowTitleLine }, [el("span", { class: NATIVE.rowTitle, text: title })]),
      description ? el("span", { class: NATIVE.rowDescription, text: description }) : undefined
    ]),
    el("div", { class: NATIVE.rowControl }, [control])
  ]);
}

export function settingRow(title: string, description: string | undefined, control: Node | undefined): HTMLElement {
  return el("div", { class: NATIVE.row }, [
    el("div", { class: NATIVE.rowText }, [
      el("div", { class: NATIVE.rowTitleLine }, [el("span", { class: NATIVE.rowTitle, text: title })]),
      description ? el("span", { class: NATIVE.rowDescription, text: description }) : undefined
    ]),
    control ? el("div", { class: NATIVE.rowControl }, [control]) : undefined
  ]);
}

/**
 * Antigravity's own group headers use `justify-between`, leaving a slot on the
 * right that its screens do not currently fill. Actions go there, which is where
 * a user looks for "add one of these".
 */
export function settingGroup(heading: string, rows: readonly Node[], actions: readonly Node[] = []): HTMLElement {
  return el("div", { class: NATIVE.group }, [
    el("div", { class: "flex flex-col gap-1" }, [
      el("div", { class: "flex items-center justify-between" }, [
        el("div", { class: "flex items-center gap-1.5" }, [el("h3", { class: NATIVE.groupHeading, text: heading })]),
        actions.length > 0 ? el("div", { class: "flex items-center gap-1.5" }, actions) : undefined
      ])
    ]),
    el("div", {}, [el("div", { class: NATIVE.card }, rows)])
  ]);
}

/** Several controls in one row's control slot, such as a switch and a menu. */
export function controlGroup(controls: readonly Node[]): HTMLElement {
  return el("div", { class: "flex items-center gap-2" }, controls);
}

/** Confirms an action whose effect happened on disk, out of the user's view. */
export function noticeBanner(message: string): HTMLElement {
  return el("div", { class: "rounded-lg border border-border bg-secondary px-3 py-2" }, [
    el("span", { class: "text-xs text-foreground", text: message })
  ]);
}

export function screenShell(title: string, subtitle: string, groups: readonly Node[], notice?: string): HTMLElement {
  return el("div", { class: NATIVE.screen }, [
    el("div", { class: NATIVE.page }, [
      el("div", { class: NATIVE.headerBlock }, [
        el("div", { class: NATIVE.headerRow }, [
          el("div", { class: NATIVE.headerText }, [
            el("h2", { class: NATIVE.title, text: title }),
            el("div", { class: NATIVE.subtitle, text: subtitle })
          ])
        ])
      ]),
      notice ? noticeBanner(notice) : undefined,
      el("div", { class: NATIVE.groups }, groups)
    ])
  ]);
}

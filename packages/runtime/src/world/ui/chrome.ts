import type { HostClasses, IconName, IconPath } from "@bettergravity/plugin-api";

/**
 * Antigravity's own class strings, read out of its rendered DOM.
 *
 * Everything BetterGravity adds to the interface is built from these rather
 * than from approximations, so plugin UI inherits the app's theme, spacing, and
 * hover behaviour — and keeps inheriting them when the user changes theme.
 *
 * This and `settings/native.ts` are the only parts of the runtime genuinely
 * coupled to the host's markup, which is why they are kept in one place each.
 * Captured from Antigravity 2.11.
 */
export const CHROME = {
  /** The popup that holds `role="menuitem"` children. */
  menu: "bg-card text-foreground rounded-lg border border-border shadow-md outline-none no-focus-ring min-w-[180px] p-1 flex flex-col gap-px scrollbar-none",
  menuItem:
    "w-full px-2 py-1 text-left text-[13px] cursor-pointer outline-none no-focus-ring transition-colors select-none flex items-center gap-1.5 rounded-md text-secondary-foreground hover:bg-secondary hover:text-foreground focus:bg-secondary focus:text-foreground",
  menuItemDanger: "w-full px-2 py-1 text-left text-[13px] cursor-pointer outline-none no-focus-ring transition-colors select-none flex items-center gap-1.5 rounded-md text-destructive hover:bg-destructive/10 focus:bg-destructive/10",
  menuItemDisabled: "cursor-not-allowed opacity-50 pointer-events-none",
  separator: "my-1 h-px bg-border border-none",

  /** The viewport Antigravity anchors its own toasts in. */
  toastViewport: "z-[7000] toast-viewport fixed bottom-3 right-3 left-3 sm:left-auto sm:w-full sm:max-w-sm pointer-events-none",
  toast: "pointer-events-auto mt-2 flex gap-2.5 items-start bg-card text-foreground rounded-lg border border-border shadow-md p-3",
  toastTitle: "text-sm font-medium text-foreground",
  toastBody: "text-xs text-muted-foreground whitespace-pre-wrap",

  button:
    "inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer justify-center disabled:opacity-50 bg-secondary text-secondary-foreground hover:text-foreground border-none h-7 text-sm rounded-md gap-1.5 px-2.5",
  buttonQuiet:
    "inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer justify-center disabled:opacity-50 bg-transparent text-muted-foreground hover:text-foreground hover:bg-secondary h-6 w-6 shrink-0 rounded-md",
  /** The full-width shape the sidebar's own actions use. */
  buttonSidebar:
    "inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer disabled:opacity-50 w-full justify-start font-normal h-8 min-w-0 gap-1.5 px-2 py-1 rounded-lg border border-border text-foreground bg-sidebar-secondary hover:bg-sidebar-muted",

  overlay: "fixed inset-0 z-[8000] flex items-center justify-center bg-black/50",
  panel: "bg-card text-foreground rounded-xl border border-border shadow-lg flex flex-col max-h-[80vh] w-full mx-4",
  panelHeader: "flex items-start justify-between gap-4 px-4 pt-4 pb-2",
  panelBody: "px-4 pb-4 overflow-y-auto",

  card: "bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border",
  input: "px-2 py-1 text-sm bg-secondary text-secondary-foreground rounded-md shadow-sm border-none outline-none min-w-[140px]",
  title: "m-0 text-xl font-semibold truncate flex-1 text-foreground",
  subtitle: "text-sm text-muted-foreground bg-transparent",
  row: "py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center",
  group: "space-y-2",
  groupHeading: "m-0 text-sm font-medium",

  accent: {
    info: "text-muted-foreground",
    success: "text-primary",
    warning: "text-yellow-500",
    error: "text-destructive"
  }
} as const;

/** Where a toolbar button can go, and how it should be shaped once there. */
export const TOOLBAR = {
  titleBar: { anchor: "[data-testid='title-menu-bar']", within: undefined, shape: CHROME.buttonQuiet },
  sidebar: { anchor: "[data-testid='new-conversation-button']", within: "parent", shape: CHROME.buttonSidebar }
} as const;

export const ICONS: Readonly<Record<IconName, IconPath>> = {
  gear: "M370-80l-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z",
  folder: "M180-180h600v-360H460l-80-80H180v440Zm0 60q-24 0-42-18t-18-42v-540q0-24 18-42t42-18h224l80 80h316q24 0 42 18t18 42v460q0 24-18 42t-42 18H180Z",
  trash:
    "M292-120q-29 0-49.5-20.5T222-190v-547h-49v-60h176v-38h262v38h176v60h-49v547q0 29-20.5 49.5T668-120H292Zm376-617H292v547h376v-547ZM378-267h60v-397h-60v397Zm144 0h60v-397h-60v397ZM292-737v547-547Z",
  copy: "M368-274q-29 0-49.5-20.5T298-344v-514q0-29 20.5-49.5T368-928h382q29 0 49.5 20.5T820-858v514q0 29-20.5 49.5T750-274H368Zm0-70h382v-514H368v514ZM210-116q-29 0-49.5-20.5T140-186v-584h70v584h456v70H210Zm158-228v-514 514Z",
  star: "M354-247l126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-80l65-281L80-553l288-25 112-265 112 265 288 25-218 192 65 281-247-149L233-80Zm247-350Z",
  download: "M480-336L288-528l43-43 119 119v-388h60v388l119-119 43 43L480-336ZM252-192q-25 0-42.5-17.5T192-252v-124h60v124h456v-124h60v124q0 25-17.5 42.5T708-192H252Z",
  refresh:
    "M482-160q-134 0-228-93t-94-227v-13l-74 74-42-42 148-148 146 146-42 42-72-72v13q0 109 76.5 185.5T482-218q28 0 55-6.5t52-19.5l44 44q-35 22-74.5 31t-76.5 9Zm242-121L578-427l42-42 72 72v-13q0-109-76.5-185.5T430-672q-28 0-55 6.5T323-646l-44-44q35-22 74.5-31t76.5-9q134 0 228 93t94 227v13l74-74 42 42-148 148Z",
  plus: "M450-450H240v-60h210v-210h60v210h210v60H510v210h-60v-210Z",
  check: "M382-240L154-468l57-57 171 171 367-367 57 57-424 424Z",
  close: "M256-213l-43-43 224-224-224-224 43-43 224 224 224-224 43 43-224 224 224 224-43 43-224-224-224 224Z",
  info: "M450-290h60v-230h-60v230Zm30-298q13 0 21.5-8.5T510-618q0-13-8.5-21.5T480-648q-13 0-21.5 8.5T450-618q0 13 8.5 21.5T480-588Zm0 508q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z",
  warning: "M80-120l400-720 400 720H80Zm106-60h588L480-708 186-180Zm294-45q13 0 21.5-8.5T510-255q0-13-8.5-21.5T480-285q-13 0-21.5 8.5T450-255q0 13 8.5 21.5T480-225Zm-30-118h60v-224h-60v224Z",
  error: "M480-290q13 0 21.5-8.5T510-320q0-13-8.5-21.5T480-350q-13 0-21.5 8.5T450-320q0 13 8.5 21.5T480-290Zm-30-138h60v-244h-60v244ZM330-80L80-330v-300l250-250h300l250 250v300L630-80H330Zm26-60h248l176-176v-248L604-820H356L180-644v248l176 176Z"
};

export function renderIcon(path: IconPath, size = 16): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.style.flexShrink = "0";

  const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
  node.setAttribute("d", path);
  svg.append(node);
  return svg;
}

/** The subset handed to plugins, kept narrow so the rest stays free to change. */
export const HOST_CLASSES: HostClasses = {
  button: CHROME.button,
  buttonQuiet: CHROME.buttonQuiet,
  card: CHROME.card,
  input: CHROME.input,
  menu: CHROME.menu,
  menuItem: CHROME.menuItem,
  separator: CHROME.separator,
  title: CHROME.title,
  subtitle: CHROME.subtitle,
  row: CHROME.row,
  group: CHROME.group,
  groupHeading: CHROME.groupHeading
};

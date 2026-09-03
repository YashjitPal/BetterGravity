import type { ToastHandle, ToastOptions } from "@bettergravity/plugin-api";
import { el } from "../el.js";
import { CHROME, ICONS, renderIcon } from "./chrome.js";

const OUR_VIEWPORT = "data-bettergravity-toasts";

const KIND_ICON = {
  info: ICONS.info,
  success: ICONS.check,
  warning: ICONS.warning,
  error: ICONS.error
} as const;

/**
 * Antigravity renders its own toasts into a fixed viewport. Reusing it means
 * BetterGravity's messages stack with the host's instead of overlapping them,
 * and inherit its position on narrow windows.
 *
 * Plugins start before the document is parsed, though, so a plugin that greets
 * the user on startup has no host viewport to render into yet. One of our own
 * stands in until the app has mounted, and is taken away once it empties so the
 * two do not sit on top of each other.
 */
function viewport(): HTMLElement {
  const host = document.querySelector<HTMLElement>(`.toast-viewport:not([${OUR_VIEWPORT}])`);
  if (host) return host;

  const existing = document.querySelector<HTMLElement>(`[${OUR_VIEWPORT}]`);
  if (existing?.isConnected) return existing;

  const created = el("div", { class: CHROME.toastViewport, [OUR_VIEWPORT]: "" });
  (document.body ?? document.documentElement).append(created);
  return created;
}

function tidyStandIn(): void {
  const created = document.querySelector<HTMLElement>(`[${OUR_VIEWPORT}]`);
  if (created && created.childElementCount === 0) created.remove();
}

export function showToast(options: ToastOptions, track: (cleanup: () => void) => void): ToastHandle {
  const kind = options.kind ?? "info";
  const duration = options.duration ?? 5000;

  let timer: number | undefined;
  let element: HTMLElement | undefined;

  const dismiss = (): void => {
    window.clearTimeout(timer);
    if (!element) return;
    const node = element;
    element = undefined;
    node.style.opacity = "0";
    node.style.transform = "translateY(4px)";
    window.setTimeout(() => {
      node.remove();
      tidyStandIn();
    }, 150);
  };

  const actions = (options.actions ?? []).map((action) => {
    const button = el("button", { type: "button", class: CHROME.button, text: action.label });
    button.addEventListener("click", () => {
      try {
        action.onSelect();
      } finally {
        dismiss();
      }
    });
    return button;
  });

  const close = el("button", { type: "button", class: CHROME.buttonQuiet, "aria-label": "Dismiss" });
  close.append(renderIcon(ICONS.close, 14));
  close.addEventListener("click", dismiss);

  const glyph = el("span", { class: `${CHROME.accent[kind]} mt-px` });
  glyph.append(renderIcon(KIND_ICON[kind], 16));

  element = el("div", { class: CHROME.toast, role: "status", "aria-live": "polite" }, [
    glyph,
    el("div", { class: "flex-1 flex flex-col gap-1 min-w-0" }, [
      el("div", { class: CHROME.toastTitle, text: options.title }),
      options.body ? el("div", { class: CHROME.toastBody, text: options.body }) : undefined,
      actions.length > 0 ? el("div", { class: "flex items-center gap-1.5 mt-1" }, actions) : undefined
    ]),
    close
  ]);
  element.style.transition = "opacity 150ms, transform 150ms";

  viewport().append(element);

  if (duration > 0) timer = window.setTimeout(dismiss, duration);
  track(dismiss);

  return { dismiss };
}

import type { ModalHandle, ModalOptions } from "@bettergravity/plugin-api";
import { el } from "../el.js";
import { CHROME, ICONS, renderIcon } from "./chrome.js";

/**
 * A dialog over the whole application, in the host's panel styling.
 *
 * Antigravity's own dialogs are Base UI components wired into its state, so
 * rather than borrow one and fight it, this is a plain overlay that borrows only
 * the appearance. It handles the two things a dialog must: Escape closes it, and
 * so does clicking outside it.
 */
export function openModal(options: ModalOptions, track: (cleanup: () => void) => void): ModalHandle {
  let overlay: HTMLElement | undefined;

  const close = (): void => {
    if (!overlay) return;
    overlay.remove();
    overlay = undefined;
    document.removeEventListener("keydown", onKeyDown, true);
    options.onClose?.();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  }

  const dismiss = el("button", { type: "button", class: CHROME.buttonQuiet, "aria-label": "Close" });
  dismiss.append(renderIcon(ICONS.close, 16));
  dismiss.addEventListener("click", close);

  const body = el("div", { class: CHROME.panelBody });
  const panel = el("div", { class: CHROME.panel, role: "dialog", "aria-modal": "true", "aria-label": options.title }, [
    el("div", { class: CHROME.panelHeader }, [
      el("div", { class: "flex flex-col gap-1 min-w-0" }, [
        el("h2", { class: "m-0 text-base font-semibold text-foreground", text: options.title }),
        options.description ? el("div", { class: CHROME.subtitle, text: options.description }) : undefined
      ]),
      dismiss
    ]),
    body
  ]);
  panel.style.maxWidth = `${options.width ?? 520}px`;
  panel.addEventListener("click", (event) => event.stopPropagation());

  overlay = el("div", { class: CHROME.overlay }, [panel]);
  overlay.addEventListener("click", close);

  try {
    options.render(body, close);
  } catch {
    // A dialog that failed to fill itself should not be left on screen.
    close();
    return { close: () => undefined };
  }

  (document.body ?? document.documentElement).append(overlay);
  document.addEventListener("keydown", onKeyDown, true);
  track(close);

  return { close };
}

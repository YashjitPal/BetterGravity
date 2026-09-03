import type { ButtonHandle, ButtonSpec } from "@bettergravity/plugin-api";
import { el } from "../el.js";
import { CHROME, TOOLBAR, renderIcon } from "./chrome.js";

const OURS = "data-bettergravity-button";

interface Registration {
  readonly spec: ButtonSpec;
  label: string;
  active: boolean;
  element: HTMLElement | undefined;
}

const registrations = new Set<Registration>();
let observer: MutationObserver | undefined;

/**
 * `titleBar` is a container in its own right; the sidebar's actions are
 * siblings, so the button belongs next to the one we can find rather than
 * inside it.
 */
function container(spec: ButtonSpec): HTMLElement | undefined {
  const target = TOOLBAR[spec.area];
  const anchor = document.querySelector<HTMLElement>(target.anchor);
  if (!anchor) return undefined;
  return target.within === "parent" ? (anchor.parentElement ?? undefined) : anchor;
}

function build(registration: Registration): HTMLElement {
  const { spec } = registration;
  const shape = TOOLBAR[spec.area].shape;
  const iconOnly = spec.area === "titleBar";

  const button = el("button", {
    type: "button",
    [OURS]: spec.label,
    class: shape,
    title: spec.tooltip ?? spec.label,
    "aria-label": spec.label,
    "aria-pressed": registration.active,
    // Antigravity's title bar is a window drag region; without this the button
    // moves the window instead of receiving the click.
    "data-no-drag": ""
  });

  if (spec.icon) button.append(renderIcon(spec.icon, 16));
  if (!iconOnly) button.append(el("span", { class: "truncate", text: registration.label }));

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      spec.onClick(event);
    } catch {
      // A plugin's handler must not break the host's toolbar.
    }
  });

  return button;
}

function place(registration: Registration): void {
  if (registration.element?.isConnected) return;
  const parent = container(registration.spec);
  if (!parent) return;
  if (parent.querySelector(`[${OURS}="${CSS.escape(registration.spec.label)}"]`)) return;

  const element = build(registration);
  registration.element = element;
  parent.append(element);
}

function sync(): void {
  for (const registration of registrations) place(registration);
}

function start(): void {
  if (observer) return;
  observer = new MutationObserver(() => sync());
  const attach = () => {
    observer?.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    sync();
  };
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
}

export function addToolbarButton(spec: ButtonSpec): ButtonHandle {
  const registration: Registration = { spec, label: spec.label, active: false, element: undefined };
  registrations.add(registration);
  start();
  place(registration);

  return {
    get element() {
      return registration.element;
    },
    setLabel: (label) => {
      registration.label = label;
      const text = registration.element?.querySelector("span");
      if (text) text.textContent = label;
      registration.element?.setAttribute("aria-label", label);
    },
    setActive: (active) => {
      registration.active = active;
      const element = registration.element;
      if (!element) return;
      element.setAttribute("aria-pressed", String(active));
      element.className = active ? `${TOOLBAR[spec.area].shape} ${CHROME.accent.success}` : TOOLBAR[spec.area].shape;
    },
    remove: () => {
      registrations.delete(registration);
      registration.element?.remove();
      registration.element = undefined;
    }
  };
}

/** Test seam: the observer is process-wide otherwise. */
export function resetToolbarButtons(): void {
  for (const registration of registrations) registration.element?.remove();
  registrations.clear();
  observer?.disconnect();
  observer = undefined;
}

import type { MenuContext, MenuContributor, MenuItemSpec, Unpatch } from "@bettergravity/plugin-api";
import { el } from "../el.js";
import { CHROME, renderIcon } from "./chrome.js";

const DECORATED = "data-bettergravity-menu";
const OUR_GROUP = "data-bettergravity-menu-group";

const contributors = new Set<MenuContributor>();
let observer: MutationObserver | undefined;
let lastPointerTarget: HTMLElement | undefined;

/**
 * Antigravity builds its menus with Base UI, which renders them into a portal
 * appended to the body when they open and removes them when they close. There
 * is nothing to patch ahead of time, so entries are added as each menu appears.
 */
function itemContainer(menu: HTMLElement): HTMLElement | undefined {
  const first = menu.querySelector<HTMLElement>('[role="menuitem"]');
  return first?.parentElement ?? undefined;
}

/**
 * Base UI puts the popup's id in the trigger's `aria-controls`, which is the
 * only reliable link back from an open menu to the control that opened it.
 * Right-click menus have no such control, so the last pointer target stands in.
 */
function findTrigger(menu: HTMLElement): HTMLElement | undefined {
  for (let node: HTMLElement | null = menu; node; node = node.parentElement) {
    if (!node.id) continue;
    const byControls = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(node.id)}"]`);
    if (byControls) return byControls;
  }
  const open = document.querySelector<HTMLElement>('[data-popup-open][aria-expanded="true"]');
  return open ?? lastPointerTarget;
}

function buildItem(spec: MenuItemSpec, close: () => void): HTMLElement {
  const base = spec.danger ? CHROME.menuItemDanger : CHROME.menuItem;
  const item = el("div", {
    role: "menuitem",
    tabindex: -1,
    class: spec.disabled ? `${base} ${CHROME.menuItemDisabled}` : base,
    "aria-disabled": spec.disabled === true
  });

  if (spec.icon) item.append(renderIcon(spec.icon, 16));
  item.append(el("span", { class: "flex-1 truncate", text: spec.label }));

  const activate = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    if (spec.disabled) return;
    try {
      spec.onSelect();
    } finally {
      close();
    }
  };

  item.addEventListener("click", activate);
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") activate(event);
  });
  return item;
}

/** Base UI closes its own popup on Escape, so the host stays in charge of that. */
function closeMenu(menu: HTMLElement): void {
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

/**
 * What the contributors decided for a menu, so the host re-rendering its own
 * entries re-adds ours without asking the plugins a second time.
 *
 * The generation is bumped whenever a plugin is enabled or disabled, which is
 * what makes an open menu reconsider who wants to be in it.
 */
let generation = 0;
const decided = new WeakMap<HTMLElement, { readonly generation: number; readonly specs: readonly MenuItemSpec[] }>();

function decorate(menu: HTMLElement): void {
  const container = itemContainer(menu);
  // A menu whose entries have not rendered yet: leave it alone so the next
  // mutation reconsiders it.
  if (!container) return;

  let entry = decided.get(menu);
  if (entry?.generation !== generation) {
    const ours = container.querySelectorAll(`[${OUR_GROUP}]`);
    for (const group of ours) group.remove();

    const items = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const context: MenuContext = {
      element: menu,
      testids: items.map((item) => item.getAttribute("data-testid") ?? "").filter((id) => id !== ""),
      labels: items.map((item) => (item.textContent ?? "").trim()),
      has: (testid) => items.some((item) => item.getAttribute("data-testid") === testid),
      trigger: findTrigger(menu),
      close: () => closeMenu(menu)
    };

    const collected: MenuItemSpec[] = [];
    for (const contribute of contributors) {
      try {
        collected.push(...(contribute(context) ?? []));
      } catch {
        // A plugin's contributor must not stop the host's menu from working.
      }
    }
    entry = { generation, specs: collected };
    decided.set(menu, entry);
    menu.setAttribute(DECORATED, "1");
  }

  const { specs } = entry;
  if (specs.length === 0) return;
  if (container.querySelector(`[${OUR_GROUP}]`)) return;

  const group = el("div", { [OUR_GROUP]: "1" });
  // The host lays its entries out in a flex column, so the wrapper must not
  // become a box of its own.
  group.style.display = "contents";
  if (container.querySelector('[role="menuitem"]')) {
    group.append(el("div", { role: "separator", class: CHROME.separator }));
  }
  for (const spec of specs) group.append(buildItem(spec, () => closeMenu(menu)));
  container.append(group);
}

function scan(): void {
  for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) decorate(menu);
}

function start(): void {
  if (observer) return;

  const onPointer = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLElement) lastPointerTarget = target;
  };
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("contextmenu", onPointer, true);

  observer = new MutationObserver(() => scan());
  const attach = () => {
    observer?.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    scan();
  };
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
}

export function addMenuContributor(contributor: MenuContributor): Unpatch {
  contributors.add(contributor);
  generation += 1;
  start();
  scan();

  return () => {
    if (!contributors.delete(contributor)) return;
    generation += 1;
    // Whatever is on screen was decided with this contributor included, so the
    // remaining plugins are asked again rather than losing their entries too.
    for (const group of document.querySelectorAll(`[${OUR_GROUP}]`)) group.remove();
    scan();
  };
}

/** Test seam: the observer and listeners are process-wide otherwise. */
export function resetMenuContributors(): void {
  contributors.clear();
  generation += 1;
  observer?.disconnect();
  observer = undefined;
  lastPointerTarget = undefined;
}

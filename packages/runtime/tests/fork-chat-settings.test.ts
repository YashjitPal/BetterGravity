// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalogStore } from "../src/world/settings/catalog-store.js";
import { buildPluginsScreen, type SectionCallbacks } from "../src/world/settings/sections.js";
import { createFakeApi, pluginSummary, type FakeApi } from "./settings-fixture.js";

const source = readFileSync("community/plugins/fork-chat/index.js", "utf8");
const forkCss = readFileSync("community/plugins/fork-chat/styles/fork.css", "utf8");
const geminiCss = readFileSync("community/plugins/gemini-app/styles/conversation.css", "utf8");
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

let fake: FakeApi;
let disposers: (() => void)[];
let styles: HTMLStyleElement[];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  disposers = [];
  styles = [];
  fake = createFakeApi();
  fake.state = {
    ...fake.state,
    settings: { ...fake.state.settings, plugins: { developerMode: true, enabled: ["fork-chat"] } }
  };
  fake.summaries = [pluginSummary({
    id: "fork-chat",
    name: "Fork Chat",
    schema: { allTurns: { type: "boolean", label: "Show fork button on every response", default: true } }
  })];
  document.body.innerHTML = `
    <main data-testid="conversation-view">
      <div class="flex w-full items-start" data-gemini-turn-actions="true">
        <button aria-label="Fork Conversation"></button>
        <button data-fork-chat-btn="true" aria-label="Fork from this response"></button>
      </div>
    </main>`;
});

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  styles.forEach(style => style.remove());
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
});

function loadStyles(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  styles.push(style);
  document.head.append(style);
}

function startPlugin(): void {
  new Function("plugin", source)({
    settings: { define: () => ({}), onChange: () => () => {} },
    ui: { contextMenu() {}, toast() {}, modal() {} },
    onDispose: (cleanup: () => void) => disposers.push(cleanup)
  });
  vi.advanceTimersByTime(0);
}

function mountPlugins(): HTMLElement {
  const screen = document.createElement("section");
  screen.dataset.bettergravityScreen = "Plugins";
  const expanded = new Set<string>();
  const render = () => screen.replaceChildren(buildPluginsScreen(fake.api, callbacks));
  const callbacks: SectionCallbacks = {
    refresh: render,
    notify: () => {},
    isExpanded: id => expanded.has(id),
    toggleExpanded: id => {
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      render();
    },
    query: "",
    setQuery: () => {},
    catalog: createCatalogStore(fake.api, { changed: () => {}, notify: () => {} })
  };
  render();
  document.body.append(screen);
  return screen;
}

function visibleControl(screen: HTMLElement, label: string): HTMLButtonElement {
  const button = screen.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button, label).not.toBeNull();
  const style = getComputedStyle(button);
  expect(style.display, label).not.toBe("none");
  expect(style.visibility, label).not.toBe("hidden");
  expect(style.pointerEvents, label).not.toBe("none");
  expect(style.opacity, label).not.toBe("0");
  expect(button.hasAttribute("data-fork-hidden"), label).toBe(false);
  return button;
}

describe("Fork Chat settings controls", () => {
  it.each([
    { name: "Fork Chat styles", css: [forkCss], script: false },
    { name: "Gemini App styles", css: [geminiCss], script: false },
    { name: "Fork Chat observer", css: [], script: true },
    { name: "both plugins together", css: [forkCss, geminiCss], script: true }
  ])("keeps plugin controls usable with $name", async ({ css, script }) => {
    css.forEach(loadStyles);
    if (script) startPlugin();
    const screen = mountPlugins();
    await settle();

    visibleControl(screen, "Show Fork Chat options").click();
    await settle();
    visibleControl(screen, "Hide Fork Chat options");
    expect(screen.textContent).toContain("Show fork button on every response");
    visibleControl(screen, "Enable Fork Chat").click();
    expect(fake.patches).toContainEqual({ plugins: { enabled: [] } });
    visibleControl(screen, "Delete Fork Chat").click();
    await settle();
    expect(fake.calls).toContain("remove:plugin:fork-chat");
    visibleControl(screen, "Delete Fork Chat");

    const native = document.querySelector<HTMLElement>('[aria-label="Fork Conversation"]')!;
    expect(getComputedStyle(native).display).toBe("none");
    const replacement = document.querySelector<HTMLElement>("[data-fork-chat-btn]")!;
    expect(getComputedStyle(replacement).display).not.toBe("none");
  });

  it("ignores fork actions outside conversations when they mount later", async () => {
    loadStyles(forkCss);
    loadStyles(geminiCss);
    startPlugin();
    const elsewhere = document.createElement("section");
    elsewhere.innerHTML = '<button aria-label="Fork Conversation"></button>';
    document.body.append(elsewhere);
    await settle();
    visibleControl(elsewhere, "Fork Conversation");

    const turn = document.querySelector("[data-gemini-turn-actions]")!;
    const native = document.createElement("button");
    native.setAttribute("aria-label", "Fork Conversation");
    turn.append(native);
    await settle();
    expect(native.style.display).toBe("none");
    expect(getComputedStyle(native).display).toBe("none");
  });
});

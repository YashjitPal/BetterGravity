// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PetLibraryState, PetSprite } from "@bettergravity/plugin-api";
import { addToolbarButton, resetToolbarButtons } from "../src/world/ui/button.js";

const source = readFileSync("community/plugins/pets/index.js", "utf8");
const example: PetSprite = { id: "willow", displayName: "Willow", description: "A forest friend.", spriteVersionNumber: 2,
  previewDataUrl: "data:image/png;base64,cHJldmlldw==", spritesheetDataUrl: "data:image/webp;base64,c3ByaXRl" };
let state: PetLibraryState;
let cleanup: (() => void)[];
let changed: (() => void) | undefined;
let draftInNewChat: string;
let openCount: number;
let sent: string[];
let write: ReturnType<typeof vi.fn>;
let prepare: ReturnType<typeof vi.fn>;
let load: ReturnType<typeof vi.fn>;
let plugin: { createPet(): Promise<void>; openPetLibrary(): void; selectLibraryPet(id: string): Promise<void>; selected(): PetSprite | null; error(): string };

function composer(id: string, draft = ""): void {
  const main = document.querySelector("main")!;
  main.dataset.testid = "conversation-view";
  main.dataset.cascadeId = id;
  main.innerHTML = '<div data-testid="agent-input-box"><textarea></textarea><button data-testid="send-button">Send</button></div>';
  main.querySelector("textarea")!.value = draft;
  main.querySelector("button")!.onclick = () => sent.push(main.querySelector("textarea")!.value);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.spyOn(window, "focus").mockImplementation(() => undefined);
  cleanup = []; changed = undefined; openCount = 0; draftInNewChat = ""; sent = [];
  write = vi.fn();
  prepare = vi.fn(async () => ({ skillPath: "C:/Pets/skills/hatch-pet/SKILL.md", directory: "C:/BetterGravity/pets" }));
  load = vi.fn(async () => example);
  state = { enabled: true, skillPath: "C:/Pets/skills/hatch-pet/SKILL.md", directory: "C:/BetterGravity/pets", pets: [example], runs: [] };
  document.body.innerHTML = '<aside><a data-testid="new-conversation-button" href="/">New chat</a></aside><nav></nav><main></main>';
  history.replaceState(null, "", "/c/previous");
  composer("previous");
  document.querySelector("a")!.addEventListener("click", event => {
    event.preventDefault(); openCount++; history.replaceState(null, "", "/"); composer("conversation", draftInNewChat);
  });
  const context = {
    settings: { define: (schema: Record<string, { default?: unknown }>) => Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, value.default])), onChange: () => () => undefined },
    storage: { get: (key: string, fallback: unknown) => key === "shown" ? false : fallback, set: write },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ui: {
      button: addToolbarButton,
      modal: (options: { title: string; render(body: HTMLElement, close: () => void): void; onClose?(): void }) => {
        const body = document.createElement("section"); body.setAttribute("role", "dialog"); body.setAttribute("aria-label", options.title);
        document.body.append(body);
        const close = () => { body.remove(); options.onClose?.(); };
        options.render(body, close); cleanup.push(close); return { close };
      }
    },
    pets: { read: async () => state, load, prepareCreation: prepare, openFolder: vi.fn(), onChanged: (callback: () => void) => { changed = callback; return () => { changed = undefined; }; } },
    onDispose: (callback: () => void) => cleanup.push(callback)
  };
  plugin = new Function("plugin", "window", `${source}\nreturn {createPet,openPetLibrary,selectLibraryPet,selected:()=>selectedPet,error:()=>libraryError};`)(context, window);
  await Promise.resolve();
});

afterEach(() => {
  for (const callback of cleanup.reverse()) callback();
  resetToolbarButtons();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = "";
});

describe("Hatch Pet creation flow", () => {
  it("keeps the title-bar toggle when the host appears late and preserves the separate sidebar library", async () => {
    const sidebar = document.querySelector<HTMLButtonElement>('aside [data-bettergravity-button="Pets"]')!;
    expect(sidebar).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    const bar = document.createElement("header");
    bar.dataset.testid = "title-menu-bar";
    document.body.prepend(bar);
    await vi.advanceTimersByTimeAsync(1);
    const toggle = bar.querySelector<HTMLButtonElement>('[data-bettergravity-button="Pet"]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toBe("");
    expect(sidebar.isConnected).toBe(true);
    sidebar.click();
    expect(document.querySelector('[role="dialog"][aria-label="Pets"]')).not.toBeNull();
    expect(write).not.toHaveBeenCalledWith("shown", expect.anything());
    toggle.click();
    expect(write).toHaveBeenCalledWith("shown", true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(sidebar.isConnected).toBe(true);
    toggle.click();
  });

  it("prefills a new projectless chat with the registered skill without sending", async () => {
    const creating = plugin.createPet();
    await vi.advanceTimersByTimeAsync(300);
    await creating;
    expect(prepare).toHaveBeenCalledOnce();
    expect(openCount).toBe(1);
    expect(location.pathname).toBe("/");
    const text = document.querySelector("textarea")!.value;
    expect(text).toContain("hatch-pet");
    expect(text).toContain("create a pet based on what you know about me");
    expect(text).not.toContain("C:/");
    expect(sent).toEqual([]);
  });

  it("preserves a draft already present in the new conversation", async () => {
    draftInNewChat = "Keep this draft.";
    const creating = plugin.createPet(); await vi.advanceTimersByTimeAsync(300); await creating;
    expect(document.querySelector("textarea")!.value).toBe(draftInNewChat);
    expect(plugin.error()).toContain("already has a draft");
    expect(sent).toEqual([]);
  });

  it("reports skill installation failure before changing the conversation", async () => {
    prepare.mockRejectedValueOnce(new Error("Native skill registration failed"));
    await plugin.createPet();
    expect(openCount).toBe(0);
    expect(plugin.error()).toBe("Native skill registration failed");
  });

  it("does not navigate or revive the UI after the plugin is disabled during preparation", async () => {
    let finish!: (value: unknown) => void;
    prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const creating = plugin.createPet();
    for (const callback of cleanup.reverse()) callback(); cleanup = [];
    finish({ skillPath: "C:/Pets/SKILL.md", directory: "C:/Pets" });
    await creating;
    expect(openCount).toBe(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("selects a validated pet by id without persisting the full image", async () => {
    await plugin.selectLibraryPet("custom:willow");
    expect(load).toHaveBeenCalledWith("willow");
    expect(plugin.selected()?.spritesheetDataUrl).toBe(example.spritesheetDataUrl);
    expect(write).toHaveBeenCalledWith("selectedPet", "custom:willow");
    expect(JSON.stringify(write.mock.calls)).not.toContain(example.spritesheetDataUrl);
    await plugin.selectLibraryPet("rocky");
    expect(plugin.selected()).toBeNull();
  });

  it("keeps an AI pet named Rocky distinct from the bundled companion", async () => {
    const customRocky = { ...example, id: "rocky", displayName: "Rocky" };
    state = { ...state, pets: [customRocky] };
    load.mockResolvedValue(customRocky);
    plugin.openPetLibrary(); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('[data-pet-choice="rocky"] button')?.textContent).toBe("Selected");
    expect(document.querySelector('[data-pet-choice="custom:rocky"] button')?.textContent).toBe("Use pet");
    await plugin.selectLibraryPet("custom:rocky");
    expect(load).toHaveBeenCalledWith("rocky");
    expect(plugin.selected()).toEqual(customRocky);
    expect(document.querySelector('[data-pet-choice="custom:rocky"] button')?.textContent).toBe("Selected");
    await plugin.selectLibraryPet("rocky");
    expect(plugin.selected()).toBeNull();
  });

  it("renders real creation progress and refreshes the list when publication completes", async () => {
    state = { ...state, pets: [], runs: [{ id: "run-one", name: "Willow", stage: "posing", updatedAt: "2026-09-09T10:00:00Z", previewDataUrl: example.previewDataUrl }] };
    plugin.openPetLibrary(); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe("Picturing the poses");
    expect(document.querySelector(".bettergravity-pet-library__progress-image")?.getAttribute("src")).toBe(example.previewDataUrl);
    expect(document.querySelector('[data-pet-choice="custom:willow"]')).toBeNull();
    state = { ...state, pets: [example], runs: [{ ...state.runs[0]!, stage: "ready", petId: "willow" }] };
    changed!(); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('[data-pet-choice="custom:willow"]')?.textContent).toContain("Use pet");
    expect(document.querySelector(".bettergravity-pet-library__progress")).toBeNull();
  });
});

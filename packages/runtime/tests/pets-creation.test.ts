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
let saved: Record<string, unknown>;
let write: ReturnType<typeof vi.fn>;
let prepare: ReturnType<typeof vi.fn>;
let load: ReturnType<typeof vi.fn>;
let media: EventTarget & { matches: boolean };
let plugin: { createPet(): Promise<void>; openPetLibrary(): void; closePetLibrary(): void; selectLibraryPet(id: string): Promise<void>; selected(): PetSprite | null; error(): string; force(): string };

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
  media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal("matchMedia", () => media);
  vi.spyOn(window, "focus").mockImplementation(() => undefined);
  cleanup = []; changed = undefined; openCount = 0; draftInNewChat = ""; sent = [];
  saved = { shown: false };
  write = vi.fn((key: string, value: unknown) => { saved[key] = value; });
  prepare = vi.fn(async () => ({ skillPath: "C:/Pets/skills/hatch-pet/SKILL.md", directory: "C:/BetterGravity/pets" }));
  load = vi.fn(async () => example);
  state = { enabled: true, skillPath: "C:/Pets/skills/hatch-pet/SKILL.md", directory: "C:/BetterGravity/pets", pets: [example], runs: [] };
  document.body.innerHTML = '<aside><a data-testid="new-conversation-button" href="/">New chat</a></aside><nav></nav><div id="viewport"><main></main></div>';
  history.replaceState(null, "", "/c/previous");
  composer("previous");
  document.querySelector("a")!.addEventListener("click", event => {
    event.preventDefault(); openCount++; history.replaceState(null, "", "/"); composer("conversation", draftInNewChat);
  });
  const context = {
    settings: { define: (schema: Record<string, { default?: unknown }>) => Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, value.default])), onChange: () => () => undefined },
    storage: { get: (key: string, fallback: unknown) => Object.hasOwn(saved, key) ? saved[key] : fallback, set: write },
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
  plugin = new Function("plugin", "window", `${source}\nreturn {createPet,openPetLibrary,closePetLibrary,selectLibraryPet,selected:()=>selectedPet,error:()=>libraryError,force:()=>settings.force};`)(context, window);
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
    const page = document.querySelector('#viewport > #bettergravity-pets-view');
    expect(page).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(sidebar.getAttribute("aria-pressed")).toBe("true");
    expect(write).not.toHaveBeenCalledWith("shown", expect.anything());
    toggle.click();
    expect(write).toHaveBeenCalledWith("shown", true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(sidebar.isConnected).toBe(true);
    expect(page?.isConnected).toBe(true);
    toggle.click();
  });

  it("prefills a new projectless chat with the registered skill without sending", async () => {
    plugin.openPetLibrary();
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
    expect(document.querySelector("#bettergravity-pets-view")).toBeNull();
    expect(document.querySelector("main")!.inert).toBe(false);
  });

  it("preserves a draft already present in the new conversation", async () => {
    draftInNewChat = "Keep this draft.";
    plugin.openPetLibrary();
    const creating = plugin.createPet(); await vi.advanceTimersByTimeAsync(300); await creating;
    expect(document.querySelector("textarea")!.value).toBe(draftInNewChat);
    expect(plugin.error()).toContain("already has a draft");
    expect(document.querySelector("#bettergravity-pets-view [role='alert']")?.textContent).toContain("already has a draft");
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
    expect(document.querySelector('#bettergravity-pets-view')).toBeNull();
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

describe("Pets sidebar page", () => {
  const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
  const preview = () => document.querySelector<HTMLElement>(".bettergravity-pet-library__sprite")!;
  const label = () => document.querySelector(".bettergravity-pet-library__state-name")?.textContent;

  it("opens one page with a heading, description, animations, and pets without a search input", async () => {
    plugin.openPetLibrary();
    const page = document.querySelector("#bettergravity-pets-view")!;
    plugin.openPetLibrary();
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelectorAll("#bettergravity-pets-view")).toHaveLength(1);
    expect(page.querySelector("h1")?.textContent).toBe("Pets");
    expect(page.querySelector("header p")?.textContent).toContain("companion");
    const actions = page.querySelector(".bettergravity-pet-library__actions")!;
    expect(actions.textContent).toContain("Create with Gemini");
    expect(actions.compareDocumentPosition(page.querySelector(".bettergravity-pet-library__hero")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.querySelector("input")).toBeNull();
    expect(page.querySelectorAll("[data-pet-animation]")).toHaveLength(9);
    expect(page.querySelectorAll("[data-pet-choice]")).toHaveLength(2);
    expect(page.querySelector('[data-pet-choice="custom:willow"] img')?.getAttribute("src")).toBe(example.previewDataUrl);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("preserves the conversation, draft, and flex styles when entering and leaving", () => {
    const conversation = document.querySelector("main")!;
    const draft = document.querySelector("textarea")!;
    draft.value = "Keep my unfinished message.";
    conversation.setAttribute("aria-hidden", "false");
    plugin.openPetLibrary();
    expect(conversation.inert).toBe(true);
    expect(conversation.style.display).toBe("");
    expect(conversation.getAttribute("aria-hidden")).toBe("true");
    button('[data-bettergravity-button="Pets"]').click();
    expect(document.querySelector("main")).toBe(conversation);
    expect(conversation.inert).toBe(false);
    expect(conversation.style.display).toBe("");
    expect(conversation.getAttribute("aria-hidden")).toBe("false");
    expect(draft.value).toBe("Keep my unfinished message.");
    expect(document.querySelectorAll("[data-pet-page-hidden], [data-pet-page-host]")).toHaveLength(0);
  });

  it("switches to and from a Skills tab through its existing navigation action", () => {
    const skills = document.createElement("button");
    skills.id = "gemini-skills-button";
    document.querySelector("aside")!.append(skills);
    const conversation = document.querySelector("main")!;
    const navigate = vi.fn(() => {
      const existing = document.getElementById("gemini-skills-view");
      if (existing) { existing.remove(); conversation.style.display = ""; }
      else {
        const view = document.createElement("section"); view.id = "gemini-skills-view";
        document.getElementById("viewport")!.append(view); conversation.style.display = "none";
      }
    });
    skills.addEventListener("click", navigate);
    skills.click();
    plugin.openPetLibrary();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(document.getElementById("gemini-skills-view")).toBeNull();
    expect(conversation.style.display).toBe("");
    skills.click();
    expect(document.getElementById("bettergravity-pets-view")).toBeNull();
    expect(document.getElementById("gemini-skills-view")).not.toBeNull();
    expect(conversation.inert).toBe(false);
    expect(button('[data-bettergravity-button="Pets"]').getAttribute("aria-pressed")).toBe("false");
    skills.click();
    expect(conversation.style.display).toBe("");
  });

  it("wraps the arrows and supports dots and keyboard navigation without forcing the companion's state", () => {
    plugin.openPetLibrary();
    expect(label()).toBe("Idle");
    button('[aria-label="Previous animation"]').click();
    expect(label()).toBe("Blocked");
    button('[aria-label="Next animation"]').click();
    expect(label()).toBe("Idle");
    button('[aria-label="Next animation"]').click();
    expect(label()).toBe("Thinking");
    expect(preview().style.backgroundPosition).toBe("0% 70%");
    const jumping = button('[data-pet-animation="jumping"]');
    jumping.click(); jumping.focus();
    expect(label()).toBe("Jumping");
    jumping.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(label()).toBe("Running right");
    expect(document.activeElement).toBe(button('[data-pet-animation="running-right"]'));
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(label()).toBe("Idle");
    expect(document.querySelectorAll('[data-pet-animation][aria-pressed="true"]')).toHaveLength(1);
    expect(plugin.force()).toBe("auto");
    expect(write).not.toHaveBeenCalledWith("shown", expect.anything());
  });

  it("loops only valid waving frames and responds to reduced-motion changes", async () => {
    plugin.openPetLibrary(); await Promise.resolve(); await Promise.resolve();
    button('[data-pet-animation="waving"]').click();
    vi.advanceTimersByTime(2000);
    expect(preview().style.backgroundPosition).toBe("0% 30%");
    media.matches = false; media.dispatchEvent(new Event("change"));
    const frames = new Set<string>();
    for (let elapsed = 0; elapsed < 2500; elapsed += 100) {
      vi.advanceTimersByTime(100);
      const position = preview().style.backgroundPosition;
      const [column, row] = position.split(" ").map(Number.parseFloat);
      expect(row).toBe(30);
      expect(column).toBeLessThanOrEqual(3 / 7 * 100 + .001);
      frames.add(position);
    }
    expect(frames.size).toBe(4);
    media.matches = true; media.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(2000);
    expect(preview().style.backgroundPosition).toBe("0% 30%");
  });

  it("keeps the chosen animation and keyboard focus when the library refreshes", async () => {
    plugin.openPetLibrary(); await Promise.resolve(); await Promise.resolve();
    const next = button('[aria-label="Next animation"]');
    next.click(); next.focus();
    changed!(); await Promise.resolve(); await Promise.resolve();
    expect(label()).toBe("Thinking");
    expect(document.activeElement).toBe(button('[aria-label="Next animation"]'));
    expect(preview().style.backgroundPosition).toBe("0% 70%");
  });

  it("cancels a pending creation when the user leaves the page", async () => {
    plugin.openPetLibrary();
    let finish!: () => void;
    prepare.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const creating = plugin.createPet();
    button('[data-bettergravity-button="Pets"]').click();
    finish(); await creating;
    expect(openCount).toBe(0);
    expect(document.getElementById("bettergravity-pets-view")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("leaves the page on a host route change even when the companion is hidden", () => {
    plugin.openPetLibrary();
    history.replaceState(null, "", "/c/other");
    vi.advanceTimersByTime(2001);
    expect(document.getElementById("bettergravity-pets-view")).toBeNull();
    expect(document.querySelector("main")!.inert).toBe(false);
  });

  it("restores new host content and all page resources when disabled", async () => {
    plugin.openPetLibrary();
    const added = document.createElement("div");
    added.setAttribute("aria-hidden", "false");
    document.getElementById("viewport")!.append(added);
    await Promise.resolve();
    expect(added.inert).toBe(true);
    for (const callback of cleanup.reverse()) callback(); cleanup = [];
    expect(added.inert).toBe(false);
    expect(added.getAttribute("aria-hidden")).toBe("false");
    expect(document.querySelectorAll("#bettergravity-pets-view, [data-pet-page-hidden], [data-pet-page-host]")).toHaveLength(0);
    expect(document.body.classList.contains("bettergravity-pets-open")).toBe(false);
  });
});

describe("Pet name and description editing", () => {
  const row = (id = "custom:willow") => document.querySelector<HTMLElement>(`[data-pet-choice="${id}"]`)!;
  const editor = () => document.querySelector<HTMLElement>(".bettergravity-pet-editor")!;
  const input = (label: string) => editor().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  const rename = () => editor().querySelector<HTMLButtonElement>('[type="submit"]')!;
  const change = (label: string, value: string) => { input(label).value = value; input(label).dispatchEvent(new Event("input", { bubbles: true })); };
  const open = async (id = "custom:willow") => {
    plugin.openPetLibrary(); await Promise.resolve(); await Promise.resolve();
    row(id).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  };

  it("edits a selected pet's details without changing its identity or image, and keeps them on refresh", async () => {
    await plugin.selectLibraryPet("custom:willow");
    await open();
    expect(editor().querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBe("bettergravity-pet-editor-title");
    expect(editor().querySelector("h2")?.textContent).toBe("Rename this pet");
    expect(input("Pet name").value).toBe("Willow");
    expect(input("Description").value).toBe("A forest friend.");
    expect(document.activeElement).toBe(input("Pet name"));
    expect(input("Pet name").selectionStart).toBe(0);
    expect(input("Pet name").selectionEnd).toBe(6);
    expect(rename().disabled).toBe(true);
    write.mockClear();
    change("Pet name", "  Willow & <b>  ");
    change("Description", "A forest friend.\nEnjoys making things.");
    rename().click(); await vi.advanceTimersByTimeAsync(100);
    expect(editor()).toBeNull();
    expect(write).toHaveBeenCalledExactlyOnceWith("petDetails:custom:willow", { displayName: "Willow & <b>", description: "A forest friend.\nEnjoys making things." });
    expect(row().querySelector("strong")?.textContent).toBe("Willow & <b>");
    expect(row().querySelector("b")).toBeNull();
    expect(row().querySelector("button")?.textContent).toBe("Selected");
    expect(document.activeElement).toBe(row());
    expect(plugin.selected()).toEqual(example);
    changed!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector(".bettergravity-pet-library__sprite")?.getAttribute("aria-label")).toBe("Willow & <b>: Idle");
    await open();
    expect(input("Pet name").value).toBe("Willow & <b>");
    expect(input("Description").value).toBe("A forest friend.\nEnjoys making things.");
    expect(sent).toEqual([]);
  });

  it("keeps bundled and custom pets with the same id independent, and allows a description-only edit or empty description", async () => {
    state = { ...state, pets: [{ ...example, id: "rocky", displayName: "Rocky" }] };
    await open("rocky");
    change("Pet name", "Pebble"); change("Description", "");
    rename().click(); await vi.advanceTimersByTimeAsync(100);
    expect(row("rocky").querySelector("strong")?.textContent).toBe("Pebble");
    expect(row("rocky").querySelector(".bettergravity-pet-library__details span")?.textContent).toBe("");
    expect(row("custom:rocky").querySelector("strong")?.textContent).toBe("Rocky");
    await open("custom:rocky");
    change("Description", "My other companion.");
    expect(rename().disabled).toBe(false);
    rename().click(); await vi.advanceTimersByTimeAsync(100);
    expect(saved["petDetails:rocky"]).toEqual({ displayName: "Pebble", description: "" });
    expect(saved["petDetails:custom:rocky"]).toEqual({ displayName: "Rocky", description: "My other companion." });
    expect(plugin.selected()).toBeNull();
    expect(document.querySelector(".bettergravity-pet-library__sprite")?.getAttribute("aria-label")).toBe("Pebble: Idle");
  });

  it("cancels without saving through Cancel, Escape, or the backdrop and returns focus to the pet", async () => {
    for (const action of ["cancel", "escape", "backdrop"]) {
      await open(); change("Pet name", "Unfinished edit");
      if (action === "cancel") editor().querySelector<HTMLButtonElement>('[type="button"]')!.click();
      else if (action === "backdrop") editor().querySelector<HTMLElement>(".willow-gdlg-backdrop")!.click();
      else input("Pet name").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await vi.advanceTimersByTimeAsync(100);
      expect(editor()).toBeNull();
      expect(row().querySelector("strong")?.textContent).toBe("Willow");
      expect(document.activeElement).toBe(row());
      expect(document.getElementById("bettergravity-pets-view")!.inert).toBe(false);
      expect(document.querySelector("main")!.inert).toBe(true);
    }
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps editing drafts and keyboard focus inside the dialog while the library refreshes", async () => {
    await open();
    input("Pet name").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(editor().querySelector('[type="button"]'));
    document.querySelector<HTMLAnchorElement>("aside a")!.focus();
    expect(document.activeElement).toBe(input("Pet name"));
    change("Description", "Line one\nLine two");
    const draft = input("Description"); draft.focus();
    changed!(); await Promise.resolve(); await Promise.resolve();
    expect(input("Description")).toBe(draft);
    expect(document.activeElement).toBe(draft);
    expect(document.getElementById("bettergravity-pets-view")!.inert).toBe(true);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    draft.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(rename().isConnected).toBe(true);
    input("Pet name").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    expect(write).not.toHaveBeenCalled();
    draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(100);
    expect(saved["petDetails:custom:willow"]).toEqual({ displayName: "Willow", description: "Line one\nLine two" });
    expect(sent).toEqual([]);
  });

  it("supports Enter and F2 without opening an editor from the Use pet button", async () => {
    plugin.openPetLibrary(); await Promise.resolve(); await Promise.resolve();
    row().querySelector("button")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(editor()).toBeNull();
    for (const key of ["F2", "Enter"]) {
      row().focus(); row().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      expect(input("Pet name").value).toBe("Willow");
      editor().querySelector<HTMLButtonElement>('[type="button"]')!.click();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(plugin.selected()).toBeNull();
  });

  it("validates field limits and keeps the draft available if saving fails", async () => {
    await open();
    change("Pet name", "   "); expect(rename().disabled).toBe(true);
    change("Pet name", "x".repeat(101)); expect(rename().disabled).toBe(true);
    change("Pet name", "Willow Junior");
    change("Description", "x".repeat(501)); expect(rename().disabled).toBe(true);
    change("Description", "A new description.");
    write.mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
    rename().click();
    expect(editor().querySelector('[role="alert"]')?.textContent).toBe("Storage unavailable");
    expect(input("Pet name").value).toBe("Willow Junior");
    expect(rename().disabled).toBe(false);
    rename().click(); await vi.advanceTimersByTimeAsync(100);
    expect(editor()).toBeNull();
    expect(row().querySelector("strong")?.textContent).toBe("Willow Junior");
  });

  it("removes the dialog and focus trap when navigating away or disabling Pets", async () => {
    await open(); change("Pet name", "Do not save");
    plugin.closePetLibrary();
    expect(editor()).toBeNull();
    expect(document.querySelector("main")!.inert).toBe(false);
    const link = document.querySelector<HTMLAnchorElement>("aside a")!;
    link.focus(); expect(document.activeElement).toBe(link);
    await open();
    for (const callback of cleanup.reverse()) callback(); cleanup = [];
    await vi.advanceTimersByTimeAsync(100);
    link.focus(); expect(document.activeElement).toBe(link);
    expect(document.querySelectorAll(".bettergravity-pet-editor, #bettergravity-pets-view, [data-pet-page-hidden]")).toHaveLength(0);
    expect(document.querySelector("main")!.style.display).toBe("");
    expect(write).not.toHaveBeenCalled();
  });
});

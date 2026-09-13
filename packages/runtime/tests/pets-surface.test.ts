// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("community/plugins/pets/index.js", "utf8");
// Both the in-window pet and the desktop overlay execute this same function.
const mountSurface = new Function(`${source.slice(0, source.indexOf("/* ═══ PART TWO"))}\nreturn petSurface;`)();

type Entry = { key: string; status: string; title: string; subtitle: string };
type Message = { t: string; [key: string]: unknown };
const entry = (key: string, status = "running"): Entry => ({ key, status, title: key, subtitle: "" });

let receive: ((message: Message) => void) | undefined;
let media: EventTarget & { matches: boolean };
let sent: Message[];
let pet: HTMLElement;
let sprite: HTMLElement;
let setFocusable: ReturnType<typeof vi.fn>;
let setInteractive: ReturnType<typeof vi.fn>;
let focusOwner: ReturnType<typeof vi.fn>;

function mount(entries: Entry[] = [], config: Record<string, unknown> = {}, desktop = false, activityPillsVisible = true, badgeCorner = "top-end"): void {
  mountSurface({
    send: (message: Message) => sent.push(message),
    setInteractive,
    setFocusable,
    focusOwner,
    onMessage: (listener: (message: Message) => void) => {
      receive = listener;
      return () => { receive = undefined; };
    }
  }, { entries, config, desktop, activityPillsVisible, badgeCorner, at: { x: 200, y: 200 } });
  pet = document.querySelector<HTMLElement>(".bettergravity-pet")!;
  sprite = document.querySelector<HTMLElement>(".bettergravity-pet__body")!;
}

function move(overPet: boolean): void {
  vi.mocked(document.elementFromPoint).mockReturnValue(overPet ? pet : null);
  document.dispatchEvent(new MouseEvent("mousemove", {
    clientX: overPet ? 210 : 0,
    clientY: overPet ? 210 : 0,
    bubbles: true
  }));
}

function pointer(type: string, x: number, y: number, buttons = 1): void {
  const event = new MouseEvent(type, { clientX: x, clientY: y, buttons, button: 0, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  pet.dispatchEvent(event);
}

function pickUp(): void {
  pet.setPointerCapture = vi.fn();
  pet.hasPointerCapture = vi.fn(() => true);
  pet.releasePointerCapture = vi.fn();
  move(true);
  pointer("pointerdown", 210, 210);
  vi.advanceTimersByTime(20);
  pointer("pointermove", 250, 210);
  expect(pet.dataset.petDragging).toBe("true");
  expect(row()).toBe(1);
}

function chat(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(".bettergravity-pet-chat__input")!;
  vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
    x: 120, y: 400, left: 120, top: 400, right: 400, bottom: 440, width: 280, height: 40, toJSON() {}
  });
  input.focus();
  input.value = "A draft";
  input.setSelectionRange(input.value.length, input.value.length);
  return input;
}

function reply(key = "working"): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>(`[data-pet-key="${key}"] .bettergravity-pet-card__reply-input`)!;
}

function draftReply(value = "A draft", key = "working"): HTMLTextAreaElement {
  const input = reply(key);
  vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
    x: 120, y: 350, left: 120, top: 350, right: 400, bottom: 376, width: 280, height: 26, toJSON() {}
  });
  input.focus();
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

// Inspect the rendered sheet row, not data-pet-state: the original regression
// kept that attribute at "running" while visibly looping the idle row.
const row = () => Number.parseFloat(sprite.style.backgroundPosition.split(" ")[1] ?? "") / 10;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  setFocusable = vi.fn();
  setInteractive = vi.fn();
  focusOwner = vi.fn();
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => null) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 7 })
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  receive?.({ t: "bye" });
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "elementFromPoint");
  document.body.innerHTML = "";
});

describe("Pets animation behavior", () => {
  it.each([false, true])("uses the same image bytes through a short URL and releases it (desktop=%s)", async (desktop) => {
    const blobs: NodeBlob[] = [];
    const createObjectURL = vi.fn((blob: NodeBlob) => {
      blobs.push(blob);
      return `blob:pet-sheet-${blobs.length}`;
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("Blob", NodeBlob);
    const binary = "\x00\x01\x80\xff".repeat(10_000);
    const sheet = `data:image/webp;base64,${btoa(binary)}`;
    mount([entry("working")], { sheet }, desktop);
    expect(sprite.style.backgroundImage).toBe('url("blob:pet-sheet-1")');
    expect(blobs[0]!.type).toBe("image/webp");
    expect([...new Uint8Array(await blobs[0]!.arrayBuffer())]).toEqual([...binary].map(char => char.charCodeAt(0)));
    const first = sprite.style.backgroundPosition;
    vi.advanceTimersByTime(1000);
    expect(sprite.style.backgroundPosition).not.toBe(first);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    receive!({ t: "config", config: { sheet, size: 120 } });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    receive!({ t: "config", config: { sheet: `data:image/png;base64,${btoa("second image")}` } });
    expect(sprite.style.backgroundImage).toBe('url("blob:pet-sheet-2")');
    expect(revokeObjectURL.mock.calls).toEqual([["blob:pet-sheet-1"]]);
    receive!({ t: "bye" });
    expect(revokeObjectURL.mock.calls).toEqual([["blob:pet-sheet-1"], ["blob:pet-sheet-2"]]);
  });

  it("releases a generated sheet when switching back to built-in or remote artwork", () => {
    const createObjectURL = vi.fn().mockReturnValueOnce("blob:pet-one").mockReturnValueOnce("blob:pet-two");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const sheet = `data:image/webp;base64,${btoa("image")}`;
    mount([], { sheet });
    receive!({ t: "config", config: { sheet: "" } });
    expect(sprite.style.backgroundImage).toBe("");
    expect(pet.dataset.pet).toBe("rocky");
    receive!({ t: "config", config: { sheet } });
    receive!({ t: "config", config: { sheet: "https://example.com/pet.webp" } });
    expect(sprite.style.backgroundImage).toBe('url("https://example.com/pet.webp")');
    expect(revokeObjectURL.mock.calls).toEqual([["blob:pet-one"], ["blob:pet-two"]]);
    receive!({ t: "bye" });
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it.each(["unavailable", "failure"])("keeps the original sheet when local URLs are %s", (mode) => {
    const createObjectURL = vi.fn(() => { throw new Error("Unavailable"); });
    vi.stubGlobal("URL", mode === "unavailable" ? {} : { createObjectURL, revokeObjectURL: vi.fn() });
    const sheet = `data:image/webp;base64,${btoa("image")}`;
    mount([], { sheet });
    expect(sprite.style.backgroundImage).toBe(`url("${sheet}")`);
    expect(pet.dataset.pet).toBe("custom");
  });

  it("starts the slow idle animation without a pointer event", () => {
    mount();
    const first = sprite.style.backgroundPosition;
    vi.advanceTimersByTime(1681);
    expect(row()).toBe(0);
    expect(sprite.style.backgroundPosition).not.toBe(first);
  });

  it("keeps a single working agent animated for a full minute without hover", () => {
    mount([entry("working")]);
    for (let elapsed = 0; elapsed < 60_000; elapsed += 1000) {
      vi.advanceTimersByTime(750);
      expect(row()).toBe(7);
      const before = sprite.style.backgroundPosition;
      vi.advanceTimersByTime(250);
      expect(row()).toBe(7);
      expect(sprite.style.backgroundPosition).not.toBe(before);
    }
  });

  it.each(["waiting", "failed", "review"])("keeps working behind a higher-priority %s card", (status) => {
    mount([entry("needs attention", status), entry("still working")]);
    vi.advanceTimersByTime(8000);
    expect(row()).toBe(7);
    expect(document.querySelector("[data-pet-key]")?.getAttribute("data-pet-key")).toBe("needs attention");
  });

  it("keeps working when notifications are dismissed or hidden, then rests when work ends", () => {
    mount([entry("working")]);
    receive!({ t: "activity", entries: [], working: true });
    vi.advanceTimersByTime(20_000);
    expect(row()).toBe(7);
    expect(document.querySelector<HTMLElement>(".bettergravity-pet-tray")!.dataset.petTray).toBe("closed");
    receive!({ t: "activity", entries: [], working: false });
    expect(row()).toBe(0);
    const first = sprite.style.backgroundPosition;
    vi.advanceTimersByTime(1681);
    expect(sprite.style.backgroundPosition).not.toBe(first);
  });

  it("jumps on hover and returns to continuous work when the pointer leaves", () => {
    mount([entry("working")]);
    move(true);
    expect(row()).toBe(4);
    move(false);
    expect(row()).toBe(7);
    vi.advanceTimersByTime(10_000);
    expect(row()).toBe(7);
  });

  it("plays the waiting, blocked, and completed reactions when the last worker stops", () => {
    mount([entry("working")]);
    for (const [status, expected] of [["waiting", 6], ["failed", 5], ["review", 8]] as const) {
      receive!({ t: "activity", entries: [entry("finished", status)], working: false });
      expect(row()).toBe(expected);
      vi.advanceTimersByTime(10_000);
      expect(row()).toBe(0);
    }
    receive!({ t: "activity", entries: [] });
    expect(row()).toBe(0);
  });

  it("does not restart an animation when a running card's text changes", () => {
    mount([entry("working")]);
    vi.advanceTimersByTime(140);
    const before = sprite.style.backgroundPosition;
    receive!({ t: "activity", entries: [{ ...entry("working"), subtitle: "A new progress update" }] });
    expect(sprite.style.backgroundPosition).toBe(before);
    vi.advanceTimersByTime(120);
    expect(sprite.style.backgroundPosition).not.toBe(before);
  });

  it("honors reduced motion and resumes work when that preference changes", () => {
    media.matches = true;
    mount([entry("working")]);
    const first = sprite.style.backgroundPosition;
    vi.advanceTimersByTime(60_000);
    expect(row()).toBe(7);
    expect(sprite.style.backgroundPosition).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
    media.matches = false;
    media.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(10_000);
    expect(row()).toBe(7);
    expect(sprite.style.backgroundPosition).not.toBe(first);
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])("releases a held pet after %s without throwing it", (type) => {
    mount([entry("working")], { bounce: true });
    pickUp();
    const position = pet.style.left;
    if (type === "blur") window.dispatchEvent(new Event("blur"));
    else pointer(type, 250, 210);
    expect(pet.dataset.petDragging).toBeUndefined();
    expect(row()).toBe(7);
    vi.advanceTimersByTime(1000);
    expect(pet.style.left).toBe(position);
    expect(sent.some((message) => message.t === "poke")).toBe(false);
  });

  it("recovers if a release was missed while the pointer was outside the window", () => {
    mount([entry("working")]);
    pickUp();
    pointer("pointermove", 290, 210, 0);
    expect(pet.dataset.petDragging).toBeUndefined();
    expect(row()).toBe(7);
  });

  it("keeps working while an untargeted quick chat is being typed", () => {
    mount([entry("working")]);
    const input = chat();
    input.dispatchEvent(new Event("input"));
    expect(row()).toBe(7);
    vi.advanceTimersByTime(10_000);
    expect(row()).toBe(7);
  });

  it("requests native focus for Reply even when DOM focus emits no event", () => {
    mount([entry("working")], {}, true);
    const input = reply();
    // Chromium can update the selected field in a non-focusable native window
    // without dispatching focus. Relying on that event leaves typing in the app behind it.
    vi.spyOn(input, "focus").mockImplementation(() => undefined);
    document.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    expect(setFocusable).toHaveBeenCalledWith(true);
    expect(input.focus).toHaveBeenCalled();
    expect(sent.some((message) => message.t === "ask")).toBe(false);
  });

  it("looks at the follow-up caret and resumes work when it loses focus", () => {
    mount([entry("working")]);
    document.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    const input = draftReply();
    input.dispatchEvent(new Event("input"));
    expect(row()).toBeGreaterThanOrEqual(9);
    const pose = sprite.style.backgroundPosition;
    vi.advanceTimersByTime(10_000);
    expect(sprite.style.backgroundPosition).toBe(pose);
    input.blur();
    expect(row()).toBe(7);
    vi.advanceTimersByTime(10_000);
    expect(row()).toBe(7);
  });

  it("clears the follow-up look pose when its target card disappears", () => {
    mount([entry("working")]);
    document.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    const input = draftReply();
    input.dispatchEvent(new Event("input"));
    expect(row()).toBeGreaterThanOrEqual(9);
    receive!({ t: "activity", entries: [], working: true });
    expect(row()).toBe(7);
  });

  it.each([
    ["left", 1024, 0, 0],
    ["right", 1024, 10_000, 912],
    ["center", 1024, 456, 456],
    ["left", 360, 0, 0],
    ["right", 360, 10_000, 248]
  ])("keeps the pet at the %s of a %ipx viewport while fitting its cards and prompt", (position, viewportWidth, petX, expectedLeft) => {
    vi.stubGlobal("innerWidth", viewportWidth);
    mount([entry("Working")]);
    receive!({ t: "at", x: petX, y: 120 });
    const tray = document.querySelector<HTMLElement>(".bettergravity-pet-tray")!;
    const composer = document.querySelector<HTMLElement>(".bettergravity-pet-chat")!;
    const card = document.querySelector<HTMLElement>("[data-pet-key]")!;
    const center = tray.style.getPropertyValue("--pet-tray-x");
    const chatCenter = composer.style.getPropertyValue("--pet-chat-x");
    const mascotLeft = pet.style.left;
    const cardHalf = Number.parseFloat(tray.style.getPropertyValue("--pet-tray-width")) / 2;
    const chatHalf = Number.parseFloat(composer.style.getPropertyValue("--pet-chat-width")) / 2;
    expect(mascotLeft).toBe(`${expectedLeft}px`);
    if (position === "center") {
      expect(center).toBe(chatCenter);
      expect(Number.parseFloat(center)).toBe(Number.parseFloat(mascotLeft) + 56);
    } else {
      const cardEdge = Number.parseFloat(center) + (position === "left" ? -cardHalf : cardHalf);
      const chatEdge = Number.parseFloat(chatCenter) + (position === "left" ? -chatHalf : chatHalf);
      expect(cardEdge).toBe(position === "left" ? 8 : viewportWidth - 8);
      expect(chatEdge).toBe(position === "left" ? 6 : viewportWidth - 6);
    }
    for (const [positionX, half] of [[Number.parseFloat(center), cardHalf], [Number.parseFloat(chatCenter), chatHalf]] as const) {
      expect(positionX - half).toBeGreaterThanOrEqual(6);
      expect(positionX + half).toBeLessThanOrEqual(viewportWidth - 6);
    }

    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(composer.dataset.petChat).toBe("closed");
      vi.mocked(document.elementFromPoint).mockReturnValue(card);
      document.dispatchEvent(new MouseEvent("mousemove", {
        clientX: Number.parseFloat(center),
        clientY: Number.parseFloat(tray.style.getPropertyValue("--pet-tray-y")) + 27,
        bubbles: true
      }));
      expect(composer.dataset.petChat).toBe("open");
      expect(tray.style.getPropertyValue("--pet-tray-x")).toBe(center);
      expect(composer.style.getPropertyValue("--pet-chat-x")).toBe(chatCenter);
      expect(pet.style.left).toBe(mascotLeft);
      move(false);
      vi.advanceTimersByTime(350);
      expect(tray.style.getPropertyValue("--pet-tray-x")).toBe(center);
    }
  });

  it("does not submit Enter while an IME is composing text", () => {
    mount([entry("working")]);
    const input = chat();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    expect(sent.some((message) => message.t === "ask")).toBe(false);
    expect(input.value).toBe("A draft");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sent.filter((message) => message.t === "ask")).toEqual([{ t: "ask", text: "A draft", key: null }]);
  });

  it("removes its animation timer and message listener when disposed", () => {
    mount([entry("working")]);
    expect(vi.getTimerCount()).toBe(1);
    receive!({ t: "bye" });
    expect(vi.getTimerCount()).toBe(0);
    expect(receive).toBeUndefined();
    expect(document.querySelector(".bettergravity-pet")).toBeNull();
  });
});

describe.each([false, true])("Pets shared card width (desktop=%s)", (desktop) => {
  const trayWidth = () => Number.parseFloat(document.querySelector<HTMLElement>(".bettergravity-pet-tray")!.style.getPropertyValue("--pet-tray-width"));

  it("uses the widest task in any position, including while activity is hidden", () => {
    const entries = [entry("Short"), entry("Small"), entry("This is the longest task title")];
    mount(entries, {}, desktop, false);
    const widest = trayWidth();
    expect(widest).toBeGreaterThan(200);
    expect(widest).toBeLessThan(315);
    receive!({ t: "activity", entries: [entries[2], entries[0], entries[1]] });
    expect(trayWidth()).toBe(widest);
    receive!({ t: "activity", entries: [entries[0], entries[1], { ...entries[2], subtitle: "A much longer progress message that grows the width of every task card" }] });
    expect(trayWidth()).toBe(315);
    document.querySelector<HTMLButtonElement>(".bettergravity-pet__badge")!.click();
    expect(trayWidth()).toBe(315);
    receive!({ t: "activity", entries: [entries[0], entries[1]] });
    expect(trayWidth()).toBe(200);
  });

  it("remeasures the whole stack after its font finishes loading", () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    try {
      let unit = 5;
      vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ measureText: (text: string) => ({ width: text.length * unit }) } as CanvasRenderingContext2D);
      mount([entry("Short"), entry("This is the longest task title")], {}, desktop);
      const before = trayWidth();
      unit = 8;
      fonts.dispatchEvent(new Event("loadingdone"));
      expect(trayWidth()).toBeGreaterThan(before);
    } finally { Reflect.deleteProperty(document, "fonts"); }
  });
});

describe.each([false, true])("Pets close menu (desktop=%s)", (desktop) => {
  function openMenu(): HTMLElement {
    pet.dispatchEvent(new MouseEvent("contextmenu", { button: 2, clientX: 990, clientY: 740, bubbles: true, cancelable: true }));
    if (desktop) {
      const request = sent.filter(message => message.type === "bettergravity:overlay-context-menu").at(-1)!;
      receive!({ t: "", type: "bettergravity:overlay-context-menu-result", requestId: request.requestId, unsupported: true });
    }
    return document.querySelector<HTMLElement>(".bettergravity-pet-menu")!;
  }

  it("offers Close pet without dragging, opening the app, or dismissing tasks", () => {
    mount([entry("working")], {}, desktop);
    const menu = openMenu();
    expect(menu.hidden).toBe(false);
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.textContent).toBe("Close pet");
    expect(Number.parseFloat(menu.style.left)).toBeLessThan(990);
    expect(pet.style.left).toBe("200px");
    expect(pet.dataset.petDragging).toBeUndefined();
    expect(sent.some(message => ["poke", "open", "dismiss"].includes(message.t))).toBe(false);
    menu.querySelector<HTMLButtonElement>("button")!.click();
    expect(menu.hidden).toBe(true);
    expect(sent.filter(message => message.t === "hide")).toHaveLength(1);
  });

  it("dismisses with Escape or an outside click and removes the menu on teardown", () => {
    mount([entry("working")], {}, desktop);
    const menu = openMenu();
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(menu.hidden).toBe(true);
    openMenu();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(menu.hidden).toBe(true);
    expect(sent.some(message => message.t === "hide")).toBe(false);
    openMenu();
    receive!({ t: "bye" });
    expect(document.querySelector(".bettergravity-pet-menu")).toBeNull();
  });
});

it("handles only the current native context menu selection", () => {
  mount([entry("working")], {}, true);
  pet.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true }));
  const request = sent.find(message => message.type === "bettergravity:overlay-context-menu")!;
  expect(request.items).toEqual([{ id: "close-pet", label: "Close pet" }]);
  receive!({ t: "", type: "bettergravity:overlay-context-menu-result", requestId: "old-menu", id: "close-pet" });
  expect(sent.some(message => message.t === "hide")).toBe(false);
  receive!({ t: "", type: "bettergravity:overlay-context-menu-result", requestId: request.requestId, id: "close-pet" });
  expect(sent.filter(message => message.t === "hide")).toHaveLength(1);
  expect(document.querySelector<HTMLElement>(".bettergravity-pet-menu")!.hidden).toBe(true);
});

describe.each([false, true])("Pets activity badge (desktop=%s)", (desktop) => {
  const badge = () => document.querySelector<HTMLElement>(".bettergravity-pet__badge")!;
  const tray = () => document.querySelector<HTMLElement>(".bettergravity-pet-tray")!;
  const visibilityChanges = () => sent.filter(message => message.t === "activity-visibility");

  it.each([
    ["left", -500, 0], ["right", 1500, 912]
  ])("lets a drag reach the %s edge and keeps it there as activity changes", (_edge, pointerX, expectedLeft) => {
    vi.stubGlobal("innerWidth", 1024);
    mount([entry("working")], {}, desktop);
    move(true);
    pointer("pointerdown", 210, 210);
    pointer("pointermove", pointerX as number, 210);
    pointer("pointerup", pointerX as number, 210, 0);
    expect(pet.style.left).toBe(`${expectedLeft}px`);
    expect(sent.filter(message => message.t === "at").at(-1)).toMatchObject({ x: expectedLeft, y: 200 });
    expect(focusOwner).not.toHaveBeenCalled();

    receive!({ t: "activity", entries: [{ ...entry("working"), title: "A much wider task title that changes the activity card width" }] });
    expect(pet.style.left).toBe(`${expectedLeft}px`);
    receive!({ t: "config", config: { activity: false } });
    receive!({ t: "config", config: { activity: true } });
    expect(pet.style.left).toBe(`${expectedLeft}px`);
  });

  it("raises the app for a mascot click, but keeps dragging independent", () => {
    mount([entry("working")], {}, desktop);
    move(true);
    pointer("pointerdown", 210, 210);
    pointer("pointerup", 210, 210, 0);
    expect(sent.filter(message => message.t === "poke")).toHaveLength(1);
    expect(focusOwner).toHaveBeenCalledTimes(desktop ? 1 : 0);
    focusOwner.mockClear();
    pickUp();
    pointer("pointerup", 250, 210, 0);
    expect(sent.filter(message => message.t === "poke")).toHaveLength(1);
    expect(focusOwner).not.toHaveBeenCalled();
  });

  it("raises the selected task after expanding a pile, without changing badge or Reply behavior", () => {
    mount([entry("first"), entry("second")], {}, desktop);
    const first = document.querySelector<HTMLElement>('[data-pet-key="first"]')!;
    first.click();
    expect(tray().dataset.petStack).toBe("expanded");
    expect(focusOwner).not.toHaveBeenCalled();
    const second = document.querySelector<HTMLElement>('[data-pet-key="second"]')!;
    second.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    expect(focusOwner).not.toHaveBeenCalled();
    reply("second").click();
    expect(focusOwner).not.toHaveBeenCalled();
    second.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    second.click();
    expect(sent.filter(message => message.t === "open")).toEqual([{ t: "open", key: "second" }]);
    expect(focusOwner).toHaveBeenCalledTimes(desktop ? 1 : 0);
    focusOwner.mockClear();
    badge().click();
    expect(focusOwner).not.toHaveBeenCalled();
  });

  it("opens a single task immediately", () => {
    mount([entry("only")], {}, desktop);
    document.querySelector<HTMLElement>('[data-pet-key="only"]')!.click();
    expect(sent.filter(message => message.t === "open")).toEqual([{ t: "open", key: "only" }]);
    expect(focusOwner).toHaveBeenCalledTimes(desktop ? 1 : 0);
  });

  it("recovers desktop input from native cursor samples without forwarded mouse events", () => {
    mount([entry("working")], {}, desktop);
    vi.mocked(document.elementFromPoint).mockReturnValue(pet);
    const sample = () => receive!({ type: "bettergravity:overlay-pointer", x: 210, y: 210 } as unknown as Message);
    sample();
    if (!desktop) {
      expect(setInteractive).not.toHaveBeenCalled();
      return;
    }
    expect(setInteractive).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new Event("blur"));
    expect(setInteractive).toHaveBeenLastCalledWith(false);
    sample();
    expect(setInteractive).toHaveBeenLastCalledWith(true);
    receive!({ type: "bettergravity:overlay-pointer", x: 0, y: 0 } as unknown as Message);
    expect(setInteractive).toHaveBeenLastCalledWith(false);
  });

  it("holds a badge drag across empty space until the pointer is released", () => {
    mount([entry("working")], {}, desktop);
    const control = badge();
    const dispatch = (type: string) => {
      const event = new MouseEvent(type, { clientX: 300, clientY: 210, button: 0, bubbles: true });
      Object.defineProperty(event, "pointerId", { value: 7 });
      control.dispatchEvent(event);
    };
    dispatch("pointerdown");
    move(false);
    document.dispatchEvent(new MouseEvent("mouseleave"));
    if (desktop) {
      expect(setInteractive).toHaveBeenLastCalledWith(true);
      expect(setInteractive.mock.calls.some(([interactive]) => interactive === false)).toBe(false);
    } else expect(setInteractive).not.toHaveBeenCalled();
    dispatch("pointerup");
    move(false);
    if (desktop) expect(setInteractive).toHaveBeenLastCalledWith(false);
    else expect(setInteractive).not.toHaveBeenCalled();
  });

  it.each([
    [205, 205, "top-start"], [305, 205, "top-end"],
    [205, 315, "bottom-start"], [305, 315, "bottom-end"]
  ])("drags the badge to (%i, %i) without moving the pet or hiding activity", (x, y, corner) => {
    mount([entry("working")], {}, desktop);
    const control = badge();
    const original = pet.style.cssText;
    const dispatch = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { clientX, clientY, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true });
      Object.defineProperty(event, "pointerId", { value: 7 });
      control.dispatchEvent(event);
    };
    dispatch("pointerdown", 300, 210);
    dispatch("pointermove", x as number, y as number);
    dispatch("pointerup", x as number, y as number);
    control.click();
    expect(pet.dataset.petBadgeCorner).toBe(corner);
    expect(pet.style.cssText).toBe(original);
    expect(tray().dataset.petTray).toBe("open");
    expect(sent.filter(message => ["badge-corner", "activity-visibility", "poke", "open"].includes(message.t))).toEqual([
      { t: "badge-corner", corner }
    ]);
    vi.advanceTimersByTime(0);
    control.click();
    expect(tray().dataset.petTray).toBe("closed");
  });

  it("keeps the count visible after pointer exit and restores a saved corner", () => {
    mount(Array.from({ length: 12 }, (_, index) => entry(String(index))), {}, desktop, false, "bottom-start");
    expect(badge().tagName).toBe("BUTTON");
    expect(badge().closest('[aria-hidden="true"]')).toBeNull();
    expect(pet.dataset.petBadgeCorner).toBe("bottom-start");
    move(true);
    move(false);
    vi.advanceTimersByTime(1000);
    expect(pet.dataset.petBadge).toBe("visible");
    expect(badge().hidden).toBe(false);
    expect(badge().querySelector(".bettergravity-pet__badge-count")!.textContent).toBe("12");
  });

  it("collapses before hiding, then restores a pile with its scroll position reset", () => {
    mount(Array.from({ length: 12 }, (_, index) => entry(`task-${index}`)), {}, desktop);
    document.querySelector<HTMLElement>('[data-pet-key="task-0"]')!.click();
    expect(badge().getAttribute("aria-label")).toBe("Collapse activity stack");
    tray().dispatchEvent(new WheelEvent("wheel", { deltaY: 1000, bubbles: true }));
    expect(tray().dataset.petOverflow).toBe("top");

    badge().click();
    expect(tray().dataset.petStack).toBe("collapsed");
    expect(tray().dataset.petTray).toBe("open");
    expect(badge().getAttribute("aria-label")).toBe("Hide activity");
    expect(visibilityChanges()).toEqual([]);
    badge().click();
    expect(tray().dataset.petTray).toBe("closed");
    expect(tray().inert).toBe(true);
    expect(pet.dataset.petBadgeKind).toBe("count");
    expect(badge().getAttribute("aria-label")).toBe("Show activity, 12 items");
    badge().click();
    expect(tray().dataset.petTray).toBe("open");
    expect(tray().inert).toBe(false);
    expect(tray().dataset.petStack).toBe("collapsed");
    expect(pet.dataset.petBadgeKind).toBe("chevron");
    expect(visibilityChanges()).toEqual([
      { t: "activity-visibility", visible: false },
      { t: "activity-visibility", visible: true }
    ]);

    document.querySelector<HTMLElement>('[data-pet-key="task-0"]')!.click();
    expect(tray().dataset.petOverflow).toBe("bottom");
    expect(document.querySelector<HTMLElement>('[data-pet-key="task-0"]')!.style.getPropertyValue("--pet-card-y")).toBe("0px");
  });

  it("keeps restored hidden activity hidden while tasks and settings change", () => {
    mount([], {}, desktop, false);
    expect(pet.dataset.petBadge).toBe("hidden");
    badge().click();
    expect(visibilityChanges()).toEqual([]);
    receive!({ t: "activity", entries: [entry("working")] });
    expect(badge().getAttribute("aria-label")).toBe("Show activity, 1 item");
    expect(tray().dataset.petTray).toBe("closed");
    receive!({ t: "config", config: { size: 120, activity: false } });
    receive!({ t: "activity", entries: [] });
    receive!({ t: "config", config: { activity: true } });
    receive!({ t: "activity", entries: [entry("working", "waiting"), entry("new")] });
    expect(tray().dataset.petTray).toBe("closed");
    expect(badge().getAttribute("aria-label")).toBe("Show activity, 2 items");
    expect(visibilityChanges()).toEqual([]);
    badge().click();
    expect(tray().dataset.petTray).toBe("open");
    expect(tray().dataset.petStack).toBe("collapsed");
  });

  it("hides a single remaining task directly even when the stack was expanded", () => {
    mount([entry("working"), entry("other")], {}, desktop);
    document.querySelector<HTMLElement>('[data-pet-key="working"]')!.click();
    receive!({ t: "activity", entries: [entry("working")] });
    expect(badge().getAttribute("aria-label")).toBe("Hide activity");
    badge().click();
    expect(tray().dataset.petTray).toBe("closed");
    expect(badge().getAttribute("aria-label")).toBe("Show activity, 1 item");
    expect(visibilityChanges()).toEqual([{ t: "activity-visibility", visible: false }]);
  });

  it("keeps expansion and scroll through pointer exit and empty or shorter notification snapshots", () => {
    const entries = Array.from({ length: 8 }, (_, index) => entry(`task-${index}`));
    mount(entries, {}, desktop);
    document.querySelector<HTMLElement>('[data-pet-key="task-0"]')!.click();
    tray().dispatchEvent(new WheelEvent("wheel", { deltaY: 248, bubbles: true }));
    const offset = () => document.querySelector<HTMLElement>('[data-pet-key="task-5"]')!.style.getPropertyValue("--pet-card-y");
    const before = offset();
    move(true);
    move(false);
    vi.advanceTimersByTime(1000);
    expect(tray().dataset.petStack).toBe("expanded");
    receive!({ t: "activity", entries: [] });
    expect(pet.dataset.petBadge).toBe("hidden");
    expect(tray().dataset.petTray).toBe("closed");
    badge().click();
    receive!({ t: "activity", entries });
    expect(tray().dataset.petTray).toBe("open");
    expect(tray().dataset.petStack).toBe("expanded");
    expect(badge().getAttribute("aria-label")).toBe("Collapse activity stack");
    expect(offset()).toBe(before);
    receive!({ t: "activity", entries: [entries[0]] });
    expect(document.querySelector<HTMLElement>('[data-pet-key="task-0"]')!.style.getPropertyValue("--pet-card-y")).toBe("0px");
    receive!({ t: "activity", entries });
    expect(offset()).toBe(before);
    expect(visibilityChanges()).toEqual([]);
  });

  it("preserves a reply on a covered card while collapsing, hiding, and restoring activity", () => {
    mount([entry("first"), entry("working")], {}, desktop);
    document.querySelector<HTMLElement>('[data-pet-key="first"]')!.click();
    document.querySelector<HTMLElement>('[data-pet-key="working"] [data-pet-control="reply"]')!.click();
    const field = draftReply("Keep this unsent reply");
    badge().click();
    expect(document.activeElement).not.toBe(field);
    if (desktop) expect(setFocusable).toHaveBeenLastCalledWith(false);
    badge().click();
    badge().click();
    document.querySelector<HTMLElement>('[data-pet-key="first"]')!.click();
    expect(reply().value).toBe("Keep this unsent reply");
    expect(reply().disabled).toBe(false);
    expect(sent.filter(message => ["open", "ask"].includes(message.t))).toEqual([]);
  });
});

describe("Pets inline task replies", () => {
  it.each([false, true])("opens the reply inside its card without navigating or replacing quick chat (desktop=%s)", (desktop) => {
    mount([entry("working")], {}, desktop);
    const quick = chat();
    const button = document.querySelector<HTMLButtonElement>('[data-pet-control="reply"]')!;
    button.click();
    const field = reply();
    expect(field.closest("[data-pet-key]")?.getAttribute("data-pet-key")).toBe("working");
    expect(field.closest(".bettergravity-pet-card__header")).toBeNull();
    expect(field.placeholder).toBe("Follow up");
    expect(field.getAttribute("aria-label")).toBe("Follow up on working");
    expect(document.activeElement).toBe(field);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(quick.value).toBe("A draft");
    field.click();
    expect(sent.filter(message => ["open", "ask"].includes(message.t))).toEqual([]);
    draftReply("An inline draft");
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(field.disabled).toBe(true);
    expect(field.value).toBe("");
    expect(quick.value).toBe("A draft");
    button.click();
    expect(field.value).toBe("");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("handles multiline input, IME, pending submission, failure, retry, and stale acknowledgements", () => {
    mount([entry("working")]);
    document.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    const field = draftReply("  First line\nSecond line  ");
    const enter = (options = {}) => field.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true, ...options
    }));
    expect(enter({ shiftKey: true })).toBe(true);
    expect(enter({ isComposing: true })).toBe(true);
    expect(enter({ keyCode: 229 })).toBe(true);
    expect(sent.filter(message => message.t === "ask")).toEqual([]);
    expect(enter()).toBe(false);
    enter();
    const sends = () => sent.filter(message => message.t === "ask");
    expect(sends()).toEqual([{ t: "ask", key: "working", text: "First line\nSecond line", requestId: "1" }]);
    expect(field.form?.getAttribute("aria-busy")).toBe("true");
    expect(field.value).toBe("  First line\nSecond line  ");
    receive!({ t: "reply-result", key: "working", requestId: "1", ok: false });
    const error = field.form!.querySelector<HTMLElement>('[role="alert"]')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("Unable to send reply");
    expect(field.form?.getAttribute("aria-busy")).toBe("false");
    expect(field.value).toContain("Second line");
    enter();
    expect(sends()).toHaveLength(2);
    receive!({ t: "reply-result", key: "working", requestId: "1", ok: true });
    expect(field.disabled).toBe(false);
    receive!({ t: "reply-result", key: "working", requestId: "2", ok: true });
    expect(field.disabled).toBe(true);
    expect(field.value).toBe("");
  });

  it("ignores empty replies and keeps a quick-chat send separate from an open reply", () => {
    mount([entry("working")]);
    document.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    const field = draftReply(" \n ");
    field.form!.requestSubmit();
    expect(sent.filter(message => message.t === "ask")).toEqual([]);
    field.value = "Keep this follow-up";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const quick = chat();
    quick.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(sent.filter(message => message.t === "ask")).toEqual([{ t: "ask", text: "A draft", key: null }]);
    expect(field.value).toBe("Keep this follow-up");
    expect(field.disabled).toBe(false);
  });

  it("keeps the draft, selection, and focused element with its task when notifications reorder", () => {
    const entries = [entry("first"), entry("working"), entry("third")];
    mount(entries);
    document.querySelector<HTMLElement>('[data-pet-key="first"]')!.click();
    document.querySelector<HTMLElement>('[data-pet-key="working"] [data-pet-control="reply"]')!.click();
    const field = draftReply("Keep my selection");
    field.setSelectionRange(2, 7, "backward");
    receive!({ t: "activity", entries: [entries[2], entries[0], { ...entries[1], subtitle: "Updated progress" }] });
    expect(reply()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 7, "backward"]);
    expect(field.value).toBe("Keep my selection");
    field.form!.requestSubmit();
    expect(sent.filter(message => message.t === "ask")).toEqual([
      { t: "ask", key: "working", text: "Keep my selection", requestId: "1" }
    ]);
  });

  it("preserves a draft across pooled cards when scrolling a long task list", () => {
    mount(Array.from({ length: 12 }, (_, index) => entry(`task-${index}`)));
    document.querySelector<HTMLElement>('[data-pet-key="task-0"]')!.click();
    document.querySelector<HTMLElement>('[data-pet-key="task-0"] [data-pet-control="reply"]')!.click();
    draftReply("A draft for task zero", "task-0");
    const tray = document.querySelector<HTMLElement>(".bettergravity-pet-tray")!;
    tray.dispatchEvent(new WheelEvent("wheel", { deltaY: 1000, bubbles: true }));
    expect(document.activeElement).not.toBe(reply("task-0"));
    expect(document.querySelectorAll(".bettergravity-pet-card__reply-input")).toHaveLength(8);
    tray.dispatchEvent(new WheelEvent("wheel", { deltaY: -1000, bubbles: true }));
    expect(reply("task-0").value).toBe("A draft for task zero");
    reply("task-0").form!.requestSubmit();
    expect(sent.filter(message => message.t === "ask")[0]).toMatchObject({ key: "task-0", text: "A draft for task zero" });
  });

  it("keeps native focus when switching between its editors and releases it on exit", () => {
    mount([entry("working")], {}, true);
    document.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    setFocusable.mockClear();
    const quick = chat();
    expect(setFocusable.mock.calls.every(([focus]) => focus === true)).toBe(true);
    reply().focus();
    expect(setFocusable.mock.calls.every(([focus]) => focus === true)).toBe(true);
    reply().blur();
    expect(setFocusable).toHaveBeenLastCalledWith(false);
    expect(quick.value).toBe("A draft");
  });

  it("removes an active reply and its animation callbacks when the plugin closes", () => {
    mount([entry("working")], {}, true);
    document.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    vi.advanceTimersByTime(32);
    receive!({ t: "bye" });
    expect(document.querySelector(".bettergravity-pet-card__reply-input")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(setFocusable).toHaveBeenLastCalledWith(false);
  });

  it.each([80, 112, 224])("keeps the standard corner badge visible for a %ipx pet", (size) => {
    mount([entry("working")], { size });
    expect(pet.dataset.petBadgeCorner).toBe("top-end");
    expect(pet.dataset.petBadge).toBe("visible");
    move(true);
    expect(pet.dataset.petBadge).toBe("visible");
  });
});

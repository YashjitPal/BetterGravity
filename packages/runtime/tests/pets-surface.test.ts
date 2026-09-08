// @vitest-environment jsdom

import { readFileSync } from "node:fs";
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

function mount(entries: Entry[] = [], config: Record<string, unknown> = {}): void {
  mountSurface({
    send: (message: Message) => sent.push(message),
    setInteractive: vi.fn(),
    onMessage: (listener: (message: Message) => void) => {
      receive = listener;
      return () => { receive = undefined; };
    }
  }, { entries, config, at: { x: 200, y: 200 } });
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

// Inspect the rendered sheet row, not data-pet-state: the original regression
// kept that attribute at "running" while visibly looping the idle row.
const row = () => Number.parseFloat(sprite.style.backgroundPosition.split(" ")[1] ?? "") / 10;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
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

  it("looks at the follow-up caret and resumes work when that reply is closed", () => {
    mount([entry("working")]);
    document.querySelector<HTMLElement>('[data-pet-control="reply"]')!.click();
    const input = chat();
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
    const input = chat();
    input.dispatchEvent(new Event("input"));
    expect(row()).toBeGreaterThanOrEqual(9);
    receive!({ t: "activity", entries: [], working: true });
    expect(row()).toBe(7);
  });

  it.each([
    ["left", 1024, 0],
    ["right", 1024, 10_000],
    ["left", 360, 0],
    ["right", 360, 10_000]
  ])("keeps independent horizontal positions when chat opens at the %s edge of a %ipx viewport", (edge, viewportWidth, petX) => {
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
    const edgeOf = (center: string, half: number) => Number.parseFloat(center) + (edge === "right" ? half : -half);
    // Each surface can reach the same screen edge despite their different
    // widths. A shared center would strand the narrower card farther inward.
    expect(edgeOf(center, cardHalf)).toBe(edgeOf(chatCenter, chatHalf));
    expect(center).not.toBe(chatCenter);

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

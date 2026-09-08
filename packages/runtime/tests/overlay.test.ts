import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayWindow } from "../src/main/overlay.js";

interface FakeWindow {
  options: Record<string, unknown>;
  setFocusable: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  showInactive: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(() => ({ windows: [] as FakeWindow[] }));

vi.mock("../src/main/logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("electron", () => ({
  BrowserWindow: class {
    destroyed = false;
    options: Record<string, unknown>;
    setFocusable = vi.fn();
    focus = vi.fn();
    showInactive = vi.fn();
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    on = vi.fn();
    loadURL = vi.fn(async () => undefined);
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn(), once: vi.fn() };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.windows.push(this);
    }

    isDestroyed(): boolean { return this.destroyed; }
    destroy(): void { this.destroyed = true; }
  },
  screen: {
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }),
    on: vi.fn()
  }
}));

let overlay: OverlayWindow;

beforeEach(() => {
  state.windows.length = 0;
  overlay = new OverlayWindow();
});

afterEach(() => overlay.dispose());

function open(): FakeWindow {
  const page = { id: 1 } as Electron.WebContents;
  expect(overlay.open(page, "pets", { script: "void 0;" }).open).toBe(true);
  return state.windows[0]!;
}

describe("desktop overlay keyboard focus", () => {
  it("opens without taking keyboard focus from Antigravity", () => {
    const window = open();
    expect(window.options["focusable"]).toBe(false);
    expect(window.options["show"]).toBe(false);
    expect(window.focus).not.toHaveBeenCalled();
  });

  // Focusing only the DOM input in a non-focusable BrowserWindow made the pet's
  // chat box look active while all typed keys still went to another application.
  it("accepts native keyboard focus only when the surface requests text entry", () => {
    const window = open();
    overlay.setFocusable(true);
    overlay.setFocusable(true);
    expect(window.setFocusable).toHaveBeenCalledExactlyOnceWith(true);
    expect(window.focus).toHaveBeenCalledTimes(1);

    overlay.setFocusable(false);
    expect(window.setFocusable).toHaveBeenLastCalledWith(false);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it("ignores focus requests after the overlay has closed", () => {
    const window = open();
    overlay.close();
    overlay.setFocusable(true);
    expect(window.setFocusable).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
  });
});

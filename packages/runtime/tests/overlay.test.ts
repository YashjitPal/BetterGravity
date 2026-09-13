import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayWindow } from "../src/main/overlay.js";
import { CHANNEL } from "../src/protocol.js";

interface FakeWindow {
  options: Record<string, unknown>;
  setFocusable: ReturnType<typeof vi.fn>;
  isFocusable(): boolean;
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  showInactive: ReturnType<typeof vi.fn>;
  webContents: {
    once: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    getZoomFactor: ReturnType<typeof vi.fn>;
  };
  getContentBounds: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(() => ({
  menu: {
    templates: [] as { label: string; click: () => void }[][],
    popup: vi.fn(), closePopup: vi.fn()
  },
  windows: [] as FakeWindow[], cursor: { x: 240, y: 180 }, cursorReads: vi.fn(),
  owner: {
    isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false), isVisible: vi.fn(() => true),
    restore: vi.fn(), show: vi.fn(), focus: vi.fn()
  },
  page: { id: 1, isDestroyed: vi.fn(() => false), send: vi.fn(), focus: vi.fn() }
}));

vi.mock("../src/main/logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("electron", () => ({
  Menu: { buildFromTemplate: (items: { label: string; click: () => void }[]) => {
    state.menu.templates.push(items);
    return { popup: state.menu.popup, closePopup: state.menu.closePopup };
  } },
  BrowserWindow: class {
    static fromWebContents = (page: unknown) => page === state.page ? state.owner : null;
    destroyed = false;
    focusable = false;
    options: Record<string, unknown>;
    setFocusable = vi.fn((focusable: boolean) => { this.focusable = focusable; });
    focus = vi.fn();
    showInactive = vi.fn();
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    on = vi.fn();
    loadURL = vi.fn(async () => undefined);
    getContentBounds = vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 }));
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn(), once: vi.fn(), send: vi.fn(), isDestroyed: () => false, getZoomFactor: vi.fn(() => 1) };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.windows.push(this);
    }

    isDestroyed(): boolean { return this.destroyed; }
    isFocusable(): boolean { return this.focusable; }
    destroy(): void { this.destroyed = true; }
  },
  screen: {
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    }),
    getCursorScreenPoint: () => { state.cursorReads(); return state.cursor; },
    on: vi.fn()
  }
}));

let overlay: OverlayWindow;

beforeEach(() => {
  vi.useFakeTimers();
  state.windows.length = 0;
  state.menu.templates.length = 0;
  state.menu.popup.mockClear();
  state.menu.closePopup.mockClear();
  state.cursor = { x: 240, y: 180 };
  state.cursorReads.mockClear();
  for (const mock of Object.values(state.owner)) mock.mockClear();
  state.owner.isDestroyed.mockReturnValue(false);
  state.owner.isMinimized.mockReturnValue(false);
  state.owner.isVisible.mockReturnValue(true);
  state.page.isDestroyed.mockReturnValue(false);
  state.page.send.mockClear();
  state.page.focus.mockClear();
  overlay = new OverlayWindow();
});

afterEach(() => { overlay.dispose(); vi.useRealTimers(); });

function open(interactive = false): FakeWindow {
  const page = state.page as unknown as Electron.WebContents;
  expect(overlay.open(page, "pets", { script: "void 0;", interactive }).open).toBe(true);
  return state.windows.at(-1)!;
}

describe("desktop overlay native context menu", () => {
  const request = { type: "bettergravity:overlay-context-menu", requestId: "menu-1", items: [{ id: "close-pet", label: "Close pet" }] };
  function attach(): FakeWindow {
    const window = open(true);
    window.webContents.once.mock.calls.find(call => call[0] === "dom-ready")![1]();
    return window;
  }

  it("uses a native menu and returns only its selection to the requesting surface", () => {
    const window = attach();
    overlay.toPage(request);
    expect(state.menu.templates[0]!.map(item => item.label)).toEqual(["Close pet"]);
    expect(state.menu.popup).toHaveBeenCalledWith({ window, callback: expect.any(Function) });
    expect(state.page.send).not.toHaveBeenCalled();
    overlay.setInteractive(false);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    state.menu.templates[0]![0]!.click();
    expect(window.webContents.send).toHaveBeenLastCalledWith(CHANNEL.overlayMessage, {
      type: "bettergravity:overlay-context-menu-result", requestId: "menu-1", id: "close-pet"
    });
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    const count = window.webContents.send.mock.calls.length;
    state.menu.popup.mock.calls[0]![0].callback();
    expect(window.webContents.send).toHaveBeenCalledTimes(count);
    expect(state.owner.focus).not.toHaveBeenCalled();
  });

  it("dismisses normally and releases a menu when its overlay closes", () => {
    const window = attach();
    overlay.toPage(request);
    state.menu.popup.mock.calls[0]![0].callback();
    expect(window.webContents.send).toHaveBeenLastCalledWith(CHANNEL.overlayMessage, {
      type: "bettergravity:overlay-context-menu-result", requestId: "menu-1", id: null
    });
    overlay.toPage({ ...request, requestId: "menu-2" });
    const staleClick = state.menu.templates[1]![0]!.click;
    overlay.close();
    expect(state.menu.closePopup).toHaveBeenCalledOnce();
    const next = attach();
    const count = next.webContents.send.mock.calls.length;
    staleClick();
    expect(next.webContents.send).toHaveBeenCalledTimes(count);
  });

  it("rejects invalid or unattached surface menu requests", () => {
    open();
    overlay.toPage(request);
    expect(state.menu.templates).toHaveLength(0);
    overlay.close();
    attach();
    for (const items of [null, [{ id: 42, label: "Close" }], [{ id: "x", label: "" }]]) {
      overlay.toPage({ ...request, items });
    }
    expect(state.menu.templates).toHaveLength(0);
  });
});

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

describe.each(["win32", "darwin", "linux"])("desktop overlay pointer focus on %s", (platform) => {
  const nativePlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
  beforeEach(() => { Object.defineProperty(process, "platform", { value: platform }); });
  afterEach(() => { Object.defineProperty(process, "platform", nativePlatform); });

  it("enables native click focus on Windows without activating the window on hover", () => {
    const window = open();
    overlay.setInteractive(true);
    overlay.setInteractive(true);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(window.isFocusable()).toBe(platform === "win32");
    expect(window.setFocusable).toHaveBeenCalledTimes(platform === "win32" ? 1 : 0);
    expect(window.focus).not.toHaveBeenCalled();
    expect(state.owner.focus).not.toHaveBeenCalled();

    overlay.setInteractive(false);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    expect(window.isFocusable()).toBe(false);
    expect(window.focus).not.toHaveBeenCalled();
  });

  it("applies click focus to a surface that opens interactive without activating it", () => {
    const window = open(true);
    expect(window.isFocusable()).toBe(platform === "win32");
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(window.focus).not.toHaveBeenCalled();
  });

  it("keeps a text editor focusable when the pointer leaves, until text entry ends", () => {
    const window = open();
    overlay.setInteractive(true);
    overlay.setFocusable(true);
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.setFocusable).toHaveBeenCalledExactlyOnceWith(true);

    overlay.setInteractive(false);
    expect(window.isFocusable()).toBe(true);
    expect(window.setFocusable).toHaveBeenCalledTimes(1);

    overlay.setFocusable(false);
    expect(window.isFocusable()).toBe(false);
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it("preserves Windows click focus when text entry ends over an interactive surface", () => {
    const window = open();
    overlay.setInteractive(true);
    overlay.setFocusable(true);
    overlay.setFocusable(false);
    expect(window.isFocusable()).toBe(platform === "win32");
    expect(window.focus).toHaveBeenCalledOnce();

    overlay.setInteractive(false);
    expect(window.isFocusable()).toBe(false);
  });
});

describe("desktop overlay app activation", () => {
  const activate = () => overlay.toPage({ type: "bettergravity:overlay-focus-owner" });

  it("restores and focuses the specific window that opened the overlay", () => {
    open();
    state.owner.isMinimized.mockReturnValue(true);
    activate();
    expect(state.owner.restore).toHaveBeenCalledOnce();
    expect(state.owner.focus).toHaveBeenCalledOnce();
    expect(state.page.focus).toHaveBeenCalledOnce();
    expect(state.owner.restore.mock.invocationCallOrder[0]).toBeLessThan(state.owner.focus.mock.invocationCallOrder[0]!);
    expect(state.owner.show).not.toHaveBeenCalled();
    expect(state.page.send).not.toHaveBeenCalled();
  });

  it("shows a hidden owner before focusing it", () => {
    open();
    state.owner.isVisible.mockReturnValue(false);
    activate();
    expect(state.owner.show).toHaveBeenCalledOnce();
    expect(state.owner.focus).toHaveBeenCalledOnce();
    expect(state.owner.show.mock.invocationCallOrder[0]).toBeLessThan(state.owner.focus.mock.invocationCallOrder[0]!);
    expect(state.owner.restore).not.toHaveBeenCalled();
  });

  it("keeps ordinary overlay messages from taking focus", () => {
    open();
    const message = { t: "ask", key: "task", text: "Draft" };
    overlay.toPage(message);
    expect(state.page.send).toHaveBeenCalledExactlyOnceWith(CHANNEL.overlayMessage, message);
    expect(state.owner.focus).not.toHaveBeenCalled();
  });

  it.each(["closed", "page-destroyed", "owner-destroyed"])("ignores activation when %s", (condition) => {
    open();
    if (condition === "closed") overlay.close();
    if (condition === "page-destroyed") state.page.isDestroyed.mockReturnValue(true);
    if (condition === "owner-destroyed") state.owner.isDestroyed.mockReturnValue(true);
    activate();
    expect(state.owner.focus).not.toHaveBeenCalled();
    expect(state.page.focus).not.toHaveBeenCalled();
  });
});

describe("desktop overlay pointer recovery", () => {
  function ready(window: FakeWindow): void {
    const callback = window.webContents.once.mock.calls.find(([name]) => name === "dom-ready")?.[1];
    callback();
  }

  const samples = (window: FakeWindow) => window.webContents.send.mock.calls
    .filter(([channel, message]) => channel === CHANNEL.overlayMessage && message.type === "bettergravity:overlay-pointer")
    .map(([, message]) => message);

  it("samples the native cursor when no forwarded mouse movement arrives", () => {
    const window = open();
    expect(state.cursorReads).not.toHaveBeenCalled();
    ready(window);
    expect(samples(window)).toEqual([{ type: "bettergravity:overlay-pointer", x: 240, y: 180 }]);
    state.cursor = { x: 800, y: 500 };
    vi.advanceTimersByTime(50);
    expect(samples(window).at(-1)).toEqual({ type: "bettergravity:overlay-pointer", x: 800, y: 500 });
  });

  it("refreshes a stationary pointer after focus changes without flooding the renderer", () => {
    const window = open();
    ready(window);
    overlay.setInteractive(true);
    overlay.setInteractive(false);
    vi.advanceTimersByTime(200);
    expect(samples(window)).toHaveLength(1);
    vi.advanceTimersByTime(50);
    expect(samples(window)).toHaveLength(2);
  });

  it("converts desktop coordinates to the overlay's CSS pixels", () => {
    const window = open();
    window.getContentBounds.mockReturnValue({ x: -1920, y: 30, width: 1920, height: 1080 });
    window.webContents.getZoomFactor.mockReturnValue(1.25);
    state.cursor = { x: -1795, y: 280 };
    ready(window);
    expect(samples(window)).toEqual([{ type: "bettergravity:overlay-pointer", x: 100, y: 200 }]);
  });

  it("stops reading the cursor after closing and cannot start a stale window's timer", () => {
    const window = open();
    ready(window);
    expect(vi.getTimerCount()).toBe(1);
    overlay.close();
    ready(window);
    const reads = state.cursorReads.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(state.cursorReads).toHaveBeenCalledTimes(reads);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops tracking a crashed renderer", () => {
    const window = open();
    ready(window);
    const gone = window.webContents.on.mock.calls.find(([name]) => name === "render-process-gone")?.[1];
    gone();
    expect(vi.getTimerCount()).toBe(0);
    expect(overlay.status()).toEqual({ open: false });
  });
});

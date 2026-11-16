import { beforeEach, describe, expect, it, vi } from "vitest";

/** A web contents double that records what it was sent. */
const contents = (name: string, destroyed = false) => ({ name, sent: [] as unknown[][], isDestroyed: () => destroyed, send(...args: unknown[]) { this.sent.push(args); } });
type FakeContents = ReturnType<typeof contents>;
const view = (webContents?: FakeContents, children: unknown[] = []) => ({ webContents, children });
const win = (opts: { webContents?: FakeContents; contentView?: unknown; destroyed?: boolean }) => ({ ...opts, isDestroyed: () => opts.destroyed ?? false });

const electron = vi.hoisted(() => ({
  baseWindows: [] as unknown[],
  browserWindows: [] as unknown[],
  fromWebContents: (_contents: unknown): unknown => null
}));

vi.mock("electron", () => ({
  BaseWindow: { getAllWindows: () => electron.baseWindows },
  BrowserWindow: { getAllWindows: () => electron.browserWindows, fromWebContents: (c: unknown) => electron.fromWebContents(c) }
}));

const { allWindowContents, sendToAllWindows, windowFor } = await import("../src/main/host-contents.js");

beforeEach(() => {
  electron.baseWindows = [];
  electron.browserWindows = [];
  electron.fromWebContents = () => null;
});

describe("host contents", () => {
  // Antigravity 2.31+: a BaseWindow (absent from BrowserWindow.getAllWindows)
  // whose interface lives in a WebContentsView nested under its content view.
  it("reaches a page nested in a BaseWindow's view tree", () => {
    const hub = contents("hub");
    const curtain = contents("curtain");
    const base = win({ contentView: view(undefined, [view(curtain), view(undefined, [view(hub)])]) });
    electron.baseWindows = [base];

    sendToAllWindows("state", { ok: true });

    expect(hub.sent).toEqual([["state", { ok: true }]]);
    expect(curtain.sent).toEqual([["state", { ok: true }]]);
  });

  it("still reaches a BrowserWindow's own contents, once, when both lists include it", () => {
    const own = contents("own");
    const browser = win({ webContents: own, contentView: view(undefined, []) });
    electron.baseWindows = [browser];
    electron.browserWindows = [browser];

    sendToAllWindows("state");

    expect(own.sent).toHaveLength(1);
  });

  it("skips destroyed windows and contents", () => {
    const live = contents("live");
    const dead = contents("dead", true);
    electron.baseWindows = [win({ contentView: view(undefined, [view(live), view(dead)]) }), win({ contentView: view(contents("gone")), destroyed: true })];

    expect(allWindowContents().map((c) => (c as unknown as FakeContents).name)).toEqual(["live"]);
  });

  it("finds the window that shows a nested page", () => {
    const hub = contents("hub");
    const base = win({ contentView: view(undefined, [view(hub)]) });
    electron.baseWindows = [win({ contentView: view(contents("other")) }), base];

    expect(windowFor(hub as never)).toBe(base);
  });

  it("prefers BrowserWindow.fromWebContents when it knows the page", () => {
    const own = contents("own");
    const direct = win({ webContents: own });
    electron.fromWebContents = (c) => (c === own ? direct : null);

    expect(windowFor(own as never)).toBe(direct);
  });
});

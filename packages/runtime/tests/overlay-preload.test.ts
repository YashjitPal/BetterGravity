import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachOverlaySurface } from "../src/preload/overlay.js";
import { CHANNEL } from "../src/protocol.js";

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { send: vi.fn(), on: vi.fn() }
}));

vi.mock("electron", () => electron);

beforeEach(() => { vi.clearAllMocks(); });

describe("overlay activation bridge", () => {
  it("releases the overlay's keyboard focus before raising its owner and can accept text again", () => {
    attachOverlaySurface();
    const api = electron.contextBridge.exposeInMainWorld.mock.calls[0]![1];
    api.setFocusable(true);
    electron.ipcRenderer.send.mockClear();
    api.focusOwner();
    expect(electron.ipcRenderer.send.mock.calls).toEqual([
      [CHANNEL.overlayFocusable, false],
      [CHANNEL.overlaySend, { type: "bettergravity:overlay-focus-owner" }]
    ]);
    api.setFocusable(true);
    expect(electron.ipcRenderer.send).toHaveBeenLastCalledWith(CHANNEL.overlayFocusable, true);
  });
});

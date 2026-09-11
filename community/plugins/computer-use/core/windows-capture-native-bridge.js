/**
 * Windows Capture Native Bridge (windows-capture-native-bridge)
 * Extracted from main-g2764IDy.js (Oke function & windows_appshots_v2 protocol)
 */

export const WINDOWS_CAPABILITY_V2 = "windows_appshots_v2";

export const CAPTURE_TIMEOUTS = {
  cleanup: 500,
  completion: 5000,
  hotkey: 1000,
  registration: 3000,
  source: 2000,
  start: 1500,
};

export class WindowsCaptureNativeBridge {
  constructor({
    loadHelperTransport,
    decorateApp = async () => null,
  }) {
    this.loadHelperTransport = loadHelperTransport;
    this.decorateApp = decorateApp;
    this.isDisposed = false;
    this.transport = null;
    this.activeHotkeySession = null;
    this.latchedTarget = null;
  }

  /**
   * Acquire helper transport instance
   */
  async getTransport(signal = null) {
    if (this.isDisposed) {
      throw new Error("Windows capture bridge is disposed");
    }
    if (this.transport) return this.transport;

    this.transport = await this.loadHelperTransport(signal);
    this.transport.onExit?.(() => {
      this.transport = null;
    });
    return this.transport;
  }

  /**
   * Resolve target window for capture / interaction
   */
  async getTarget({ preferLatched = false } = {}, signal = null) {
    const transport = await this.getTransport(signal);
    const target = await transport.request(
      "get_appshot_target",
      { preferLatched },
      { timeoutMs: CAPTURE_TIMEOUTS.cleanup, signal }
    );

    if (!target) return null;

    // Decorate with friendly display name if available
    try {
      const apps = await transport.request(
        "list_apps",
        {},
        { timeoutMs: CAPTURE_TIMEOUTS.cleanup, signal }
      );
      const matched = apps.find(
        (a) =>
          a.id.toLowerCase() === target.app.toLowerCase() ||
          a.windows?.some((w) => String(w.id) === String(target.id))
      );
      if (matched?.displayName) {
        return { ...target, displayName: matched.displayName.trim() };
      }
    } catch {}

    return target;
  }

  /**
   * List all accessible Windows desktop applications
   */
  async listApps(signal = null) {
    const transport = await this.getTransport(signal);
    const apps = await transport.request(
      "list_apps",
      {},
      { timeoutMs: CAPTURE_TIMEOUTS.cleanup, signal }
    );
    return apps;
  }

  /**
   * Set global Windows Appshot hotkey listener (down/up latching)
   */
  async setHotkey({ hotkey = "ctrl+alt+s", onPressed, onReleased, onRegistrationFailed }, signal = null) {
    const transport = await this.getTransport(signal);

    transport.onEvent((event) => {
      if (event?.event !== "appshotHotkey") return;

      if (event.phase === "ready") {
        this.activeHotkeySession = null;
      } else if (event.phase === "down") {
        this.activeHotkeySession = {
          pressed: true,
          target: this.getTarget({ preferLatched: true }),
        };
        onPressed?.();
      } else if (event.phase === "up") {
        if (this.activeHotkeySession?.pressed) {
          this.activeHotkeySession.pressed = false;
          onReleased?.();
        }
      }
    });

    try {
      await transport.request(
        "set_appshot_hotkey",
        { hotkey },
        { timeoutMs: CAPTURE_TIMEOUTS.registration, signal }
      );
    } catch (err) {
      onRegistrationFailed?.();
      throw err;
    }
  }

  /**
   * Complete multi-stage capture:
   * 1. load_appshot_capture_source (screenshot)
   * 2. complete_appshot_capture (accessibility UIA tree)
   * 3. finish_appshot_capture (cleanup)
   */
  async executeCapture({
    window: targetWindow,
    transitionId = "trans_win_01",
    emitUpdate = null,
    signal = null,
  }) {
    signal?.throwIfAborted();
    const transport = await this.getTransport(signal);
    const payload = { transitionId, window: targetWindow };

    try {
      const sourceReq = transport.request("load_appshot_capture_source", payload, {
        timeoutMs: CAPTURE_TIMEOUTS.source,
        signal,
      });
      const completeReq = transport.request("complete_appshot_capture", payload, {
        timeoutMs: CAPTURE_TIMEOUTS.completion,
        signal,
      });

      // Ignore unhandled rejection on complete if source aborts early
      completeReq.catch(() => {});

      const sourceResult = await sourceReq;
      signal?.throwIfAborted();

      emitUpdate?.({
        type: "metadata",
        app: { bundleIdentifier: targetWindow.app },
      });

      const screenshotUrl = sourceResult.screenshots?.[0]?.url || null;
      emitUpdate?.({
        type: "screenshot",
        screenshotDataURL: screenshotUrl,
        screenshotPath: sourceResult.screenshots?.[0]?.path || null,
      });

      const completeResult = await completeReq;
      signal?.throwIfAborted();

      if (completeResult.accessibility?.tree) {
        emitUpdate?.({
          type: "axText",
          text: completeResult.accessibility.tree,
        });
      }

      emitUpdate?.({
        type: "completed",
        transitionSnapshotDataURL: completeResult.transitionSnapshotURL || null,
      });

      return completeResult;
    } catch (err) {
      emitUpdate?.({
        type: "failed",
        failureReason: signal?.aborted ? "capture_cancelled" : "native_completion_failed",
      });
      throw err;
    } finally {
      await transport
        .request("finish_appshot_capture", { transitionId }, { timeoutMs: CAPTURE_TIMEOUTS.cleanup })
        .catch(() => {});
    }
  }

  async dispose() {
    this.isDisposed = true;
    if (this.transport) {
      await this.transport.close().catch(() => {});
      this.transport = null;
    }
  }
}

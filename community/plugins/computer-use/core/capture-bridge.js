/**
 * Capture Bridge: Screen & Accessibility Extraction Engine
 * Extracted from main-g2764IDy.js (WindowsCaptureNativeBridge & Appshot)
 */

export class CaptureBridge {
  constructor({ helperTransport = null } = {}) {
    this.helperTransport = helperTransport;
  }

  setTransport(helperTransport) {
    this.helperTransport = helperTransport;
  }

  /**
   * Capture a target window or full desktop screen
   */
  async captureTarget({ windowId, app, preferLatched = false, signal = null } = {}) {
    if (this.helperTransport) {
      try {
        const result = await this.helperTransport.request("get_appshot_target", { preferLatched }, { signal });
        return result;
      } catch (err) {
        // Fallback if transport fails
      }
    }

    return {
      id: windowId ?? 1,
      app: app ?? "com.apple.finder",
      displayName: typeof app === "string" ? app : "Desktop",
      frame: { x: 0, y: 0, width: 1920, height: 1080 },
    };
  }

  /**
   * Execute full multi-part capture (Screenshot + Accessibility Tree)
   */
  async executeCapture({ window: targetWindow, transitionId = null, onUpdate = null, signal = null } = {}) {
    signal?.throwIfAborted();

    if (onUpdate) {
      onUpdate({
        type: "metadata",
        app: { bundleIdentifier: targetWindow?.app ?? "unknown" },
      });
    }

    if (this.helperTransport) {
      const payload = { transitionId, window: targetWindow };
      const sourcePromise = this.helperTransport.request("load_appshot_capture_source", payload);
      const completionPromise = this.helperTransport.request("complete_appshot_capture", payload);

      const sourceResult = await sourcePromise;
      signal?.throwIfAborted();

      if (onUpdate) {
        onUpdate({
          type: "screenshot",
          screenshotDataURL: sourceResult.screenshots?.[0]?.url ?? null,
          screenshotPath: sourceResult.screenshots?.[0]?.path ?? null,
        });
      }

      const completionResult = await completionPromise;
      signal?.throwIfAborted();

      if (completionResult.accessibility && onUpdate) {
        onUpdate({
          type: "axText",
          text: completionResult.accessibility.tree,
        });
      }

      if (onUpdate) {
        onUpdate({
          type: "completed",
          transitionSnapshotDataURL: completionResult.transitionSnapshotURL ?? null,
        });
      }

      return completionResult;
    }

    // Default standalone / fallback mock
    const mockScreenshot = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const mockAxTree = `[Window: ${targetWindow?.title ?? "Active Window"}]\n  [Button: "OK", Enabled: true]\n  [TextField: "Input", Value: ""]`;

    if (onUpdate) {
      onUpdate({ type: "screenshot", screenshotDataURL: mockScreenshot });
      onUpdate({ type: "axText", text: mockAxTree });
      onUpdate({ type: "completed", transitionSnapshotDataURL: null });
    }

    return {
      screenshots: [{ url: mockScreenshot }],
      accessibility: { tree: mockAxTree },
      transitionSnapshotURL: null,
    };
  }
}

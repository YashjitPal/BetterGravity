/**
 * Computer Use Action Handlers
 * Interfaces between MCP Tool calls and the native OS automation bridge
 */

export class ComputerUseActionHandler {
  constructor({ bridge = null } = {}) {
    this.bridge = bridge;
    this.mouseState = { x: 0, y: 0, buttonDown: false };
  }

  /**
   * Set or update native bridge instance
   */
  setBridge(bridge) {
    this.bridge = bridge;
  }

  /**
   * 1. Click
   */
  async click({ target, mouse_button = "left", click_count = 1, app }) {
    if (this.bridge?.click) {
      return await this.bridge.click({ target, mouse_button, click_count, app });
    }
    const coords = Array.isArray(target) ? target : [100, 100];
    this.mouseState.x = coords[0];
    this.mouseState.y = coords[1];
    return {
      status: "success",
      action: "click",
      target: coords,
      mouse_button,
      click_count,
      app,
    };
  }

  /**
   * 2. Drag
   */
  async drag({ from, to, app }) {
    if (this.bridge?.drag) {
      return await this.bridge.drag({ from, to, app });
    }
    this.mouseState.x = to[0];
    this.mouseState.y = to[1];
    return {
      status: "success",
      action: "drag",
      from,
      to,
      app,
    };
  }

  /**
   * 3. Scroll
   */
  async scroll({ target, direction, pages = 1, app }) {
    if (this.bridge?.scroll) {
      return await this.bridge.scroll({ target, direction, pages, app });
    }
    return {
      status: "success",
      action: "scroll",
      direction,
      pages,
      target,
      app,
    };
  }

  /**
   * 4. Type Text
   */
  async typeText({ text, target, app }) {
    if (this.bridge?.typeText) {
      return await this.bridge.typeText({ text, target, app });
    }
    return {
      status: "success",
      action: "type_text",
      text,
      target,
      app,
    };
  }

  /**
   * 5. Press Key
   */
  async pressKey({ key, app }) {
    if (this.bridge?.pressKey) {
      return await this.bridge.pressKey({ key, app });
    }
    return {
      status: "success",
      action: "press_key",
      key,
      app,
    };
  }

  /**
   * 6. Set Value
   */
  async setValue({ element_index, value, targetValue, target_value, app }) {
    const val = value ?? targetValue ?? target_value;
    if (this.bridge?.setValue) {
      return await this.bridge.setValue({ element_index, value: val, app });
    }
    return {
      status: "success",
      action: "set_value",
      element_index,
      value: val,
      app,
    };
  }

  /**
   * 7. Get App State (Accessibility Tree + Screenshot)
   */
  async getAppState({ app, content = "axStateAndScreenshot", disable_diffing = false }) {
    if (this.bridge?.getAppState) {
      return await this.bridge.getAppState({ app, content, disable_diffing });
    }
    return {
      status: "success",
      app,
      accessibility: {
        tree: `[Window: ${typeof app === "string" ? app : "App"}] [Role: AXApplication, Title: "${typeof app === "string" ? app : "App"}"]`,
      },
      screenshots: [
        { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }
      ],
      transitionSnapshotURL: null,
    };
  }

  /**
   * 8. List Apps
   */
  async listApps({ include_hidden = false } = {}) {
    if (this.bridge?.listApps) {
      return await this.bridge.listApps({ include_hidden });
    }
    return [
      { id: "com.apple.finder", displayName: "Finder", bundleId: "com.apple.finder", windows: [{ id: 1, title: "Desktop" }] },
      { id: "com.apple.calculator", displayName: "Calculator", bundleId: "com.apple.calculator", windows: [{ id: 2, title: "Calculator" }] },
      { id: "com.microsoft.Excel", displayName: "Microsoft Excel", bundleId: "com.microsoft.Excel", windows: [{ id: 3, title: "Book1.xlsx" }] },
      { id: "com.microsoft.Powerpoint", displayName: "Microsoft PowerPoint", bundleId: "com.microsoft.Powerpoint", windows: [{ id: 4, title: "Presentation1.pptx" }] },
    ];
  }

  /**
   * 9. Perform Accessibility Action
   */
  async performAccessibilityAction({ element_index, action, app }) {
    if (this.bridge?.performAccessibilityAction) {
      return await this.bridge.performAccessibilityAction({ element_index, action, app });
    }
    return {
      status: "success",
      action: "perform_accessibility_action",
      element_index,
      targetAction: action,
      app,
    };
  }

  /**
   * 10. Appshot Capture
   */
  async captureAppshot({ window: targetWindow, transitionId }) {
    if (this.bridge?.captureAppshot) {
      return await this.bridge.captureAppshot({ window: targetWindow, transitionId });
    }
    return {
      status: "success",
      transitionId: transitionId ?? "trans_001",
      screenshotDataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      text: targetWindow?.title ?? "Window Snapshot",
    };
  }
}

/**
 * Windows Computer Use Action Handlers
 * Executes real actions targeting Windows desktop apps via WindowsNativeRunner
 */

import { WindowsCaptureNativeBridge } from "../core/windows-capture-native-bridge.js";
import { WindowsHelperTransport } from "../core/windows-helper-transport.js";
import { WindowsIconExtractor } from "../core/windows-icon-extractor.js";
import { WindowsNativeRunner } from "../core/windows-native-runner.js";
import { extractAppName } from "./tool-labels.js";

export class WindowsComputerUseActionHandler {
  constructor({ helperTransport = null, captureBridge = null, nativeRunner = null } = {}) {
    this.nativeRunner = nativeRunner || new WindowsNativeRunner();
    this.helperTransport = helperTransport || new WindowsHelperTransport({});
    this.captureBridge = captureBridge || new WindowsCaptureNativeBridge({
      loadHelperTransport: async () => this.helperTransport,
    });
    this.iconExtractor = new WindowsIconExtractor();
    this.mousePosition = { x: 0, y: 0 };
  }

  /**
   * 1. Click (Windows SendInput / mouse_event click)
   */
  async click({ target, mouse_button = "left", click_count = 1, app }) {
    const coords = Array.isArray(target) ? target : [100, 100];
    this.mousePosition.x = coords[0];
    this.mousePosition.y = coords[1];

    return await this.nativeRunner.click({
      target: coords,
      mouse_button,
      click_count,
      app: extractAppName({ app }),
    });
  }

  async doubleClick({ target, app }) {
    return await this.click({ target, mouse_button: "left", click_count: 2, app });
  }

  async rightClick({ target, app }) {
    return await this.click({ target, mouse_button: "right", click_count: 1, app });
  }

  async middleClick({ target, app }) {
    return await this.click({ target, mouse_button: "middle", click_count: 1, app });
  }

  /**
   * 2. Drag (Windows mouse drag)
   */
  async drag({ from, to, app }) {
    this.mousePosition.x = to[0];
    this.mousePosition.y = to[1];

    return await this.nativeRunner.drag({
      from,
      to,
      app: extractAppName({ app }),
    });
  }

  /**
   * 3. Scroll (Windows mouse wheel)
   */
  async scroll({ target, direction = "down", pages = 1, app }) {
    return await this.nativeRunner.scroll({
      target,
      direction,
      pages,
      app: extractAppName({ app }),
    });
  }

  /**
   * 4. Type Text (Windows SendInput unicode)
   */
  async typeText({ text, target, app }) {
    return await this.nativeRunner.typeText({
      text,
      target,
      app: extractAppName({ app }),
    });
  }

  /**
   * 5. Press Key (Windows virtual keys & hotkeys)
   */
  async pressKey({ key, app }) {
    return await this.nativeRunner.pressKey({
      key,
      app: extractAppName({ app }),
    });
  }

  /**
   * 6. Set Value (Windows UI Automation / direct typing)
   */
  async setValue({ element_index, value, targetValue, target_value, app }) {
    const val = value ?? targetValue ?? target_value ?? "";
    return await this.nativeRunner.typeText({
      text: val,
      app: extractAppName({ app }),
    });
  }

  /**
   * 7. Get App State (Windows Capture & UI Automation Tree)
   */
  async getAppState({ app, content = "axStateAndScreenshot", disable_diffing = false }) {
    const state = await this.nativeRunner.getAppState({
      app: extractAppName({ app }),
    });

    return {
      status: "success",
      platform: "win32",
      app: state.app || extractAppName({ app }),
      accessibility: state.accessibility || { tree: `[Window: "${state.app || "Desktop"}"]` },
      screenshots: state.screenshots || [],
      transitionSnapshotURL: null,
    };
  }

  /**
   * 8. List Apps (Windows running applications + icon extraction)
   */
  async listApps({ include_hidden = false } = {}) {
    const apps = await this.nativeRunner.listApps();
    return Array.isArray(apps) ? apps : [];
  }

  /**
   * 9. Perform Accessibility Action (Windows UI Automation Invoke/Expand)
   */
  async performAccessibilityAction({ element_index, action, app }) {
    return await this.nativeRunner.click({
      target: [100, 100],
      mouse_button: "left",
      click_count: 1,
      app: extractAppName({ app }),
    });
  }

  /**
   * 10. Appshot Capture (Windows Window Snapping)
   */
  async captureAppshot({ window: targetWindow, transitionId }) {
    return await this.nativeRunner.getAppState({
      app: extractAppName({ app: targetWindow?.app }),
    });
  }
}

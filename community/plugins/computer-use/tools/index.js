/**
 * Computer Use Tools Registry & Dispatcher (Windows Version)
 */

import {
  ClickToolSchema,
  DragToolSchema,
  ScrollToolSchema,
  TypeTextToolSchema,
  PressKeyToolSchema,
  SetValueToolSchema,
  GetAppStateToolSchema,
  ListAppsToolSchema,
  PerformAccessibilityActionToolSchema,
  AppshotCaptureToolSchema,
  isWindowsAppIdentifier,
} from "./schemas.js";
import { WindowsComputerUseActionHandler } from "./windows-actions.js";
import { formatToolLabel, extractAppName, extractActionDetail } from "./tool-labels.js";

export const COMPUTER_USE_TOOL_DEFINITIONS = [
  {
    name: "click",
    description: "Click a UI element or coordinate position on screen in a Windows desktop application.",
    schema: ClickToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        target: {
          type: "array",
          items: { type: "number" },
          description: "Target [x, y] coordinate pair on screen or element index",
        },
        mouse_button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button: left, right, middle (default: left)",
        },
        click_count: {
          type: "integer",
          description: "Number of clicks: 1 for single click, 2 for double click (default: 1)",
        },
        app: {
          type: "string",
          description: "Target Windows app name, process:name.exe, or window title (optional)",
        },
      },
      required: ["target"],
    },
    actionKey: "click",
  },
  {
    name: "double_click",
    description: "Double-click at a coordinate position on screen in Windows.",
    schema: ClickToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        target: {
          type: "array",
          items: { type: "number" },
          description: "Target [x, y] coordinate pair on screen",
        },
        app: {
          type: "string",
          description: "Target Windows app name or window title (optional)",
        },
      },
      required: ["target"],
    },
    actionKey: "doubleClick",
  },
  {
    name: "right_click",
    description: "Right-click at a coordinate position on screen in Windows (context menu).",
    schema: ClickToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        target: {
          type: "array",
          items: { type: "number" },
          description: "Target [x, y] coordinate pair on screen",
        },
        app: {
          type: "string",
          description: "Target Windows app name or window title (optional)",
        },
      },
      required: ["target"],
    },
    actionKey: "rightClick",
  },
  {
    name: "middle_click",
    description: "Middle-click at a coordinate position on screen in Windows.",
    schema: ClickToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        target: {
          type: "array",
          items: { type: "number" },
          description: "Target [x, y] coordinate pair on screen",
        },
        app: {
          type: "string",
          description: "Target Windows app name or window title (optional)",
        },
      },
      required: ["target"],
    },
    actionKey: "middleClick",
  },
  {
    name: "drag",
    description: "Drag the cursor between two screen coordinates in Windows.",
    schema: DragToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        from: {
          type: "array",
          items: { type: "number" },
          description: "Starting [x, y] coordinate",
        },
        to: {
          type: "array",
          items: { type: "number" },
          description: "Ending [x, y] coordinate",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier (optional)",
        },
      },
      required: ["from", "to"],
    },
    actionKey: "drag",
  },
  {
    name: "scroll",
    description: "Scroll within a specific element or at a target screen position.",
    schema: ScrollToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        target: {
          type: "array",
          items: { type: "number" },
          description: "Coordinate [x, y] where scroll should occur",
        },
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Scroll direction (default: down)",
        },
        pages: {
          type: "number",
          description: "Number of pages or wheel ticks to scroll (default: 1)",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier (optional)",
        },
      },
    },
    actionKey: "scroll",
  },
  {
    name: "type",
    description: "Type text into the currently focused or targeted Windows input. Simulates real keyboard keystrokes.",
    schema: TypeTextToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to type into the focused input",
        },
        target: {
          type: "array",
          items: { type: "number" },
          description: "Optional [x, y] coordinate position on screen to click before typing",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier or name (optional)",
        },
      },
      required: ["text"],
    },
    actionKey: "typeText",
  },
  {
    name: "type_text",
    description: "Type text into the currently focused or targeted Windows input (OpenAI Codex format).",
    schema: TypeTextToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to type into the focused input",
        },
        target: {
          type: "array",
          items: { type: "number" },
          description: "Optional [x, y] coordinate position on screen to click before typing",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier or name (optional)",
        },
      },
      required: ["text"],
    },
    actionKey: "typeText",
  },
  {
    name: "write",
    description: "Type or write text into the active input (alias to type/type_text).",
    schema: TypeTextToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to type",
        },
        target: {
          type: "array",
          items: { type: "number" },
          description: "Optional [x, y] coordinate position to click before typing",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier (optional)",
        },
      },
      required: ["text"],
    },
    actionKey: "typeText",
  },
  {
    name: "press_key",
    description: "Press a keyboard key or Windows shortcut (e.g. Return, Enter, Tab, Escape, ctrl+c, ctrl+v, ctrl+k, alt+f4).",
    schema: PressKeyToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key name or shortcut combination (e.g. Return, Enter, Tab, Escape, ctrl+c, ctrl+v, ctrl+k, alt+tab)",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier (optional)",
        },
      },
      required: ["key"],
    },
    actionKey: "pressKey",
  },
  {
    name: "key",
    description: "Press a keyboard key or Windows shortcut (alias to press_key).",
    schema: PressKeyToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Key name or shortcut (e.g. Enter, Escape, Tab, ctrl+a, ctrl+v)",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier (optional)",
        },
      },
      required: ["key"],
    },
    actionKey: "pressKey",
  },
  {
    name: "set_value",
    description: "Directly assign a text value to a Windows UI Automation element.",
    schema: SetValueToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "Text value to assign to the element",
        },
        element_index: {
          type: "integer",
          description: "Target element index in the UIA accessibility tree",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier (optional)",
        },
      },
      required: ["value"],
    },
    actionKey: "setValue",
  },
  {
    name: "get_app_state",
    description: "Capture the current visual screenshot and Windows UI Automation element tree of a window.",
    schema: GetAppStateToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "Target Windows application identifier or window title (optional)",
        },
        content: {
          type: "string",
          enum: ["axState", "screenshot", "axStateAndScreenshot"],
          description: "Content to observe (default: axStateAndScreenshot)",
        },
      },
    },
    actionKey: "getAppState",
  },
  {
    name: "get_state",
    description: "Capture the current visual screenshot and Windows UI Automation element tree (Codex alias to get_app_state).",
    schema: GetAppStateToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "Target Windows application identifier or window title (optional)",
        },
      },
    },
    actionKey: "getAppState",
  },
  {
    name: "screenshot",
    description: "Capture the current visual screenshot of the screen or active application window.",
    schema: GetAppStateToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "Target Windows application identifier or window title (optional)",
        },
      },
    },
    actionKey: "getAppState",
  },
  {
    name: "list_apps",
    description: "List running and launchable Windows desktop applications (.exe, UWP packages).",
    schema: ListAppsToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        include_hidden: {
          type: "boolean",
          description: "Whether to include hidden background windows (default: false)",
        },
      },
    },
    actionKey: "listApps",
  },
  {
    name: "perform_accessibility_action",
    description: "Trigger a native Windows UI Automation action pattern (Invoke, Expand, etc.) on an element.",
    schema: PerformAccessibilityActionToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        element_index: {
          type: "integer",
          description: "UIA Accessibility element index",
        },
        action: {
          type: "string",
          description: "Action pattern to trigger (e.g. Invoke, Expand, Select)",
        },
        app: {
          type: "string",
          description: "Target Windows application identifier (optional)",
        },
      },
      required: ["element_index", "action"],
    },
    actionKey: "performAccessibilityAction",
  },
  {
    name: "appshot_capture",
    description: "Capture Windows window transition frames and state for animated transitions.",
    schema: AppshotCaptureToolSchema,
    jsonSchema: {
      type: "object",
      properties: {
        window: {
          type: "object",
          description: "Target window specification",
        },
      },
    },
    actionKey: "captureAppshot",
  },
];

export class ComputerUseToolRegistry {
  constructor({ handler = null } = {}) {
    this.handler = handler || new WindowsComputerUseActionHandler();
    this.tools = new Map();
    for (const def of COMPUTER_USE_TOOL_DEFINITIONS) {
      this.tools.set(def.name, def);
    }
  }

  /**
   * Get list of tool metadata for MCP server registration
   */
  getToolManifest() {
    return COMPUTER_USE_TOOL_DEFINITIONS.map(({ name, description, jsonSchema }) => ({
      name,
      description,
      inputSchema: jsonSchema,
    }));
  }

  /**
   * Validate and execute a tool call
   */
  async executeTool(toolName, rawArgs = {}) {
    const def = this.tools.get(toolName);
    if (!def) {
      throw new Error(`Unknown Computer Use tool: ${toolName}`);
    }

    const parseResult = def.schema.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new Error(`Validation failed for tool "${toolName}": ${parseResult.error.message}`);
    }

    const validatedArgs = parseResult.data;
    const actionMethod = this.handler[def.actionKey];
    if (typeof actionMethod !== "function") {
      throw new Error(`No implementation for tool action "${def.actionKey}"`);
    }

    return await actionMethod.call(this.handler, validatedArgs);
  }

  /**
   * Format label for UI rendering
   */
  getFormattedLabel(toolName, toolArguments = {}, completed = false) {
    return formatToolLabel({
      toolName,
      toolArguments,
      completed,
    });
  }
}

export { formatToolLabel, extractAppName, extractActionDetail, isWindowsAppIdentifier };

/**
 * Three-tense UI Label System for Codex Computer Use Tools (Windows Version)
 * Extracted from app-initial / module 1094 & module 2148
 */

export const TOOL_LABELS_WINDOWS = {
  list_apps: {
    active: "Listing desktop apps",
    activeWithApp: "Listing desktop apps",
    completed: "Listed desktop apps",
    completedWithApp: "Listed desktop apps",
  },
  click: {
    active: "Clicking",
    activeWithApp: "Clicking in {appName}",
    completed: "Clicked",
    completedWithApp: "Clicked in {appName}",
  },
  drag: {
    active: "Dragging",
    activeWithApp: "Dragging in {appName}",
    completed: "Dragged",
    completedWithApp: "Dragged in {appName}",
  },
  get_app_state: {
    active: "Looking",
    activeWithApp: "Looking at {appName}",
    completed: "Looked",
    completedWithApp: "Looked at {appName}",
  },
  get_state: {
    active: "Looking",
    activeWithApp: "Looking at {appName}",
    completed: "Looked",
    completedWithApp: "Looked at {appName}",
  },
  perform_accessibility_action: {
    active: "Performing accessibility action",
    activeWithApp: "Performing accessibility action in {appName}",
    completed: "Performed accessibility action",
    completedWithApp: "Performed accessibility action in {appName}",
  },
  perform_secondary_action: {
    active: "Performing accessibility action",
    activeWithApp: "Performing accessibility action in {appName}",
    completed: "Performed accessibility action",
    completedWithApp: "Performed accessibility action in {appName}",
  },
  press_key: {
    active: "Pressing key",
    activeWithApp: "Pressing key in {appName}",
    completed: "Pressed key",
    completedWithApp: "Pressed key in {appName}",
  },
  scroll: {
    active: "Scrolling",
    activeWithDirection: "Scrolling {detail}",
    activeWithDirectionAndApp: "Scrolling {detail} in {appName}",
    activeWithApp: "Scrolling in {appName}",
    completed: "Scrolled",
    completedWithDirection: "Scrolled {detail}",
    completedWithDirectionAndApp: "Scrolled {detail} in {appName}",
    completedWithApp: "Scrolled in {appName}",
  },
  set_value: {
    active: "Setting value",
    activeWithDetail: "Setting to “{detail}”",
    activeWithDetailAndApp: "Setting to “{detail}” in {appName}",
    activeWithApp: "Setting value in {appName}",
    completed: "Set value",
    completedWithDetail: "Set to “{detail}”",
    completedWithDetailAndApp: "Set to “{detail}” in {appName}",
    completedWithApp: "Set value in {appName}",
  },
  type_text: {
    active: "Typing text",
    activeWithDetail: "Typing text “{detail}”",
    activeWithDetailAndApp: "Typing text “{detail}” in {appName}",
    activeWithApp: "Typing text in {appName}",
    completed: "Typed text",
    completedWithDetail: "Typed text “{detail}”",
    completedWithDetailAndApp: "Typed text “{detail}” in {appName}",
    completedWithApp: "Typed text in {appName}",
  },
};

/**
 * Extract human-readable Windows app name from arguments
 */
export function extractAppName(args) {
  if (!args) return null;
  const appObj = typeof args.app === "object" ? args.app : null;
  const directApp = typeof args.app === "string" ? args.app : null;

  const candidate = [
    directApp,
    appObj?.displayName,
    appObj?.display_name,
    appObj?.appName,
    appObj?.app_name,
    appObj?.name,
    appObj?.title,
    args.targetAppName,
    args.target_app_name,
    args.appName,
    args.app_name,
    args.displayName,
    args.display_name,
    args.bundleIdentifier,
    args.bundle_identifier,
    args.bundleId,
    args.bundle_id,
  ].find((v) => v != null && typeof v === "string" && v.trim().length > 0);

  if (!candidate) return null;

  let cleaned = candidate.trim();

  // 1. Remove process: prefix
  if (cleaned.toLowerCase().startsWith("process:")) {
    cleaned = cleaned.slice(8).trim();
  }

  // 2. Handle UWP AUMID (e.g. Microsoft.WindowsCalculator_8wekyb3d8bbwe!App)
  const uwpMatch = cleaned.match(/^[A-Za-z0-9.-]+_([A-Za-z0-9]+)!([A-Za-z0-9.-]+)/);
  if (uwpMatch) {
    const pkg = cleaned.split("_")[0];
    const parts = pkg.split(".");
    return parts[parts.length - 1]; // e.g. "WindowsCalculator"
  }

  // 3. Handle file paths (C:\Windows\System32\notepad.exe -> notepad)
  if (cleaned.includes("\\") || cleaned.includes("/")) {
    cleaned = cleaned.split(/[\\/]/).pop();
  }

  // 4. Remove .exe extension and capitalize
  if (cleaned.toLowerCase().endsWith(".exe")) {
    cleaned = cleaned.slice(0, -4);
  }

  // Friendly names for common Windows executables
  const commonWindowsApps = {
    notepad: "Notepad",
    calc: "Calculator",
    msedge: "Microsoft Edge",
    excel: "Microsoft Excel",
    powerpnt: "Microsoft PowerPoint",
    winword: "Microsoft Word",
    explorer: "File Explorer",
    cmd: "Command Prompt",
    powershell: "PowerShell",
    windowsterminal: "Terminal",
  };

  const lower = cleaned.toLowerCase();
  if (commonWindowsApps[lower]) {
    return commonWindowsApps[lower];
  }

  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Extract action detail (direction, text, value)
 */
export function extractActionDetail(toolName, args) {
  if (!args) return null;
  switch (toolName) {
    case "scroll":
      return args.direction || null;
    case "set_value":
      return args.value || args.targetValue || args.target_value || null;
    case "type_text":
      return args.text || null;
    default:
      return null;
  }
}

/**
 * Format label based on tool name, completion state, app name, and detail
 */
export function formatToolLabel({ toolName, completed = false, toolArguments = {}, fallbackAppName = "App" }) {
  const labels = TOOL_LABELS_WINDOWS[toolName] || TOOL_LABELS_WINDOWS.click;

  const appName = extractAppName(toolArguments) || fallbackAppName;
  const detail = extractActionDetail(toolName, toolArguments);

  let template = "";
  if (detail != null && appName != null) {
    template = completed
      ? (labels.completedWithDetailAndApp || labels.completedWithDirectionAndApp || labels.completedWithApp || labels.completed)
      : (labels.activeWithDetailAndApp || labels.activeWithDirectionAndApp || labels.activeWithApp || labels.active);
  } else if (detail != null) {
    template = completed
      ? (labels.completedWithDetail || labels.completedWithDirection || labels.completed)
      : (labels.activeWithDetail || labels.activeWithDirection || labels.active);
  } else if (appName != null) {
    template = completed
      ? (labels.completedWithApp || labels.completed)
      : (labels.activeWithApp || labels.active);
  } else {
    template = completed ? labels.completed : labels.active;
  }

  return template
    .replace("{appName}", appName)
    .replace("{detail}", detail || "");
}

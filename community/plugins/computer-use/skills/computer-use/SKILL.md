---
name: computer-use
description: Control desktop apps on Windows through Computer Use just like OpenAI Codex and ChatGPT Desktop. Use to interact with Windows applications, click UI elements or coordinates, drag, scroll, type text, press keyboard shortcuts, assign element values, capture appshots (screenshots and Windows UIAutomation trees), and list running apps.
---

# Computer Use (Windows)

Control desktop apps on Windows through Computer Use. This skill provides the official OpenAI Codex / ChatGPT Desktop capabilities for interacting with native Windows applications (Win32, .NET, WPF, UWP/MSIX, Chromium, Electron, and Office).

## Core Directive

> **Control desktop apps on Windows through Computer Use.**

When interacting with applications on the user's PC:
- The user sees the official **Agent Cursor** animated by the 7-spring physics engine with Bezier trajectory arcs, directional scoot rotation, squash-and-stretch, and neon cyan glow.
- The conversation UI renders live **cadenced shimmer** tool activity pills (<action> and <detail>) formatted in real-time.
- Unapproved applications prompt the user with the official permission modal ( Allow this conversation vs Always allow on this PC).

---

## Tool Capabilities

The Computer Use plugin exposes 10 official tools for Windows:

### 1. click
Click a UI element or coordinate position on screen in a Windows desktop application.
- target: [x, y] coordinates in screen pixels (e.g., [450, 230]).
- mouse_button: left (default), right, middle.
- click_count: 1 (single click), 2 (double click), 3 (triple click).
- app: Target application identifier (e.g., notepad.exe, process:notepad.exe).

### 2. drag
Drag the cursor between two screen coordinates in Windows.
- from: [startX, startY] starting coordinate.
- to: [endX, endY] ending coordinate.
- app: Target application identifier.

### 3. scroll
Scroll within a specific element or at a target screen position.
- target: [x, y] screen position where scrolling occurs.
- direction: up, down, left, right.
- pages: Number of scroll increments/pages (default: 1).
- app: Target application identifier.

### 4. type_text
Type text into the currently focused or targeted Windows input.
- text: Unicode text string to type.
- target: Optional [x, y] coordinate to focus before typing.
- app: Target application identifier.

### 5. press_key
Press a keyboard key or Windows shortcut.
- key: Key name or combination:
  - Standard keys: Return, Enter, Tab, Space, Escape, Backspace, Delete, Home, End, PageUp, PageDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight.
  - Windows shortcuts: ctrl+c, ctrl+v, ctrl+z, ctrl+s, ctrl+a, alt+tab, win+r, ctrl+shift+esc.
- app: Target application identifier.

### 6. set_value
Directly assign a text value to a Windows UI Automation element using ValuePattern.
- element_index: Index of the target element from the UIA accessibility tree.
- value: Text string to assign.
- app: Target application identifier.

### 7. get_app_state
Capture the current visual screenshot and Windows UI Automation element tree of a window.
- app: Target application identifier (e.g., notepad.exe, process:msedge.exe).
- content: axStateAndScreenshot (default), screenshotOnly, axStateOnly.
- Returns: Accessibility element tree (axText), screenshot data URL, and window metadata.

### 8. list_apps
List running and launchable Windows desktop applications (.exe, UWP packages) with window handles and icons.
- include_hidden: Whether to include minimized or background windows.
- Returns: Array of apps with id, displayName, and windows.

### 9. perform_accessibility_action
Trigger a native Windows UI Automation action pattern on an element.
- element_index: Element index from the UIA tree.
- action: invoke, expand, collapse, select, toggle.
- app: Target application identifier.

### 10. appshot_capture
Capture Windows window transition frames and state for animated transitions (windows_appshots_v2 protocol).
- window: Window target descriptor.
- transitionId: Identifier for the capture session.

---

## Windows Application Identifiers (WGn)

When specifying the app parameter, use:
1. Process name / executable: notepad.exe, calc.exe, excel.exe, msedge.exe.
2. Process prefix: process:notepad.exe, process:excel.exe.
3. Full executable path: C:\\Windows\\System32\\notepad.exe.
4. UWP / MSIX AUMID: Microsoft.WindowsCalculator_8wekyb3d8bbwe!App, Microsoft.WindowsTerminal_8wekyb3d8bbwe!App.

---

## Workflow Guide

1. Discover active windows: Call list_apps to verify if the desired application is already running and locate its window title.
2. Inspect the state: Call get_app_state on the target application to inspect its UI Automation tree and obtain element indices or coordinates.
3. Execute actions:
   - Prefer perform_accessibility_action or set_value when element indices are available.
   - Use click and type_text when targeting specific coordinates or canvas areas.
4. Verify feedback: The user sees the cursor animation and can observe the real-time action taking place on their screen.

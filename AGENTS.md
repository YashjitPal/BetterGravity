# Agent & Contributor Guidelines for BetterGravity

This document outlines critical architectural invariants, development rules, and guardrails for any AI agent or human contributor modifying the BetterGravity codebase.

---

## 1. Critical Invariant: Antigravity Viewport & Conversation Flexbox

### The Layout Trap
The Antigravity host application renders its chat conversation inside `[data-testid="conversation-view"]`.
This container is styled natively via Tailwind as a flexbox column (`flex flex-col h-full w-full`):
- **Child 0 (`div.relative.w-full.flex-grow.min-h-0`)**: Holds the entire message thread scroller. It relies strictly on `flex-grow: 1` within a parent `display: flex` container to expand to full viewport height (~700–800px).
- **Child 1 (`div.relative.w-full.px-4.pb-2.flex-shrink-0...`)**: Holds the composer input prompt box docked at the bottom.

### The Fatal Bug (Never Re-introduce This)
**NEVER set inline `display: block` on `[data-testid="conversation-view"]` or any container wrapping it.**

If `display: block` is set inline:
1. `display: block` overrides Tailwind's `.flex` class.
2. Because the parent is no longer a flex container, `flex-grow: 1` on Child 0 ceases to function.
3. Child 0 has `height: auto` and collapses to **`0px`** (`clientHeight: 0`, `scrollHeight: 0`). The entire message history becomes invisible.
4. Child 1 (the composer prompt box) flows as the first visible element in normal document flow, appearing at the top of the window (`y: ~75px`).

### Rules for Full-Screen / Custom View Overlays (e.g., Skills Tab)
When implementing custom full-viewport overlays (such as the Skills view `#gemini-skills-view`) that hide siblings inside `getMainViewportContainer()`:
1. **Never default previous display to `'block'`**:
   ```javascript
   // WRONG (destroys flexbox on restore):
   child.dataset.geminiSkillsHidden = child.style.display || 'block';

   // CORRECT:
   child.dataset.geminiSkillsHidden = child.style.display || '';
   ```
2. **Always restore to empty string `""`**:
   In React / Tailwind applications, elements almost never use inline styles for display. Restoring to `""` removes the inline style and allows the element's CSS classes (`flex`, etc.) to take effect:
   ```javascript
   if (child.dataset.geminiSkillsHidden !== undefined) {
     const prev = child.dataset.geminiSkillsHidden;
     child.style.display = (prev === '' || prev === 'none' || prev === 'block') ? '' : prev;
     delete child.dataset.geminiSkillsHidden;
   }
   ```
3. **Keep Defensive CSS in Place**:
   In `community/plugins/gemini-app/styles/conversation.css`, keep:
   ```css
   [data-testid="conversation-view"] {
     display: flex !important;
     flex-direction: column !important;
     ...
   }
   ```
   An author stylesheet with `!important` takes precedence over normal inline styles (`style="display: block;"`), preventing layout collapse.
4. **Keep Observer Cleanup in Place**:
   In `community/plugins/gemini-app/index.js`, the observer for `[data-testid="conversation-view"]` defensively clears any `display: block` on mount and frame updates. Do not remove this.

---

## 2. Global Repository Constraints

### No Console Logging in Project Code
- **Never add debugging statements** such as `console.log`, `console.debug`, `console.info`, or `console.warn` to runtime or plugin code (e.g. inside `community/plugins/gemini-app/`).
- If you need to inspect runtime values during development, use temporary scratch scripts communicating via Chrome DevTools Protocol (CDP), and delete or exclude them from commits.

### Never Terminate Antigravity.exe
- Do **not** run commands like `taskkill /f /im Antigravity.exe` or kill the host process. The user may be actively working in the host application.
- Use `scripts/dev-inspect.mjs` or WebSocket CDP calls to inspect or trigger hot updates.

### External Reference Repositories are Read-Only
- Any local directories containing upstream or reference code (e.g., `Willow Code`) are strictly read-only. Never modify, delete, or create files in those locations.

---

## 3. Deployment & Verification Workflow

Whenever making changes to `community/plugins/gemini-app/`:

1. **Deploy to Roaming Directory**:
   The live Antigravity installation loads plugins from `%APPDATA%\BetterGravity\plugins\gemini-app\`.
   Always copy your changes:
   ```powershell
   Copy-Item -Recurse -Force "community\plugins\gemini-app\*" "$env:APPDATA\BetterGravity\plugins\gemini-app\"
   ```

2. **Run the Community Catalog Validation**:
   ```powershell
   pnpm community:build ; pnpm community:check
   ```
   Ensure catalog generation and verification succeed with 0 errors.

3. **Run the Vitest Suite**:
   ```powershell
   pnpm test
   ```
   All tests (670+ tests across 31 files) must pass cleanly.

---

## 4. UI Parity Guidelines (Willow Design System)

- **Sidebar Navigation Items**:
  - Idle state: transparent background, `13px` Google Sans font, icon aligned with 20px box.
  - Hover state: `background-color: var(--gemini-row-hover, rgba(230, 230, 230, 0.08)) !important;`.
  - Active/Pressed state: `background-color: var(--gemini-row-pressed, rgba(230, 230, 230, 0.12)) !important;` with icon `transform: scale(0.9)`.
  - Selected state: `.bg-sidebar-secondary` applied, with filled icon variation settings.
- **Focus Rings**:
  - Standard Antigravity inputs use Tailwind ring utilities that can bleed or render awkward rectangles. For custom inputs and pills, reset `--tw-ring-shadow: 0 0 #0000;`, `--tw-ring-offset-shadow: 0 0 #0000;`, and `box-shadow: none;` on `:focus` and `:focus-visible`.

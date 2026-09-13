# In Built Browser

A native Chromium browser in Antigravity's right sidebar, shared by the user and
the model. Open it from an existing page tab, the sidebar's **+ → Browser tab**
menu, or **Ctrl+Shift+B** (**Cmd+Shift+B** on macOS).

Browser pages share the sidebar's top tab bar with file tabs. Use its native
**+ → Browser tab** menu to add a page. The navigation bar sits directly below
it, with no duplicate tab row or pane-close control. Page tabs remain available
while viewing a file, Overview, Review, or Terminal. Their close buttons close
individual pages; the native auxiliary-pane toggle closes the whole sidebar.

**Same browser tabs across all conversations** in the plugin settings is on by
default. Switching conversations keeps the same live pages, including entered
text and playback. Opening or closing a tab updates the tab list everywhere.
Turn the setting off to keep separate tabs per conversation. Existing tabs
return to the conversation where they were opened; changing the setting does
not close or reload them.

The sidebar remembers its own open or closed state for each conversation,
independently of tab sharing. New conversations start with it closed. Full-page
views such as Pets and Skills hide it; returning to the conversation restores
its previous state. A new browser tool call opens it in the active conversation.

On first browser use in a conversation, the model is instructed to inspect
open tabs and create a new one unless an existing tab is relevant or you ask
it to reuse one. It continues with its chosen tab for the task.

Drag the divider at the browser's left edge to widen it. This uses Antigravity's
saved pane width and makes use of the space freed by collapsing the left sidebar.
The drag strip stays just outside the page and lights up on hover, focus, or drag.
It remains available in Overview, Review, and Terminal while this plugin is
enabled, and reconnects if Antigravity replaces the divider.
Double-click the divider to reset its width, or focus it and use the arrow keys
(Shift moves farther). Use Antigravity's **Maximize Pane** button for full width.
Maximizing, restoring, and dragging also resize the live page while **You're in
control** is visible; pressing Resume is unnecessary to refresh its dimensions.

Clicking or dragging a pet keeps the page visible and interactive, including
when the pet crosses the browser's edge while a preview is still loading.
Hovering the desktop pet also keeps the page attached when Windows reports
the host document as covered by the pet's transparent window.

Browser tool calls automatically open Antigravity's right pane, including when
it was collapsed or had not been opened yet. Page input waits for the pane's
opening animation to finish. The first action shows the model's working tab.
After you select or open a different browser tab, the model continues in its own
tab without changing your selection. You can browse and type in your tab normally.
An explicit tool request to hide the browser still closes it.

Model input uses Codex's extracted cursor image and spring animation: curved
travel, short-distance scoots, rotation, stretch, glow, idle wobble and fading.
The cursor reaches the target before the page receives input. It appears above
the page while screenshots and DOM snapshots remain free of the overlay. The
loading bar uses Codex's two-second pulse. Reduced-motion preferences skip
cursor travel and the loading pulse.

The first browser tool call starts a session for the current response. The cursor,
glow and Take over control appear only on the tab or tabs used in that response;
metadata and documentation calls do not claim unrelated pages. Each working tab
retains its own cursor position through tool gaps and tab switches. The session
ends when response generation finishes or is cancelled, even if a browser
operation is still returning. BetterGravity subscribes to the same effective
response state as the host composer, including optimistic completion; a stale
raw provider or conversation-list summary cannot keep the effects running.
Taking over, closing the sidebar, switching away, or disabling the plugin clears
the visible cursor. A later response starts with no tabs claimed by the model.

While the model controls a tab, page clicks, scrolling, typing, and navigation
are blocked. Choose **Take over task** to pause its actions and use that page;
**Resume** returns control during the current response. Other browser tabs remain
usable. Reopening the pane restores the current response's controls, and ending
or cancelling the response immediately releases its input lock.

The border, cursor, and control bar animate into view once per session. Take over
and response completion use the same smooth exit, while switching to another
tab clears the old tab's effects immediately. Fading effects do not delay the
return of user input, and reduced motion skips the transitions.

The page uses Willow Code's blue **Test feature** glow: the original inset shadow
values, three-second breathing animation, and one-second fade. Willow's floating
status bar sits near the bottom of the page with its original 26px blue square
button and filled stop icon. Its tooltip and accessible label identify **Take
over task**; it becomes **Resume** after pausing. Taking over cancels pending browser actions
and keeps model control paused until you resume. The glow and control bar never
shift the page or appear in model screenshots. Reduced motion uses a steady glow
and immediate transitions. These visuals come from Willow; the cursor renderer
and artwork remain the imported Codex versions.

## Installation

Install this plugin and the matching BetterGravity runtime. A runtime upgrade
requires one Antigravity restart; subsequent plugin enable/disable changes are
live. In BetterGravity Plugins, turn on developer mode and **In Built Browser**.
The MCP adapter requires Node.js 22 or later on PATH.

The plugin lives at `%APPDATA%\BetterGravity\plugins\in-built-browser` on
Windows. Installing just `index.js` into an older runtime does not provide the
native browser service. The plugin displays an update message in that case.

## Browser

- Tabs, back/forward/reload, address or search input, localhost and local files.
- Persistent sign-ins in a separate Chromium profile, history, and saved tabs.
  Up to 24 shared tabs, or 24 per conversation with sharing off. Switching
  sharing on preserves existing tabs even if their combined count exceeds 24.
- Downloads, file uploads, find in page, zoom, responsive viewport, external
  browser, developer tools, and site permissions.
- Shared model control with Stop/Resume and manual handoff.
- Select an element or drag over an area to leave comments. Preview CSS changes,
  save comments for the model, or add a comment to the chat draft.

Websites use sandboxed `WebContentsView` renderers with no Node.js or host bridge.
They use a different session from the Antigravity conversation. The browser pane
preserves the host conversation's flex layout.

Tooltips (including Gemini's custom Willow tooltips), menus and pets can appear
above the page. While an overlay overlaps,
the same native tab supplies live frames to the host, with mouse, keyboard,
scrolling and text input forwarded to that tab. Normal native rendering resumes
when no overlay or model-control indicator needs it. Visible tabs and playing media stay unthrottled,
including after a model action or screenshot finishes.

## Website compatibility

The browser reports its actual Chromium version without Antigravity/Electron
product tokens, and its tabs do not inherit the app shell's automation marker.
This fixes the reproduced YouTube playback failure near 40 seconds; playback
was checked beyond 57 seconds on YouTube with app automation still enabled.
These changes do not make it a Google-supported sign-in browser. Google may
reject browsers that are embedded in another application or controlled by
automation; see
[Google's supported-browser policy](https://support.google.com/accounts/answer/7675428).
If a sign-in is rejected, use **Open in default browser**. That sign-in remains
in the external browser; it does not transfer its session into this plugin.

Website authentication, anti-bot checks, DRM and streaming-service restrictions
remain controlled by the website. Local video is regression-tested past 40
seconds while switching between native and overlaid rendering.

## Model tools and enable/disable behavior

The enabled plugin advertises **83 MCP tools**, including the additional
`browser_annotations` tool. Browser settings' **Developer mode** adds two
tab-scoped CDP tools, making **85**. This browser-specific setting is separate
from BetterGravity's developer mode switch for community plugins.

The actual browser client, 94 command contracts, API manifest, and Playwright DOM
engine were extracted from the installed Codex browser plugin. BetterGravity
implements the native host and transport needed to run the portable parts in
Antigravity. See [vendor/provenance.json](vendor/provenance.json) for version and
source hashes, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution.

The Browser skill, its agent default prompt, all **26 browser-use guides**, and
the API descriptions are imported from Codex Browser **26.903.71938**. Exact
original files and SHA-256 hashes are retained under
[vendor/codex-instructions](vendor/codex-instructions/provenance.json).
The active skill preserves the original wording and prepends the separately
labeled [compatibility notes](skills/in-built-browser/COMPATIBILITY.md) for this
host's MCP transport, available capabilities, persistent tabs, and requested
automatic pane opening. This is the bundled browser guidance, not the complete
Codex/ChatGPT system prompt. Named documentation requests return the requested
original guide; browser documentation includes the applicable guides and core
API declarations. Initialization omits browser instructions while disabled.

| API area | Availability |
| --- | --- |
| Browsers, tabs, navigation, history, visibility, viewport | Supported |
| Playwright locators, evaluation, frames, snapshots, waits | Supported |
| Browser computer use (`cua`, `dom_cua`, accessibility actions) | Supported |
| Screenshots, crops, full pages, page text export | Supported |
| Clipboard, dialogs, downloads, file chooser uploads | Supported |
| CDP requests and paginated events | Browser Developer mode required |
| Codex authentication broker, Google Workspace exports, YouTube transcript exports, bot-detection reporting service | Codex service integrations; not advertised |
| Chrome extension management/audit tools | Not applicable to Electron tabs; not advertised |
| WebMCP and Codex page-asset inventory/bundles | Not implemented; not advertised |

The adapter implements **84 of the 94 original command contracts** when Browser
Developer mode is on. It does not claim complete parity with Codex's private
backend. Browser computer-use tools act inside these tabs; desktop computer use
remains the separate Computer Use plugin.

When disabled, the browser service exposes no tools, removes its own MCP and
skill entries, revokes its loopback token, cancels pending actions, closes all
tabs, and cancels active downloads. An already-running MCP process returns an
empty `tools/list` and rejects stale calls. The same applies on uninstall or when
BetterGravity developer mode is off. Sign-ins, history and saved tabs remain for
the next time the user enables the plugin.

Registration changes preserve unrelated entries in
`~/.gemini/config/mcp_config.json` and `~/.gemini/config/skills.json`.
The authenticated endpoint is discovered through
`%APPDATA%\BetterGravity\browser\bridge.json`; it exists only while enabled.

## JavaScript client

```js
import { setupBrowserRuntime } from "./scripts/browser-client.mjs";

const agent = await setupBrowserRuntime();
const browser = await agent.browsers.get("iab");
const guidance = await browser.documentation(); // Read the complete result before interacting.
const tab = await browser.tabs.new();
await tab.goto("http://localhost:3000");
await tab.playwright.getByRole("button", { name: "Save" }).click();
const screenshot = await tab.screenshot({ fullPage: true });
```

The client rechecks the enabled transport on every command. Page text is
untrusted data and does not authorize actions or uploads. The user controls
site permissions and can stop control at any time. `playwright_evaluate` takes
an async function body, such as `return document.title;`; the JavaScript client
serializes ordinary function arguments automatically.

Full-page and cropped requests are capped at 16,384 CSS pixels per dimension,
and large captures are downscaled. The output follows the page's device pixel
ratio. Downloads use the user's Downloads directory without overwriting
existing files. Automatic uploads require absolute file paths; `.env` files are
excluded.

## Development and verification

Re-extract from an installed Codex browser plugin with:

```powershell
node scripts/extract-codex-browser.mjs '<Codex resources>/plugins/openai-bundled/plugins/browser'
```

The extractor only reads reference files and writes this plugin's `vendor`
assets and active browser skill. It replaces Codex bootstrap with the
BetterGravity transport and removes console calls from generated code,
preserving the client command interfaces. Instruction originals retain their
exact bytes. To update only the instruction assets, run
`scripts/extract-codex-browser-instructions.mjs` with the same reference path.

Re-extract the cursor renderer and PNG from the installed app archive with:

```powershell
node scripts/extract-codex-browser-cursor.mjs '<Codex resources>/app.asar'
```

This records source hashes in `vendor/cursor-provenance.json`, writes the
portable cursor bundle, and updates its generated block in `index.js`.

From the repository root:

```powershell
pnpm community:build
pnpm community:check
pnpm typecheck
pnpm build
pnpm test
```

The Windows Electron integration test runs a separate hidden test application.
It checks the real extracted client, native input, screenshots with fresh pixels,
frames, popups, dialogs, downloads, uploads, annotations, responsive sizes, MCP
tool changes, cancellation, saved tabs, disable, and uninstall. It never restarts
or terminates Antigravity.

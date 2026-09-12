# In Built Browser

A native Chromium browser in Antigravity's right sidebar, shared by the user and
the model. The globe button appears immediately after Terminal. Open it with
the button or **Ctrl+Shift+B** (**Cmd+Shift+B** on macOS).

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
- Persistent sign-ins in a separate Chromium profile, history, and saved tabs
  for the last 20 conversation contexts. Up to 24 tabs per conversation.
- Downloads, file uploads, find in page, zoom, responsive viewport, external
  browser, developer tools, and site permissions.
- Shared model control with Stop/Resume and manual handoff.
- Select an element or drag over an area to leave comments. Preview CSS changes,
  save comments for the model, or add a comment to the chat draft.

Websites use sandboxed `WebContentsView` renderers with no Node.js or host bridge.
They use a different session from the Antigravity conversation. The browser pane
preserves the host conversation's flex layout.

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
const choices = await agent.browsers.list();
const browser = await agent.browsers.get(choices[0].id);
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

Screenshots are bounded to 16,384 CSS pixels per dimension and 40 million
output pixels. Downloads use the user's Downloads directory without overwriting
existing files. Automatic uploads require absolute file paths; `.env` files are
excluded.

## Development and verification

Re-extract from an installed Codex browser plugin with:

```powershell
node scripts/extract-codex-browser.mjs '<Codex resources>/plugins/openai-bundled/plugins/browser'
```

The extractor only reads reference files and writes this plugin's `vendor`
directory. It replaces Codex bootstrap with the BetterGravity transport and
removes console calls, preserving the client command interfaces.

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

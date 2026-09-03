# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Settings inside Antigravity.** BetterGravity appears as an entry in
  Antigravity's own settings dialog, built from Antigravity's own components so
  it follows the app's theme. `Ctrl+Shift+G` jumps straight to it.
- **Adding and removing content from settings.** Add a theme or plugin from the
  group headers, drag a `.css` file onto the page to install it, and reveal or
  delete anything from its row. Deleting asks first.
- **Per-plugin options behind a gear** on the plugin's row, expanding inline.
- **Update resilience.** Antigravity replaces `app.asar` when it updates, which
  removed BetterGravity. A detached guardian now reapplies the patch once the
  update finishes. Opt-out under General.
- **Uninstall**, restoring the original bundle byte for byte while keeping all
  user content.
- **Plugin capabilities:** persistent storage, declarative typed settings,
  scoped styles, `dom.waitFor` and `dom.observe`, and `onDispose` teardown.
- **Hooks into Antigravity itself.** `plugin.patcher` intercepts a method on any
  object a plugin can reach, in the `before`/`after`/`instead` shapes;
  `plugin.react` reads the React tree by props, since Closure Compiler mangles
  component names; and `plugin.net` sees and rewrites fetch, `XMLHttpRequest`,
  and WebSocket traffic from the first request, which reaches the language
  server by RPC method name because connect-rpc puts it in the URL path.
- **Source patches.** A plugin can declare `patches` in `plugin.json` to rewrite
  Antigravity's bundle on its way to the renderer, reaching code that runs
  before any plugin does. Patches anchor on string literals, which the compiler
  cannot mangle, and each carries a `find` guard so a patch is skipped and
  reported rather than applied somewhere unintended when the host changes.
- **Interface hooks.** `plugin.ui` adds toasts, entries in Antigravity's menus,
  sidebar and title-bar buttons, dialogs, and a plugin's own screen in the app's
  settings sidebar — all built from Antigravity's own class strings, so plugin
  UI follows the user's theme. Registrations are undone when a plugin stops.
- **Live reload** for both themes and plugins; editing a plugin restarts it.
- **Theme metadata** read from a comment header, so a theme stays one file.
- **A community submission path.** Themes and plugins are submitted to
  `community/` as pull requests, validated by `pnpm community:check` in CI, and
  built into a catalogue.
- **A Community screen** in Antigravity's settings for browsing and installing
  that catalogue, with search, in-place updates, and links to each listing's
  source. The catalogue is read when the screen is opened and not before, so an
  installation nobody browses makes no network requests. Every file carries a
  SHA-256 in the catalogue and is checked on the way in; anything that does not
  match is refused, as is any path that would land outside the folder it belongs
  in. Installing never enables anything.
- Two reference plugins: `session-timer` for the basics and `ui-showcase` for
  every interface surface.
- A test suite of 330 tests, run on Windows and Linux in CI, plus a job that
  builds the portable executable.

### Changed

- **User content moved to `%APPDATA%\BetterGravity`**, outside the Antigravity
  installation, so themes, plugins, settings, and saved plugin data survive
  Antigravity being updated, reinstalled, or removed. Existing content is
  migrated on first run.
- The installer derives the operations it offers from the patcher, so the
  interface can never offer something the patcher would refuse.
- Licence changed to MIT. No `LICENSE` file had been published previously.

### Fixed

- **Bootstrap identity.** The patch declared itself as `bettergravity-bootstrap`,
  and Electron derives `app.getName()` from that. Antigravity builds both its
  userData path and its `antigravity://` protocol from the app name, so patching
  silently orphaned user data into a directory named after the bootstrap.
- **`original-fs`.** Electron rewrites `fs` so any path containing `.asar` is
  treated as a path inside an archive, which broke the patcher's own file
  operations. This affected the shipped installer, not just development.
- **Guardian self-detection.** The update guardian runs the Antigravity binary
  as a Node process, so it counted itself as the application it was waiting on.
- **Plugin storage races.** A plugin restarted by an edit read stale values, and
  a file-watcher broadcast could start a plugin before storage had loaded.
- **Settings scrollbar** sat inset from the right edge, out of line with every
  other tab, because the screen wrapper carried a height Antigravity's own
  wrappers do not have.

### Removed

- `packages/core`, an unused stub superseded by `packages/runtime`.
- The floating settings panel, replaced by the native settings section.

## [0.1.3]

First public shape of the project: a pnpm monorepo, an installer interface, and
a reversible ASAR patch for Antigravity on Windows.

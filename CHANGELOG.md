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
- **Live reload** for both themes and plugins; editing a plugin restarts it.
- **Theme metadata** read from a comment header, so a theme stays one file.
- A test suite of 141 tests, run on Windows and Linux in CI, plus a job that
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

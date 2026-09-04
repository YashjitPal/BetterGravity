# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Settings inside Antigravity.** BetterGravity gets its own heading in
  Antigravity's settings sidebar, alongside the app's own Settings, Projects,
  and Not in Project groups, with Settings, Plugins, and Themes under it. Built
  from Antigravity's own components so it follows the app's theme.
  `Ctrl+Shift+G` jumps straight to it.
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
- **Discord Rich Presence.** `plugin.presence` puts an activity on the user's
  Discord profile, and the **Discord Rich Presence** plugin uses it to show
  whether the agent is working or idle, and for how long. It sends nothing
  identifying: it reads only whether a stop control is on screen, never a
  project, conversation, model, or message.

  The socket lives in the main process because it cannot live anywhere else.
  Discord's WebSocket transport matches the `Origin` header against a list
  registered on the application, and Antigravity serves its UI from a port that
  changes every launch, so no registered origin would keep matching. The
  capability dials Discord's own socket names and nothing else, so it does not
  become a general outbound socket for plugins.
- **A Gemini key of your own.** `plugin.gemini` and the **Custom Gemini API Key**
  plugin send Antigravity's chat through a key from Google AI Studio instead of
  the bundled subscription — your own quota, and the model's own thinking passed
  through to the interface, which the bundled route does not offer.

  Antigravity's chat does not speak the public Gemini API; it speaks a protocol of
  its own to an address its language server is given on the command line. So the
  runtime becomes that address: it mints a local certificate authority, serves a
  loopback HTTPS listener, rewrites that one argument as the language server is
  spawned, and translates each request into a public API call and each reply back.

  The endpoint is only rewritten once the authority is trusted, because an
  untrusted authority means a refused handshake and no chat at all, which is worse
  than chat carrying on through Google. Nobody is asked to arrange that: switching
  the plugin on adds the authority to `Cert:\CurrentUser\Root` — no administrator
  rights, nothing outside the account — and the first launch where no plugin wants
  it takes it back out. Switching the plugin off returns chat to the bundled
  subscription immediately, without waiting for a restart. Every path that cannot
  translate forwards instead, so no state of this feature stops you talking to the
  agent.

  A **Base URL** moves where the key is spent off Google's own API, for a key that
  belongs to a relay of your own or to a gateway a workplace puts in front of it.
  The key itself is held in the main process, sent to that address and nowhere
  else, and kept out of every status, log line, and the optional request log —
  which records the model, the timings, and the outcome, never a prompt.
  `.gitignore` covers runtime state, so a key cannot reach a clone of this
  repository by accident.
- **The signed-in name.** `plugin.account` gives a plugin the first name on the
  Google account Antigravity is signed in with, so it can address the person
  using the app instead of asking them to type their own name into a settings
  field.

  Antigravity does not keep the name. Its language server reports the address the
  user signed in with and nothing more, and there is no display name anywhere in
  the bundle. The name exists on the machine all the same, because the app signs
  in through a Chromium profile of its own and Chromium writes Google's answer
  into that profile's `Preferences`, so the main process reads it from there —
  matching the account Antigravity is actually using, since more than one can be
  signed into the same profile.

  Only the name crosses to the page, the given name and the full name, never the
  address they belong to, and nothing is written back. One read is shared by
  every plugin on the page, because Google's record does not change between two
  visits to a home screen; a read that fails is not remembered, so a profile
  being rewritten as the page loads is asked again rather than held wrong for the
  session. No profile, no answer, and no failure either — the read resolves with
  no name, so a greeting goes without one instead of taking its plugin down.
- **Interface hooks.** `plugin.ui` adds toasts, entries in Antigravity's menus,
  sidebar and title-bar buttons, dialogs, and a plugin's own screen in the app's
  settings sidebar — all built from Antigravity's own class strings, so plugin
  UI follows the user's theme. Registrations are undone when a plugin stops.
- **Live reload** for both themes and plugins; editing a plugin restarts it.
- **Theme metadata** read from a comment header, so a theme stays one file.
- **Stylesheets in a plugin's manifest.** `"styles"` in `plugin.json` names
  `.css` files that are folded like a folder theme and injected while the plugin
  runs, so a plugin whose look outweighs its behaviour keeps its CSS in CSS
  files. Editing one restarts the plugin; a plugin that is only a look may omit
  its script.
- **Gemini App plugin.** Antigravity restyled after the Gemini app, built element
  by element from Willow's measurements: the left sidebar, the model selector,
  the prompt box, the conversation, and the home screen — the glow behind the
  prompt box, the box centred on the pane the way Willow centres its own, and
  "Hello there, <name>" above it — with the prompt box's model pill shortened to
  "3.1 Pro" the way Willow's is. Its plus menu gains the agent's tools — Goal,
  Boost, and the rest, read from Antigravity itself rather than listed here —
  which the app otherwise only offers behind a slash. The greeting's name comes
  from `plugin.account`, and submitting a prompt slides the box down into the
  conversation it starts, over a distance that only exists once it happens;
  opening a conversation from the sidebar does not, which is a deliberate
  departure from Willow. None of that can come from CSS, so it is a plugin rather
  than a theme.
- **A community submission path.** Themes and plugins are submitted to
  `community/` as pull requests, validated by `pnpm community:check` in CI, and
  built into a catalogue.
- **Browsing and installing the catalogue** from the Themes and Plugins screens,
  which list what you have installed and, underneath, what the catalogue offers
  that you do not. Search, in-place updates on the row of the thing they update,
  and links to each listing's source. The catalogue is read when one of those
  screens is opened and not before, so an installation nobody browses makes no
  network requests. Every file carries a SHA-256 in the catalogue and is checked
  on the way in; anything that does not match is refused, as is any path that
  would land outside the folder it belongs in. Installing never enables
  anything.
- Two reference plugins: `session-timer` for the basics and `ui-showcase` for
  every interface surface.
- A test suite of 578 tests, run on Windows and Linux in CI, plus a job that
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

- **The update guardian never firing.** An update ends with Antigravity
  relaunching itself, and the guardian stopped the moment it saw the application
  running again, so it could only act if it won a race against the relaunch. On
  a real 2.11 to 2.12 update it lost and left the installation unpatched. It now
  distinguishes the two cases: coming back with the patch intact means there was
  nothing to do, while coming back without it means the update landed, and the
  guardian waits for the application to be closed before reapplying. It still
  never closes anything itself.
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

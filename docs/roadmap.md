# Roadmap

Dates are omitted on purpose. Antigravity is a moving target and the ordering
below reflects what unblocks what, not a schedule.

## 0.1 · First Light — done

- Repository and package boundaries.
- Installer with install, update, reinstall, repair, and uninstall.
- Safe preview patcher for developing the interface in a browser.

## 0.2 · Native installer — done

- Windows installation discovery and version validation.
- Backup, staged replacement, verification, and byte-for-byte uninstall.
- A test suite covering the patch lifecycle against synthetic bundles, run on
  Windows in CI.
- Packaging as a portable executable. Signing is still outstanding.

## 0.3 · Runtime foundation — done

- The runtime loads inside Antigravity, injected rather than file-patched,
  because the host serves its interface over loopback.
- Themes as single `.css` files with live reload.
- Plugins with storage, declarative settings, scoped styles, DOM helpers, and
  teardown, gated behind developer mode.
- Settings inside Antigravity's own dialog, using its components, with adding,
  deleting, and per-plugin options behind a gear.
- Content stored outside the installation so it survives host updates.
- Automatic reapplication after Antigravity updates itself.

## 0.3.1 · Depth — done

Antigravity is compiled with Closure Compiler and serves its interface over
loopback, so none of the techniques a Vencord author would reach for transfer
directly. These are the equivalents that do work here.

- Function patching, React tree access by props, and network interception,
  including the language server by RPC method name.
- Source patches declared in `plugin.json`, anchored on string literals, for
  code that runs before any plugin does.
- Interface hooks: toasts, menu entries, toolbar buttons, dialogs, and a
  plugin's own screen in Antigravity's settings.

## 0.4 · Community preview — next

- A marketplace surface listing source-linked plugins and themes.
- Installing and updating a package from the panel rather than by copying a
  folder.
- Signed catalogue updates, compatibility checks, and reporting.
- A permission model, so a plugin declares what it needs and the user sees it
  before enabling. The developer-mode gate is deliberately blunt and should
  become unnecessary for curated packages.

## Beyond

- Code signing, so Windows stops warning on first run.
- The separately installed Antigravity IDE, which is a different application
  from the launcher this patches and needs its own approach.
- macOS and Linux, once there is a reason to believe the host layout matches.
- A safe mode that starts Antigravity with every plugin disabled, for recovering
  from a plugin that misbehaves badly enough to make the panel unreachable.

# Security policy

BetterGravity modifies an application already installed on your machine, and it
runs community code inside an editor that has access to your source and
credentials. Security reports are treated as the highest priority work in the
project.

## Supported versions

Only the latest release is supported. BetterGravity is pre-1.0 and moves
quickly; fixes land on `main` and go out in the next release.

## Reporting a vulnerability

**Please do not open a public issue for an exploitable vulnerability.**

Open a
[private security advisory](https://github.com/YashjitPal/BetterGravity/security/advisories/new)
instead. That is the private channel available on this repository today.

A useful report includes:

- The BetterGravity version, the Antigravity version, and your operating system
- What an attacker could achieve, and what access they would need to start
- Reproduction steps, ideally minimal
- Whether original user files, credentials, or the Antigravity installation
  could be affected

**Never attach personal Antigravity data, conversation contents, tokens,
credentials, or private configuration.** A description is enough.

You can expect an acknowledgement within a few days, and an assessment of
severity and a fix plan once the report is understood. Credit is given in the
release notes unless you would rather stay anonymous.

## What is in scope

Anything that lets a theme, a plugin, or a downloaded file do more than it
should, and anything that puts the host installation at risk:

- A **theme** doing more than styling. Themes are plain CSS and are loaded
  without a gate, so any way for one to execute code, read files, or reach the
  network is a serious bug.
- A **plugin** escaping the boundaries described in the
  [plugin API](docs/plugin-api.md), such as reading or writing outside its own
  folder, or reaching another plugin's stored data.
- The **installer** being made to patch something other than a verified
  Antigravity installation, to write outside the installation directory, or to
  leave an installation unbootable with no backup.
- The **update guardian** being made to run something other than the patch it is
  meant to reapply.
- Any **path traversal** through a theme name, plugin id, or manifest field.

## What is not in scope

- **Plugins doing what plugins do.** A plugin is arbitrary code running in the
  page, with access to whatever that page can reach. That is the design, it is
  why plugin loading is off until you enable developer mode, and it is why the
  settings page states the risk plainly. A malicious plugin is a trust problem,
  not a vulnerability — though if you find one being distributed, please report
  it so it can be named.
- **Antigravity's own vulnerabilities.** Report those to Google.
- **The unsigned installer triggering SmartScreen.** Known, and tracked on the
  roadmap.

## How the project limits risk

- The installer validates a bundle before touching it, refuses host versions it
  has not been tested against, and keeps timestamped backups.
- The patch is designed to fail open: if the runtime throws, Antigravity starts
  as though BetterGravity were not installed.
- Plugin loading is off by default and gated behind an explicit developer-mode
  switch that explains what it means.
- Plugin manifests cannot point outside their own folder, and content ids coming
  from the page are resolved against the content directory before use.
- Nothing a theme or plugin does can influence the installer.

## Marketplace

Automatic installation of third-party content does not exist yet. Before it
does, it will require source links, declared permissions, compatibility
metadata, and a reporting path. See the
[marketplace direction](docs/marketplace.md).

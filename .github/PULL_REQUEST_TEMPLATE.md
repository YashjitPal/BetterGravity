## What changed

<!-- The user-facing result, in a sentence or two. Link any issue this closes. -->

## Area

- [ ] Installer
- [ ] Patcher
- [ ] Runtime, inside Antigravity
- [ ] Settings section
- [ ] Plugin or theme API
- [ ] Documentation
- [ ] A theme or plugin for `community/`

<!--
Submitting a theme or plugin? Only this section applies. Delete the rest, and:

- [ ] `pnpm community:check` passes
- [ ] `community/catalog.json` is regenerated and committed
- [ ] The code is readable, and not minified or generated
- [ ] Anything flagged as a review note has a reason given below
-->

## How it was verified

<!--
Say what you actually ran. If it touches the patcher or the runtime, say whether
you tested against a real Antigravity installation and what you saw.
-->

- [ ] `pnpm check` passes
- [ ] Tested against a real Antigravity installation, or not applicable

## Checks

- [ ] If this fixes a bug, there is a test that would have caught it
- [ ] The bootstrap still fails open, so Antigravity starts even if the runtime
      does not
- [ ] No renderer source imports `@bettergravity/patcher/native`
- [ ] No credentials, personal data, build output, or Antigravity files included

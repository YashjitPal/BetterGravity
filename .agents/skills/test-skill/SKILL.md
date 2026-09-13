---
name: test-skill
description: >-
  A test skill designed to verify Antigravity skill discovery, activation, and progressive disclosure in the BetterGravity workspace. Use when the user asks to test skills, verify skill loading, or check skill integration.
---

# Test Skill

This skill demonstrates and verifies the Antigravity Customization System within the BetterGravity repository.

## Purpose

- Confirms that workspace-level skills in `.agents/skills/` are discovered by Antigravity.
- Verifies progressive disclosure (reading the full `SKILL.md` instructions and referenced documentation on demand).
- Provides a clean, standardized template for building future workspace skills.

## Verification Steps

When this skill is activated:

1. **Verify Discovery**: Confirm that Antigravity successfully triggered `test-skill` from `.agents/skills/test-skill/SKILL.md`.
2. **Consult Reference Material**: If detailed guidelines are needed, refer to [quickstart.md](./references/quickstart.md).
3. **Report Status**: Notify the user that the skill test passed successfully and describe the skill's discovery path and capabilities.

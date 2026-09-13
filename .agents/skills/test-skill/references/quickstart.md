# Test Skill Reference Guide

This reference document demonstrates progressive disclosure in Antigravity skills.

## How Antigravity Skills Work

1. **Discovery**: Antigravity scans `.agents/skills/<skill-name>/SKILL.md` in the workspace root.
2. **Registration**: At session startup, Antigravity extracts the YAML frontmatter (`name` and `description`) and makes it available to the agent.
3. **Progressive Disclosure**: The body of `SKILL.md` is only loaded into context when the agent activates the skill in response to a relevant user prompt.
4. **Referenced Resources**: Ancillary guides like this file (`references/quickstart.md`) or scripts (`scripts/`) are loaded on demand via file viewing or tool execution.

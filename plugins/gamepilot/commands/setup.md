---
description: Check whether the local GamePilot CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gamepilot-companion.mjs" setup --json "$ARGUMENTS"
```

If the result says GamePilot is unavailable:
- Instruct the user to download and install GamePilot from https://ai.levelinfinite.com/dev.
- Do not ask about installation.
- Do not run an install command.

Output rules:
- Present the final setup output to the user.
- If GamePilot is unavailable, preserve the guidance to download and install from https://ai.levelinfinite.com/dev.
- If GamePilot is installed but not authenticated, preserve the guidance to run `!gpc` to authenticate interactively or set `GAMEPILOT_API_KEY`.

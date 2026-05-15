---
description: Cancel an active background GamePilot job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gamepilot-companion.mjs" cancel "$ARGUMENTS"`

Output rules:
- Present the cancellation result to the user.
- Do not add commentary.

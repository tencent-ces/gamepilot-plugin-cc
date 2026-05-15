---
description: Check whether the local GamePilot CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gamepilot-companion.mjs" setup --json "$ARGUMENTS"
```

If the result says GamePilot is unavailable and npm is available:
- Use `AskUserQuestion` exactly once to ask whether Claude should install GamePilot now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install GamePilot CLI (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
npm install -g @google/gamepilot-cli
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gamepilot-companion.mjs" setup --json "$ARGUMENTS"
```

If GamePilot is already installed or npm is unavailable:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If GamePilot is installed but not authenticated, preserve the guidance to run `!gpc` to authenticate interactively or set `GAMEPILOT_API_KEY`.

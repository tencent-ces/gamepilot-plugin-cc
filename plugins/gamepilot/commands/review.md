---
description: Run a GamePilot code review of a target, working-tree, or branch changes in this repository
argument-hint: '[native-/review-target-or-flags] [--background]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gamepilot-companion.mjs" review "$ARGUMENTS"`

Behavior:
- Delegates regular reviews to GamePilot CLI's native ACP `/review` command so review targeting and worker behavior stay aligned with `gpc`.
- Forwards native `/review` target text and flags (for example file paths, `staged`, `--scope general`, or natural-language scopes) directly to GamePilot CLI.

Flags:
- `--background` is consumed by the plugin to run the review as a tracked background job.
- All other flags are passed through as native GamePilot `/review` text.

Output rules:
- Present the review output to the user exactly as returned.
- Do not paraphrase, summarize, or add your own commentary.
- Do not make any code changes based on the review findings.
- If the output is empty or indicates no changes, say so explicitly.

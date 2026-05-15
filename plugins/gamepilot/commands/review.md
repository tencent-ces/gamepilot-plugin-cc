---
description: Run a GamePilot code review of working-tree or branch changes in this repository
argument-hint: '[--base <ref>] [--scope <auto|working-tree|branch>] [--wait|--background] [--model <model-id>] [--thinking <off|low|medium|high>] [--stream-output] [--json]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gamepilot-companion.mjs" review "$ARGUMENTS"`

Behavior:
- Delegates regular reviews to GamePilot CLI's native ACP `/review` command so review targeting and worker behavior stay aligned with `gpc`.

Flags:
- `--thinking <off|low|medium|high>` selects a requested reasoning level (default: medium). The local GamePilot CLI does not expose a per-invocation thinking override yet; the companion parses and validates the flag, emits a one-shot warning, and falls back to the CLI's default reasoning. Configure `thinkingConfig` in GamePilot `settings.json` for a persistent setting that takes effect today.
- `--stream-output` streams raw model and thought chunks to stderr during the review. Without it, progress is shown as compact markers.

Output rules:
- Present the review output to the user exactly as returned.
- Do not paraphrase, summarize, or add your own commentary.
- Do not make any code changes based on the review findings.
- If the output is empty or indicates no changes, say so explicitly.

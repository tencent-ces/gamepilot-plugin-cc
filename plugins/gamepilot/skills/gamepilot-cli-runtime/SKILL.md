---
name: gamepilot-cli-runtime
description: Internal helper contract for calling the gamepilot-companion runtime from Claude Code
user-invocable: false
---

# GamePilot Companion Runtime Contract

## Invocation

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gamepilot-companion.mjs" task [flags] -- <prompt>
```

Everything after `--` (or the first non-flag positional) is the task text sent to GamePilot.

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--write` | boolean | false | Enable GamePilot to make file changes (sets `--approval-mode auto_edit`) |
| `--model <model-id>` | string | (unset) | Model name configured in GamePilot Studio LLM settings; forwarded as-is |
| `--thinking-budget <n>` | integer | (unset) | Thinking token budget for the model |
| `--approval-mode <mode>` | string | `default` | One of: `default`, `auto_edit`, `yolo`, `plan` |
| `--resume-last` | boolean | false | Resume the most recent task thread in this repository |
| `--background` | boolean | false | Run as a detached background job |
| `--wait` | boolean | true | Run in the foreground (default) |
| `--cwd <path>` | string | `$CLAUDE_PROJECT_DIR` | Working directory override |
| `--json` | boolean | false | Emit structured JSON instead of rendered markdown |

## Model Reference

`--model <model-id>` accepts only model names configured in GamePilot Studio LLM settings. The runtime forwards the value as-is to GamePilot CLI and does not provide aliases or built-in model defaults. Omit `--model` to use the GamePilot CLI default.

## Safety Rules

- Exactly one Bash call per rescue invocation.
- Never chain additional tool calls after the companion returns.
- Never inspect, modify, or second-guess GamePilot's output.
- If the companion exits non-zero, return nothing — do not fabricate a response.
- Do not include `--thinking-budget`, `--model`, `--resume-last`, `--background`, or `--wait` in the task text itself. They are runtime controls.

## Output

- `stdout`: Rendered markdown (default) or JSON (`--json`).
- `stderr`: Progress updates during execution.
- Exit code 0 = success, non-zero = failure.

## Job Health Labels

`/gpc:status` reports a conservative `Health` label for each active job.
Interpret each label as follows when deciding what to do next:

| Label | Interpretation | Recommend to the user |
|-------|----------------|-----------------------|
| `active` | GamePilot emitted progress recently. | Wait for completion; do not cancel. |
| `quiet` | Heartbeat is recent but no new progress. | Re-check `/gpc:status` shortly. |
| `possibly_stalled` | No recent heartbeat or progress. | Re-check `/gpc:status`, fetch `/gpc:result`, or retry if the job does not recover. |
| `rate_limited` | Explicit quota or 429-class diagnostic. | Wait, switch to another Studio-configured model with `--model <model-id>`, or cancel with `/gpc:cancel`. |
| `auth_required` | Explicit auth/credential diagnostic. | Point the user to `/gpc:setup` to re-authenticate before retrying. |
| `broker_unhealthy` | The ACP broker reported busy/disconnected. | Re-check status shortly; a restart may be needed if it persists. |
| `worker_missing` | Worker PID is no longer alive. | Fetch `/gpc:result`; retry if the output is incomplete. |
| `failed` | Worker or GamePilot ended with an error. | Fetch `/gpc:result` for the diagnostic and retry only after understanding it. |
| `completed` | GamePilot finished successfully. | Fetch `/gpc:result` and present output; do not retry. |
| `cancelled` | Job was cancelled by user or system. | Fetch `/gpc:result` for final diagnostics; consider retrying if needed. |

Never claim a job is dead or useless based on `quiet` or `possibly_stalled`
alone. Those labels mean "check again", not "give up".

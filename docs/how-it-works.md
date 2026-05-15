# How gamepilot-plugin-cc Works

`gamepilot-plugin-cc` is a Claude Code plugin that lets Claude delegate work to the local GamePilot CLI (`gpc`) without leaving the Claude Code session. It exposes slash commands such as `/gamepilot:review`, `/gamepilot:rescue`, `/gamepilot:status`, `/gamepilot:result`, and `/gamepilot:cancel`, then routes those commands through a small Node.js runtime in `plugins/gamepilot/scripts`.

## High-level flow

```text
Claude Code slash command
  -> plugin command markdown file
  -> node scripts/gamepilot-companion.mjs <subcommand>
  -> GamePilot ACP client
  -> broker socket, or direct gpc --acp fallback
  -> local GamePilot CLI session
```

The plugin does not bundle a separate GamePilot runtime. It depends on the `gpc` command being available on `PATH` and uses the user's existing GamePilot configuration and authentication.

## Main components

### Plugin metadata and command files

- `.claude-plugin/marketplace.json` describes the top-level plugin package.
- `plugins/gamepilot/.claude-plugin/plugin.json` describes the installable Claude Code plugin.
- `plugins/gamepilot/commands/*.md` define the slash commands Claude Code exposes.
- `plugins/gamepilot/agents/gamepilot-rescue.md` defines the forwarding subagent used for rescue-style delegation.
- `plugins/gamepilot/skills/*` document internal contracts used by command and agent prompts.

The command markdown files are intentionally thin. They instruct Claude Code to invoke the companion runtime through `node "${CLAUDE_PLUGIN_ROOT}/scripts/gamepilot-companion.mjs" ...` and to return the runtime's output without doing independent work.

### `gamepilot-companion.mjs`

`plugins/gamepilot/scripts/gamepilot-companion.mjs` is the main Node.js entrypoint. It parses command-line arguments and dispatches to subcommands:

- `setup` checks whether `gpc` is installed, whether authentication appears usable, and toggles the stop-review gate setting.
- `review` collects git context and asks GamePilot for a structured review.
- `adversarial-review` runs the same review path with an additional user-supplied focus.
- `task` sends an arbitrary prompt to GamePilot, either in the foreground or as a tracked background job.
- `task-worker` is the internal background worker entrypoint.
- `status`, `result`, and `cancel` inspect or control tracked jobs.
- `task-resume-candidate` finds a resumable prior task thread for the current workspace.

The companion is the boundary between Claude Code prompts and deterministic local code. It owns flag parsing, JSON/text rendering, job creation, and validation of options such as `--thinking`.

## GamePilot communication

### ACP transport

GamePilot is reached through ACP, a JSON-RPC 2.0 protocol over stdio. The plugin starts GamePilot in ACP mode with:

```bash
gpc --acp
```

The ACP client is implemented in `plugins/gamepilot/scripts/lib/acp-client.mjs`. It has two modes:

1. **Broker mode**: connect to a persistent broker process over a Unix socket or Windows named pipe.
2. **Direct mode**: spawn `gpc --acp` directly if the broker is unavailable or busy.

The broker-first strategy avoids paying process startup cost for every command while still allowing a direct fallback.

### Broker process

`plugins/gamepilot/scripts/acp-broker.mjs` owns the persistent `gpc --acp` child process. It:

- listens on a restricted local endpoint;
- multiplexes JSON-RPC requests from companion commands;
- forwards ACP notifications from GamePilot;
- buffers bounded diagnostic events until a client connects;
- reports child stderr, startup, exit, and error diagnostics;
- refuses forged `broker/diagnostic` notifications from the child process.

The trust-boundary rule is important: only the broker itself may emit trusted broker diagnostics. If the `gpc --acp` child writes a `broker/diagnostic` notification, the broker drops it rather than forwarding potentially misleading health or auth messages.

## Review commands

`/gamepilot:review` and `/gamepilot:adversarial-review` use git context collection before contacting GamePilot:

1. `lib/git.mjs` determines the review target from `--scope` and `--base`.
2. It collects working-tree changes, branch diffs, and safe untracked file contents.
3. `lib/prompts.mjs` loads the relevant prompt template from `plugins/gamepilot/prompts`.
4. `lib/gamepilot.mjs` calls `runAcpReview` or `runAcpAdversarialReview`.
5. The ACP client opens a GamePilot session, sets approval mode, optionally sets a Studio-configured model id, and sends the prompt.
6. The response is parsed against `schemas/review-output.schema.json` and rendered for Claude Code.

The review output is expected to be structured so Claude can present findings deterministically instead of relying on free-form prose.

## Rescue and task delegation

`/gamepilot:rescue` delegates arbitrary implementation or investigation work to GamePilot. The command strips routing flags from the natural-language task text, then calls:

```bash
node scripts/gamepilot-companion.mjs task ... -- <prompt>
```

Important task flags:

- `--write` requests `approvalMode: "auto_edit"`, allowing GamePilot to make file changes.
- `--model <model-id>` forwards a GamePilot Studio-configured model name as-is. The plugin does not provide aliases or built-in default model ids.
- `--thinking <off|low|medium|high>` is parsed and validated, but current delivery is controlled by GamePilot settings rather than a per-invocation ACP override.
- `--stream-output` streams raw model and thought chunks to stderr; otherwise compact progress markers are shown.
- `--background` creates a tracked job and returns immediately.
- `--resume-last` continues the latest persisted task thread for the workspace when available.

Foreground tasks return rendered output directly. Background tasks persist state so `/gamepilot:status` and `/gamepilot:result` can be used later.

## Job state and observability

Background work is tracked under the plugin data directory managed by `lib/state.mjs`. The job lifecycle is implemented by `lib/tracked-jobs.mjs`, `lib/job-control.mjs`, and `lib/job-observability.mjs`.

A tracked job stores:

- id, kind, title, status, and timestamps;
- worker pid and runtime details;
- GamePilot session/thread id when known;
- log file path;
- final result or error summary;
- bounded recent observability events.

Observability events intentionally avoid storing raw model text. For streaming model output, the event log records counts such as chunk sizes, thought counts, tool calls, file changes, phase transitions, and sanitized diagnostics.

`/gamepilot:status` builds a conservative health snapshot from this data. Health labels include states such as `active`, `quiet`, `possibly_stalled`, `rate_limited`, `auth_required`, `broker_unhealthy`, `worker_missing`, `failed`, `completed`, and `cancelled`.

## Result and resume behavior

`/gamepilot:result` renders the stored result for a completed or failed job. When a GamePilot session id is available, the result includes a resume command like:

```bash
gpc --resume <session-id>
```

This lets users move work from Claude Code into the standalone GamePilot CLI if needed.

## Setup and authentication

`/gamepilot:setup` checks local readiness:

- `getGamePilotAvailability()` verifies that `gpc` exists and reads `gpc --version`.
- `getGamePilotAuthStatus()` first checks supported environment authentication, then probes ACP authentication methods.
- The command can enable or disable the stop-review gate setting in plugin state.

If interactive authentication is required, users should run:

```bash
!gpc
```

inside Claude Code, or configure an API key/environment expected by the local GamePilot CLI.

## Stop-review gate hook

`plugins/gamepilot/scripts/stop-review-gate-hook.mjs` is a synchronous hook used by the optional review gate. It loads the stop-gate prompt and runs a headless GamePilot review with:

```bash
gpc -p <prompt> --output-format text --approval-mode plan
```

The hook blocks only when the review says the previous Claude response requires attention. If GamePilot is unavailable, setup guidance is returned instead.

## Safety model

The plugin's safety posture is based on explicit boundaries:

- Claude Code command prompts are thin wrappers; deterministic Node.js code performs the actual execution.
- File writes require write-capable approval mode (`--write` / `auto_edit`) rather than being implicit for every task.
- Broker diagnostics are sanitized and bounded before being stored or shown.
- Raw model text is not persisted in job event logs.
- Background state writes use mutexes and atomic file writes to avoid corrupting job records.
- ACP direct mode treats child-originated `broker/diagnostic` messages as untrusted.

## Key files to read next

- `plugins/gamepilot/scripts/gamepilot-companion.mjs` — command dispatcher.
- `plugins/gamepilot/scripts/lib/gamepilot.mjs` — prompt/review/task execution over ACP.
- `plugins/gamepilot/scripts/lib/acp-client.mjs` — broker-first ACP client and direct fallback.
- `plugins/gamepilot/scripts/acp-broker.mjs` — persistent `gpc --acp` broker.
- `plugins/gamepilot/scripts/lib/tracked-jobs.mjs` — background job lifecycle.
- `plugins/gamepilot/scripts/lib/job-observability.mjs` — bounded health/event model.
- `plugins/gamepilot/scripts/lib/render.mjs` — user-facing output rendering.

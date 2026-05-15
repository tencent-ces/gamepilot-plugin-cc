# GamePilot Plugin for Claude Code

Use GamePilot CLI from inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to review code or delegate tasks.


> **Origin:** This plugin is ported from [gemini-plugin-cc](https://github.com/sakibsadmanshajib/gemini-plugin-cc), which was itself ported from [codex-plugin-cc](https://github.com/openai/codex-plugin-cc). This version adapts the Claude Code plugin workflow for GamePilot CLI. See [Differences from gemini-plugin-cc](#differences-from-gemini-plugin-cc) for details.

## What You Get

| Command | Purpose |
|---------|---------|
| `/gpc:review` | Read-only GamePilot code review |
| `/gpc:adversarial-review` | Steerable challenge review |
| `/gpc:rescue` | Delegate a task to GamePilot |
| `/gpc:status` | List active and recent jobs |
| `/gpc:result` | Show full output for a finished job |
| `/gpc:cancel` | Cancel an active background job |
| `/gpc:setup` | Check install, auth, and toggle review gate |

## Requirements

- **Node.js 22.2.0 or later**

## Install

Steps 1–2 run in your **terminal**. Steps 3–4 run **inside a Claude Code session**.

### 1. Add the marketplace (terminal)

```bash
claude plugin marketplace add tencent-ces/gamepilot-plugin-cc
```

### 2. Install the plugin (terminal)

```bash
claude plugin install gamepilot-plugin-cc@gamepilot
```

### 3. Reload plugins (inside Claude Code)

```
/reload-plugins
```

### 4. Run setup (inside Claude Code)

```
/gpc:setup
```

If GamePilot CLI is not installed, download and install it from https://ai.levelinfinite.com/dev.

If GamePilot CLI is installed but not authenticated, run `!gpc` in Claude Code to authenticate interactively, or set `GAMEPILOT_API_KEY` in your environment.

## Usage

### `/gpc:review`

Runs a GamePilot review on your current work.

> **Note:** Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/gpc:adversarial-review`](#gpcadversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/gpc:review
/gpc:review --base main
/gpc:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/gpc:status`](#gpcstatus) to check on the progress and [`/gpc:cancel`](#gpccancel) to cancel the ongoing task.

### `/gpc:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/gpc:review`, including `--base <ref>` for branch review.
It also supports `--wait` and `--background`. Unlike `/gpc:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/gpc:adversarial-review
/gpc:adversarial-review --base main challenge whether this was the right caching and retry design
/gpc:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/gpc:rescue`

Hands a task to GamePilot through the `gpc:gamepilot-rescue` subagent.

Use it when you want GamePilot to:

- investigate a bug
- try a fix
- continue a previous GamePilot task
- take a faster or cheaper pass with a smaller model

> **Note:** Depending on the task and the model you choose these tasks might take a long time and it's generally recommended to force the task to be in the background or move the agent to the background.

It supports `--background`, `--wait`, `--resume`, and `--fresh`. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest rescue thread for this repo.

Examples:

```bash
/gpc:rescue investigate why the tests started failing
/gpc:rescue fix the failing test with the smallest safe patch
/gpc:rescue --resume apply the top fix from the last run
/gpc:rescue --model my-studio-model investigate the flaky integration test
/gpc:rescue --background investigate the regression
```

You can also just ask for a task to be delegated to GamePilot:

```text
Ask GamePilot to redesign the database connection to be more resilient.
```

**Notes:**

- if you pass `--model <model-id>`, use a model name configured in GamePilot Studio LLM settings
- if you do not pass `--model`, GamePilot CLI uses its configured default model
- follow-up rescue requests can continue the latest GamePilot task in the repo

### `/gpc:status`

Lists active and recent GamePilot jobs for this repository.

```bash
/gpc:status
/gpc:status <job-id>
/gpc:status --wait
```

The compact active-jobs table includes a `Health` column and a `Last Progress`
timestamp so you can tell at a glance whether GamePilot is still making forward
progress. When you pass a specific `<job-id>`, the detailed output also shows
the health message, recommended next action, runtime transport (direct vs.
broker socket), GamePilot session ID when known, and a bounded Recent Events list
covering session updates, model output chunks, tool calls, file changes, and
diagnostics.

Health labels:

| Label | Meaning | Recommended action |
|-------|---------|--------------------|
| `active` | Recent progress from GamePilot. | No action; wait for result. |
| `quiet` | Worker heartbeat is recent but no new progress. | Re-check status shortly. |
| `possibly_stalled` | No recent heartbeat or progress. | Re-check status or fetch `/gpc:result`; retry if the job does not recover. |
| `rate_limited` | GamePilot reported quota/rate limiting. | Wait, switch models, or cancel with `/gpc:cancel <job-id>`. |
| `auth_required` | GamePilot reported an auth/login problem. | Re-authenticate via `/gpc:setup`, then retry. |
| `broker_unhealthy` | The ACP broker reported a connectivity or busy state. | Re-check status shortly; restart the broker if it does not recover. |
| `worker_missing` | The background worker PID is no longer alive. | Check `/gpc:result`; retry if output is incomplete. |
| `failed` | GamePilot or the worker ended with an error. | Check `/gpc:result` for details before retrying. |
| `cancelled` | The job was cancelled by the user or runtime. | No further action unless you want to retry. |
| `completed` | The job finished successfully. | Fetch output with `/gpc:result <job-id>`. |

Example detailed output:

```text
Health: rate_limited
Last Progress: 12m ago
Diagnostic: GamePilot reported quota or rate limiting and appears to be waiting before retrying.
Try: wait, switch models, or cancel with /gpc:cancel <job-id>
```

**Safety notes.** The Health message and recommended action shown in
`/gpc:status` are treated as trusted broker-originated diagnostics. To keep
that trust honest:

- The ACP broker refuses to forward a `broker/diagnostic` notification that
  originated from the `gpc --acp` child. A compromised child cannot forge
  the Health/recommended-action text that you see. The ACP client applies the
  same rule in direct mode, where `broker/diagnostic` from stdout is treated
  as an untrusted notification rather than a diagnostic.
- `worker_missing` is reported whenever the stored worker PID no longer
  belongs to the current user. This catches two failure modes with one check:
  the worker exited cleanly, or the OS recycled the PID to another user's
  process (which, under the plugin's single-user spawn model, means the
  worker is gone).
- Event and diagnostic payloads are bounded (50 events per job, 500 chars per
  message) and stripped of ANSI/control characters before they reach the
  renderer. No prompts, credentials, or raw stderr enter the compact job
  index.

### `/gpc:result`

Shows the full stored output for a finished job.

```bash
/gpc:result
/gpc:result <job-id>
```

### `/gpc:cancel`

Cancels an active background job.

```bash
/gpc:cancel
/gpc:cancel <job-id>
```

### `/gpc:setup`

Checks whether GamePilot is installed and authenticated.
If GamePilot is missing and npm is available, it can offer to install GamePilot for you.

You can also use `/gpc:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/gpc:setup --enable-review-gate
/gpc:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted GamePilot review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> **Warning:** The review gate can create a long-running Claude/GamePilot loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Live Progress & Thinking Levels

### Thinking levels

Each task or review accepts `--thinking <off|low|medium|high>` — a t-shirt-sized request for the reasoning level:

| Level | Behavior |
|-------|----------|
| `off` | Minimal reasoning request. Fastest; clamped to `low` on models that don't support zero thinking. |
| `low` | Light reasoning — quick tasks, short context. |
| `medium` *(default)* | Dynamic reasoning — balanced default, matches the model's own heuristics. |
| `high` | Deep reasoning — use when the task needs careful analysis. |

The level maps to the right underlying GamePilot parameter for the selected model (GamePilot 3 `thinkingLevel`, GamePilot 2.5 `thinkingBudget`). Unknown models emit a one-line note to stderr and pass through unchanged. The local GamePilot CLI does not expose a per-invocation thinking override yet, so the flag is parsed and validated but emits a one-shot stderr warning and falls back to the CLI's default reasoning. Configure `thinkingConfig` at the model-alias level in your GamePilot `settings.json` for a persistent setting that takes effect today.

### Live progress in the terminal

Foreground runs emit progress to **stderr** so stdout stays a single final write (safe for `--json`, pipe-friendly for wrappers).

By default, progress uses compact markers:

```text
[session] created
[tool] read_file
.....                        (one '.' per model chunk)
[thinking]                   (one per thought chunk; raw thought text never shown)
[tool] write_file
[file] write plugins/x.mjs
[done] 1.2s | 2 tools | 1 file | 14 chunks | 1 thought
```

Pass `--stream-output` to upgrade to raw passthrough — every message chunk and every thought chunk is written to stderr as it arrives:

```text
[session] created
[tool] read_file
Here's what I found in the file...
thought: Let me think about the approach.
[tool] write_file
```

### Background jobs: `/gpc:status` event tail

For `--background` runs, `/gpc:status` renders the tail of recent events per active job:

```text
Running jobs (1):
  job_abc123  task  running  2s ago
    last event: model_text_chunk 85 chars - 200ms ago
    recent:
      [phase] session_created          2.1s ago
      [tool_call] read_file            1.8s ago
      [model_text_chunk] 140 chars     1.2s ago
      [model_thought_chunk] 62 chars   900ms ago
      [model_text_chunk] 85 chars      200ms ago
    totals: chunks=3  thoughts=1  tools=1  files=0
```

### Privacy

Raw model prose and raw thought text are **never persisted** to job files or to the status view. Only sanitized metadata (character counts, tool names, file paths) lands in the event log. Raw chunks appear live in stderr only, and only when you opt in with `--stream-output`.

## Typical Flows

### Review Before Shipping

```bash
/gpc:review
```

### Hand A Problem To GamePilot

```bash
/gpc:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/gpc:rescue --background redesign the error handling across the API layer
/gpc:status
```

## Differences from gemini-plugin-cc

This plugin is ported from [gemini-plugin-cc](https://github.com/sakibsadmanshajib/gemini-plugin-cc), which wraps Google's Gemini CLI and traces back to [codex-plugin-cc](https://github.com/openai/codex-plugin-cc). The plugins share the same command interface, plugin structure, ACP transport, and job lifecycle, but differ in the backend CLI and provider-specific setup.

### Protocol

| Aspect | gemini-plugin-cc | gamepilot-plugin-cc |
|--------|----------------|-----------------|
| **Backend CLI** | `gemini` (Google Gemini CLI) | `gpc` (GamePilot CLI) |
| **Protocol** | Agent Client Protocol (ACP) — JSON-RPC 2.0 over stdio | Agent Client Protocol (ACP) — JSON-RPC 2.0 over stdio |
| **Connection** | Persistent broker over Unix socket (`gemini --experimental-acp`) | Persistent broker over Unix socket (`gpc --acp`) |
| **Model selection** | Gemini model aliases and CLI settings | GamePilot Studio-configured model ids |
| **Thinking config** | Parsed by the plugin; effective behavior depends on Gemini CLI settings | Parsed by the plugin; effective behavior depends on GamePilot settings |
| **Authentication** | Google accounts or Gemini API keys | Google accounts or GamePilot API keys from AI Studio |

### What this means in practice

- **Same commands**: Both plugins expose equivalent slash commands (`review`, `adversarial-review`, `rescue`, `status`, `result`, `cancel`, `setup`) under their own namespaces.
- **Same review logic**: Diff collection, untracked file reading, branch comparison, and prompt construction are shared.
- **Same transport shape**: Both plugins use an ACP broker over Unix sockets, but start different backend commands.
- **Different model configuration**: GamePilot uses `--model <model-id>` for Studio-configured models and relies on GamePilot settings for persistent thinking behavior.
- **Different authentication checks**: Setup validates the local GamePilot CLI and its supported account or API-key authentication.

### Why a port instead of a fork?

The Gemini plugin's architecture (command definitions, job tracking, state persistence, background workers, ACP broker, and review prompt construction) maps closely to GamePilot. Porting it required replacing the backend-specific CLI integration and setup checks while keeping the shared Claude Code plugin workflow intact.

## GamePilot Integration

The plugin communicates with GamePilot CLI via **ACP** (Agent Client Protocol) — a JSON-RPC 2.0 interface over stdio. A persistent broker process keeps the connection alive across multiple commands within a Claude Code session.

### Common Configurations

If you want to change the settings, configure them in your GamePilot settings file:

**User-level:** `~/.gamepilot/settings.json`

```jsonc
{
 "general": {
    "locale": "en-US"
  }
}
```

**Project-level:** `.gamepilot/settings.json` (overrides user settings)

Your configuration will be picked up based on:

- user-level config in `~/.gamepilot/settings.json`
- project-level overrides in `.gamepilot/settings.json`

### Authentication Methods

| Method | Setup | Best For | Tested |
|--------|-------|----------|--------|
| Sign in with CES | `gpc` (interactive) | Desktop use | Yes |

### Moving The Work Over To GamePilot

Delegated tasks and any review gate runs can be directly resumed inside GamePilot by running `gpc --resume` with the session ID from `/gpc:result` or `/gpc:status`.

## Architecture

```
Claude Code ──[Bash]──> gamepilot-companion.mjs ──[Unix socket]──> ACP Broker
                                                                    |
                                                              gpc --acp
                                                              (persistent)
```

- **gamepilot-companion.mjs** — Main CLI handling all subcommands
- **acp-broker.mjs** — Persistent daemon multiplexing JSON-RPC requests via Unix socket
- **acp-client.mjs** — Client with broker-first, direct-spawn fallback
- **lib modules** — Git context, state persistence, job tracking, rendering

## FAQ

### Do I need a separate GamePilot account for this plugin?

If you are already signed into GamePilot on this machine, that account should work immediately. This plugin uses your local GamePilot CLI authentication.

If you only use Claude Code today and have not used GamePilot yet, you will also need to authenticate. The free tier (Sign in with Google) gives you 60 requests per minute and 1,000 per day. Run `!gpc` inside Claude Code to authenticate interactively.

### Does the plugin use a separate GamePilot runtime?

The plugin starts GamePilot in ACP mode (`gpc --acp`) and communicates via JSON-RPC. A broker process keeps the connection alive for the duration of your Claude Code session and is automatically cleaned up when the session ends.

### Will it use the same GamePilot config I already have?

Yes. The plugin inherits your `~/.gamepilot/settings.json` and any project-level `.gamepilot/settings.json` overrides.

## License

[MIT](LICENSE) for GamePilot contributions. This project is derived from
[codex-plugin-cc](https://github.com/openai/codex-plugin-cc) (OpenAI,
[Apache-2.0](LICENSE-APACHE)) via
[gemini-plugin-cc](https://github.com/sakibsadmanshajib/gemini-plugin-cc)
(Sakib Sadman Shajib, MIT). See [NOTICE](NOTICE) for full attribution.

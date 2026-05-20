#!/usr/bin/env node

/**
 * GamePilot Companion — main CLI entry point for the gamepilot-plugin-cc Claude Code plugin.
 *
 * Subcommands:
 *   setup                Check GamePilot CLI availability, auth, toggle review gate
 *   review               Run a code review via GamePilot
 *   adversarial-review   Run a steerable adversarial review
 *   task                 Run an arbitrary task via GamePilot (foreground)
 *   task-worker          Background job worker (internal)
 *   status               List jobs
 *   result               Show job result
 *   cancel               Cancel a job
 *   task-resume-candidate  Find a resumable task (internal)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseCommandInput, splitRawArgumentString } from "./lib/args.mjs";
import {
  buildPersistentTaskThreadName,
  DEFAULT_CONTINUE_PROMPT,
  findLatestTaskThread,
  getGamePilotAuthStatus,
  getGamePilotAvailability,
  getSessionRuntimeStatus,
  interruptAcpPrompt,
  parseStructuredOutput,
  readOutputSchema,
  runAcpAdversarialReview,
  runAcpPrompt,
  runAcpReview
} from "./lib/gamepilot.mjs";
import { getConfig, loadState, readJobFile, saveState, setConfig } from "./lib/state.mjs";
import {
  createTrackedJob,
  runTrackedJob,
  SESSION_ID_ENV,
  updateJobPhase
} from "./lib/tracked-jobs.mjs";
import { recordForegroundReviewResult } from "./lib/foreground-results.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  resolveCancelableJob,
  resolveResultJob
} from "./lib/job-control.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import {
  outputCommandResult,
  renderCancelReport,
  renderResultOutput,
  renderReviewResult,
  renderSetupReport,
  renderSingleJobStatus,
  renderStatusSnapshot
} from "./lib/render.mjs";
import { THINKING_LEVELS } from "./lib/thinking.mjs";
import { createStreamHandler } from "./lib/stream-output.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEW_SCHEMA = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;
const STOP_REVIEW_TASK_MARKER = "Run a stop-gate review of the previous Claude turn.";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/gamepilot-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/gamepilot-companion.mjs review [native-/review-target-or-flags] [--background]",
      "  node scripts/gamepilot-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model-id>] [--thinking <off|low|medium|high>] [--stream-output] [focus text...]",
      "  node scripts/gamepilot-companion.mjs task [--write] [--model <model-id>] [--thinking <off|low|medium|high>] [--approval-mode <mode>] [--stream-output] [--background|--wait] [--resume-last] [--json] -- <prompt>",
      "  node scripts/gamepilot-companion.mjs task-worker <job-id>",
      "  node scripts/gamepilot-companion.mjs status [job-id] [--wait] [--timeout-ms <ms>] [--all] [--json]",
      "  node scripts/gamepilot-companion.mjs result [job-id] [--json]",
      "  node scripts/gamepilot-companion.mjs cancel [job-id] [--json]",
      "  node scripts/gamepilot-companion.mjs task-resume-candidate [--json]"
    ].join("\n")
  );
}

function resolveCommandCwd(options) {
  return options.cwd ? path.resolve(options.cwd) : (process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}

function resolveThinkingOption(options) {
  if (options.thinking === undefined) {
    return undefined;
  }
  if (!THINKING_LEVELS.includes(options.thinking)) {
    process.stderr.write(`Error: invalid --thinking value: ${options.thinking}. Expected one of ${THINKING_LEVELS.join(", ")}.\n`);
    printUsage();
    process.exit(1);
  }
  return options.thinking;
}

function createStderrStreamHandler(options) {
  return createStreamHandler({
    mode: options["stream-output"] ? "passthrough" : "markers",
    json: Boolean(options.json),
    writer: (s) => process.stderr.write(s)
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });

  const cwd = resolveCommandCwd(options);

  // Toggle review gate if requested.
  if (options["enable-review-gate"]) {
    await setConfig(cwd, { stopReviewGate: true });
  } else if (options["disable-review-gate"]) {
    await setConfig(cwd, { stopReviewGate: false });
  }

  const { available, version } = getGamePilotAvailability();
  const npmAvailable = binaryAvailable("npm");
  const config = getConfig(cwd);

  let authenticated = false;
  let authMethod = null;

  if (available) {
    const auth = await getGamePilotAuthStatus(cwd);
    authenticated = auth.authenticated;
    authMethod = auth.method;
  }

  const report = {
    gamepilotAvailable: available,
    gamepilotVersion: version,
    authenticated,
    authMethod,
    npmAvailable,
    reviewGate: config.stopReviewGate,
    message: !available
      ? "GamePilot CLI is not installed. Install with: npm install -g @google/gamepilot-cli"
      : !authenticated
        ? "GamePilot CLI is installed but not authenticated. Run `!gpc` to authenticate interactively, or set GAMEPILOT_API_KEY."
        : null
  };

  const rendered = renderSetupReport(report);
  outputCommandResult(report, rendered, options.json);
}

// ─── Review ───────────────────────────────────────────────────────────────────

function parseReviewPassthroughArgs(argv) {
  const tokens = argv.length === 1 && typeof argv[0] === "string"
    ? splitRawArgumentString(argv[0])
    : [...argv];
  const targetTokens = [];
  let background = false;
  for (const token of tokens) {
    if (token === "--background") {
      background = true;
    } else {
      targetTokens.push(token);
    }
  }
  return { background, target: targetTokens.join(" ").trim() };
}

async function handleReview(argv) {
  const { background, target } = parseReviewPassthroughArgs(argv);
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  if (background) {
    return runReviewInBackground(workspaceRoot, { target }, "review");
  }

  const result = await runAcpReview(cwd, { target });

  if (result.error) {
    process.stderr.write(`Review failed: ${result.error?.message ?? result.error}\n`);
    process.exit(1);
  }

  const payload = {
    scope: result.scope,
    summary: result.summary,
    review: result.text,
    sessionId: result.sessionId
  };

  await recordForegroundReviewResult(workspaceRoot, {
    kind: "review",
    title: `review: ${target || "auto"} review`,
    request: { target },
    threadId: result.sessionId,
    payload: {
      rawOutput: result.text,
      scope: result.scope,
      summary: result.summary
    },
    rendered: result.text,
    summary: result.summary ?? result.text.slice(0, 120).replace(/\n/g, " ").trim()
  });

  outputCommandResult(payload, result.text, false);
}

// ─── Adversarial Review ───────────────────────────────────────────────────────

async function handleReviewCommand(argv, { reviewName }) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd", "thinking"],
    booleanOptions: ["json", "wait", "background", "stream-output"]
  });

  const thinking = resolveThinkingOption(options);
  const streamHandler = createStderrStreamHandler(options);

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const focus = positionals.join(" ").trim() || undefined;

  if (options.background) {
    return runReviewInBackground(workspaceRoot, { ...options, focus, thinking }, "adversarial-review");
  }

  const result = await runAcpAdversarialReview(cwd, {
    scope: options.scope,
    base: options.base,
    model: options.model,
    focus,
    schemaPath: REVIEW_SCHEMA,
    thinking,
    onStream: streamHandler,
    streamThoughtText: Boolean(options["stream-output"])
  });

  if (result.error) {
    process.stderr.write(`${reviewName} failed: ${result.error?.message ?? result.error}\n`);
    process.exit(1);
  }

  const rendered = result.parsed ? renderReviewResult(result.parsed) : result.text;
  const payload = result.parsed ?? { raw: result.text };
  await recordForegroundReviewResult(workspaceRoot, {
    kind: "adversarial-review",
    title: `adversarial-review: ${options.scope || "auto"} review`,
    request: {
      scope: options.scope,
      base: options.base,
      model: options.model,
      focus,
      thinking
    },
    threadId: result.sessionId,
    payload: result.parsed ? { ...result.parsed, rawOutput: result.text } : { rawOutput: result.text },
    rendered,
    summary: result.parsed?.summary ?? result.text.slice(0, 120).replace(/\n/g, " ").trim()
  });

  outputCommandResult(payload, rendered, options.json);
}

// ─── Task ─────────────────────────────────────────────────────────────────────

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "approval-mode", "cwd", "thinking"],
    booleanOptions: ["json", "write", "background", "wait", "resume-last", "stream-output"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const taskText = positionals.join(" ").trim();

  const thinking = resolveThinkingOption(options);
  const streamHandler = createStderrStreamHandler(options);

  if (!taskText && !options["resume-last"]) {
    process.stderr.write("Error: No task text provided.\n");
    printUsage();
    process.exit(1);
  }

  const model = options.model;
  const approvalMode = options.write ? "auto_edit" : (options["approval-mode"] ?? "default");

  // Handle resume.
  let prompt = taskText || DEFAULT_CONTINUE_PROMPT;
  let sessionId = null;
  if (options["resume-last"]) {
    const candidate = await findLatestTaskThread(cwd);
    if (candidate) {
      sessionId = candidate.id;
      process.stderr.write(`Resuming GamePilot session: ${sessionId}\n`);
    } else {
      process.stderr.write("No resumable GamePilot session found. Starting fresh.\n");
    }
  }

  if (options.background) {
    return runTaskInBackground(workspaceRoot, {
      prompt,
      model,
      approvalMode,
      sessionId,
      thinking,
      json: options.json
    });
  }

  // Foreground execution.
  const job = await createTrackedJob({
    workspaceRoot,
    kind: "task",
    title: buildPersistentTaskThreadName(prompt)
  });

  process.stderr.write(`GamePilot task started: ${job.id}\n`);

  try {
    const execution = await runTrackedJob(job, async () => {
      await updateJobPhase(workspaceRoot, job.id, "running");

      const startTime = Date.now();
      const result = await runAcpPrompt(cwd, prompt, {
        model,
        approvalMode,
        sessionId,
        thinking,
        onStream: streamHandler,
        streamThoughtText: Boolean(options["stream-output"])
      });

      if (result.error) {
        throw result.error;
      }

      streamHandler({
        type: "done",
        stats: {
          tools: result.toolCalls?.length ?? 0,
          files: result.fileChanges?.length ?? 0,
          chunks: result.chunkCount ?? 0,
          thoughts: result.thoughtCount ?? 0,
          elapsedMs: Date.now() - startTime
        }
      });

      const rendered = result.text;
      const summary = rendered.slice(0, 120).replace(/\n/g, " ").trim();

      return {
        exitStatus: 0,
        threadId: result.sessionId,
        payload: {
          rawOutput: result.text,
          fileChanges: result.fileChanges,
          toolCalls: result.toolCalls
        },
        rendered,
        summary
      };
    });

    outputCommandResult(
      { jobId: job.id, threadId: execution.threadId, text: execution.rendered },
      execution.rendered,
      options.json
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Task failed: ${message}\n`);
    process.exit(1);
  }
}

// ─── Task Worker (Background) ─────────────────────────────────────────────────

async function handleTaskWorker(argv) {
  const jobId = argv[0];
  if (!jobId) {
    process.stderr.write("Error: Missing job ID.\n");
    process.exit(1);
  }

  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const storedJob = readJobFile(workspaceRoot, jobId);

  if (!storedJob) {
    process.stderr.write(`Error: Job ${jobId} not found.\n`);
    process.exit(1);
  }

  const request = storedJob.request ?? {};
  const jobKind = storedJob.kind ?? "task";

  try {
    await runTrackedJob(storedJob, async () => {
      await updateJobPhase(workspaceRoot, jobId, "running");

      const jobObserver = { workspaceRoot, jobId };

      let result;
      if (jobKind === "review") {
        result = await runAcpReview(cwd, {
          target: request.target,
          jobObserver
        });
      } else if (jobKind === "adversarial-review") {
        result = await runAcpAdversarialReview(cwd, {
          scope: request.scope,
          base: request.base,
          model: request.model,
          focus: request.focus,
          thinking: request.thinking,
          jobObserver
        });
      } else {
        result = await runAcpPrompt(cwd, request.prompt, {
          model: request.model,
          approvalMode: request.approvalMode ?? "default",
          sessionId: request.sessionId,
          thinking: request.thinking,
          jobObserver
        });
      }

      if (result.error) {
        throw result.error;
      }

      const summary = (result.text ?? "").slice(0, 120).replace(/\n/g, " ").trim();

      return {
        exitStatus: 0,
        threadId: result.sessionId,
        payload: {
          rawOutput: result.text,
          fileChanges: result.fileChanges,
          toolCalls: result.toolCalls
        },
        rendered: result.text,
        summary
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Background task failed: ${message}\n`);
    process.exit(1);
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["timeout-ms", "cwd"],
    booleanOptions: ["json", "wait", "all"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;

  if (reference) {
    const snapshot = buildSingleJobSnapshot(cwd, reference);
    const rendered = renderSingleJobStatus(snapshot);
    outputCommandResult(snapshot, rendered, options.json);
    return;
  }

  if (options.wait) {
    const timeoutMs = Number(options["timeout-ms"]) || DEFAULT_STATUS_WAIT_TIMEOUT_MS;
    await waitForActiveJobs(cwd, timeoutMs, options.json);
    return;
  }

  const snapshot = buildStatusSnapshot(cwd, { env: process.env });
  const rendered = renderStatusSnapshot(snapshot);
  outputCommandResult(snapshot, rendered, options.json);
}

async function waitForActiveJobs(cwd, timeoutMs, json) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = buildStatusSnapshot(cwd, { env: process.env });
    if (snapshot.running.length === 0) {
      const rendered = renderStatusSnapshot(snapshot);
      outputCommandResult(snapshot, rendered, json);
      return;
    }

    process.stderr.write(`Waiting for ${snapshot.running.length} active job(s)...\n`);
    await new Promise((r) => setTimeout(r, DEFAULT_STATUS_POLL_INTERVAL_MS));
  }

  const snapshot = buildStatusSnapshot(cwd, { env: process.env });
  const rendered = renderStatusSnapshot(snapshot);
  outputCommandResult(snapshot, rendered, json);
}

// ─── Result ───────────────────────────────────────────────────────────────────

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readJobFile(workspaceRoot, job.id);

  const rendered = renderResultOutput(cwd, job, storedJob);
  const payload = {
    jobId: job.id,
    status: job.status,
    threadId: storedJob?.threadId ?? job.threadId ?? null,
    result: storedJob?.result ?? null,
    rendered
  };

  outputCommandResult(payload, rendered, options.json);
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? null;
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);

  // Try to interrupt the ACP prompt if there's a session.
  const interrupt = await interruptAcpPrompt(cwd, {
    sessionId: job.threadId
  });

  // Update job state.
  const state = loadState(workspaceRoot);
  const jobIndex = state.jobs.findIndex((j) => j.id === job.id);
  if (jobIndex >= 0) {
    state.jobs[jobIndex] = {
      ...state.jobs[jobIndex],
      status: "cancelled",
      phase: "cancelled",
      completedAt: new Date().toISOString()
    };
  }
  await saveState(workspaceRoot, state);

  // Kill the process if we have a PID.
  if (job.pid) {
    try {
      terminateProcessTree(job.pid);
    } catch {
      // Ignore.
    }
  }

  const nextJob = {
    ...job,
    status: "cancelled"
  };

  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title,
    turnInterruptAttempted: interrupt.attempted,
    turnInterrupted: interrupt.interrupted
  };

  outputCommandResult(payload, renderCancelReport(nextJob), options.json);
}

// ─── Resume Candidate ─────────────────────────────────────────────────────────

async function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const candidate = await findLatestTaskThread(cwd);
  const payload = candidate ?? { id: null, status: null };
  const rendered = candidate
    ? `Resumable task found: ${candidate.id} (${candidate.status}).\n`
    : "No resumable task found for this session.\n";
  outputCommandResult(payload, rendered, options.json);
}

// ─── Background Helpers ───────────────────────────────────────────────────────

async function runReviewInBackground(workspaceRoot, options, kind) {
  const titleTarget = options.target || options.scope || "auto";
  const job = await createTrackedJob({
    workspaceRoot,
    kind,
    title: `${kind}: ${titleTarget} review`,
    request: {
      target: options.target,
      scope: options.scope,
      base: options.base,
      model: options.model,
      focus: options.focus,
      thinking: options.thinking
    }
  });

  spawnBackgroundWorker(workspaceRoot, job.id);

  const payload = {
    jobId: job.id,
    status: "queued",
    message: `Background ${kind} started. Run /gpc:status ${job.id} to check progress.`
  };

  outputCommandResult(
    payload,
    `Background ${kind} started: ${job.id}\nRun /gpc:status ${job.id} to check progress.\n`,
    options.json
  );
}

async function runTaskInBackground(workspaceRoot, request) {
  const job = await createTrackedJob({
    workspaceRoot,
    kind: "task",
    title: buildPersistentTaskThreadName(request.prompt),
    request
  });

  spawnBackgroundWorker(workspaceRoot, job.id);

  const payload = {
    jobId: job.id,
    status: "queued",
    message: `Background task started. Run /gpc:status ${job.id} to check progress.`
  };

  outputCommandResult(
    payload,
    `Background task started: ${job.id}\nRun /gpc:status ${job.id} to check progress.\n`,
    request.json
  );
}

function spawnBackgroundWorker(workspaceRoot, jobId) {
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn("node", [scriptPath, "task-worker", jobId], {
    cwd: workspaceRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env
  });
  child.unref();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "review":
      await handleReview(argv);
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, {
        reviewName: "Adversarial Review"
      });
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    case "task-resume-candidate":
      await handleTaskResumeCandidate(argv);
      break;
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      printUsage();
      process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

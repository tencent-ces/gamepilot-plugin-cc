import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "gamepilot");
const COMPANION_SCRIPT = path.join(PLUGIN_ROOT, "scripts", "gamepilot-companion.mjs");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("review command is a deterministic direct-execution entrypoint", () => {
  const source = read("commands/review.md");
  assert.match(source, /disable-model-invocation:\s*true/);
  assert.match(source, /gamepilot-companion\.mjs" review "\$ARGUMENTS"/);
  assert.match(source, /Do not paraphrase, summarize, or add your own commentary/i);
  assert.match(source, /Do not make any code changes/i);
  assert.match(source, /\[--base <ref>\]/);
  assert.match(source, /\[--scope <auto\|working-tree\|branch>\]/);
});

test("adversarial review command is a deterministic direct-execution entrypoint", () => {
  const source = read("commands/adversarial-review.md");
  assert.match(source, /disable-model-invocation:\s*true/);
  assert.match(source, /gamepilot-companion\.mjs" adversarial-review "\$ARGUMENTS"/);
  assert.match(source, /Do not paraphrase, summarize, or add your own commentary/i);
  assert.match(source, /Do not make any code changes/i);
  assert.match(source, /Do not fix any issues/i);
  assert.match(source, /\[--base <ref>\]/);
  assert.match(source, /\[--scope <auto\|working-tree\|branch>\]/);
});

test("command files match expected set", () => {
  const commandFiles = fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "cancel.md",
    "rescue.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md"
  ]);
});

test("rescue command uses inline execution without subagent delegation", () => {
  const rescue = read("commands/rescue.md");
  const agent = read("agents/gamepilot-rescue.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const runtimeSkill = read("skills/gamepilot-cli-runtime/SKILL.md");

  assert.match(rescue, /allowed-tools:\s*Bash\(node:\*\),\s*AskUserQuestion/);
  assert.match(rescue, /--background\|--wait/);
  assert.match(rescue, /--resume\|--fresh/);
  assert.match(rescue, /--model <model-id>/);
  assert.match(rescue, /--thinking <off\|low\|medium\|high>/);
  assert.match(rescue, /--stream-output/);
  assert.match(rescue, /task-resume-candidate --json/);
  assert.match(rescue, /AskUserQuestion/);
  assert.match(rescue, /Continue current GamePilot thread/);
  assert.match(rescue, /Start a new GamePilot thread/);
  assert.match(rescue, /default to foreground/i);
  assert.match(rescue, /Do not forward them to `task`/i);
  assert.match(rescue, /`--model`, `--thinking`, and `--stream-output` are runtime-selection flags/i);
  assert.match(rescue, /Leave `--thinking` unset unless the user explicitly asks/i);
  assert.match(rescue, /Leave `--model` unset unless the user explicitly names a model/i);
  assert.match(rescue, /GamePilot Studio LLM settings/i);
  assert.match(rescue, /does not resolve aliases/i);
  assert.match(rescue, /If the request includes `--resume`, do not ask whether to continue/i);
  assert.match(rescue, /If the request includes `--fresh`, do not ask whether to continue/i);
  assert.match(rescue, /thin forwarding wrapper/i);
  assert.match(rescue, /Return the GamePilot companion stdout verbatim to the user/i);
  assert.match(rescue, /Do not paraphrase, summarize, rewrite, or add commentary before or after it/i);
  assert.match(rescue, /return that command's stdout as-is/i);
  assert.match(rescue, /Do not spawn subagents, do not invoke skills/i);
  assert.match(rescue, /Default to a write-capable GamePilot run by adding `--write`/i);
  assert.match(agent, /--resume/);
  assert.match(agent, /--fresh/);
  assert.match(agent, /thin forwarding wrapper/i);
  assert.match(agent, /prefer foreground for a small, clearly bounded rescue request/i);
  assert.match(agent, /Use exactly one `Bash` call/i);
  assert.match(agent, /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i);
  assert.match(agent, /Do not call `review`, `adversarial-review`, `status`, `result`, or `cancel`/i);
  assert.match(agent, /Leave `--thinking` unset unless the user explicitly requests a specific thinking level/i);
  assert.match(agent, /Leave `--model` unset unless the user explicitly asks for a model/i);
  assert.match(agent, /GamePilot Studio LLM settings/i);
  assert.match(agent, /forwards the value as-is/i);
  assert.match(agent, /Return the stdout of the `gamepilot-companion` command exactly as-is/i);
  assert.match(agent, /If the Bash call fails or GamePilot cannot be invoked, return nothing/i);
  assert.match(agent, /gamepilot-prompting/);
  assert.match(agent, /only to tighten the user's request into a better GamePilot prompt/i);
  assert.match(agent, /Do not use that skill to inspect the repository, reason through the problem yourself, draft a solution, or do any independent work/i);
  assert.match(runtimeSkill, /gamepilot-companion\.mjs" task/);
  assert.match(runtimeSkill, /--resume-last/);
  assert.match(readme, /`gpc:gamepilot-rescue` subagent/i);
  assert.match(readme, /if you pass `--model <model-id>`, use a model name configured in GamePilot Studio LLM settings/i);
  assert.match(readme, /if you do not pass `--model`, GamePilot CLI uses its configured default model/i);
  assert.match(readme, /### `\/gpc:setup`/);
  assert.match(readme, /### `\/gpc:review`/);
  assert.match(readme, /### `\/gpc:adversarial-review`/);
  assert.match(readme, /uses the same review target selection as `\/gpc:review`/i);
  assert.match(readme, /--base main challenge whether this was the right caching and retry design/);
  assert.match(readme, /### `\/gpc:rescue`/);
  assert.match(readme, /### `\/gpc:status`/);
  assert.match(readme, /### `\/gpc:result`/);
  assert.match(readme, /### `\/gpc:cancel`/);
});

test("result and cancel commands are exposed as deterministic runtime entrypoints", () => {
  const result = read("commands/result.md");
  const cancel = read("commands/cancel.md");
  const resultHandling = read("skills/gamepilot-result-handling/SKILL.md");

  assert.match(result, /disable-model-invocation:\s*true/);
  assert.match(result, /gamepilot-companion\.mjs" result "\$ARGUMENTS"/);
  assert.match(cancel, /disable-model-invocation:\s*true/);
  assert.match(cancel, /gamepilot-companion\.mjs" cancel "\$ARGUMENTS"/);
  assert.match(resultHandling, /do not turn a failed or incomplete GamePilot run into a Claude-side implementation attempt/i);
  assert.match(resultHandling, /if GamePilot was never successfully invoked, do not generate a substitute answer at all/i);
});

test("internal docs use task terminology for rescue runs", () => {
  const runtimeSkill = read("skills/gamepilot-cli-runtime/SKILL.md");
  const promptingSkill = read("skills/gamepilot-prompting/SKILL.md");
  const promptRecipes = read("skills/gamepilot-prompting/references/gamepilot-prompt-recipes.md");

  assert.match(runtimeSkill, /gamepilot-companion\.mjs" task/);
  assert.match(runtimeSkill, /--resume-last/);
  assert.match(promptingSkill, /GamePilot/);
  assert.match(promptRecipes, /GamePilot task prompts/i);
});

test("hooks keep session-end cleanup and stop gating enabled", () => {
  const source = read("hooks/hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /SessionEnd/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
});

test("setup command points users to GamePilot download and still points users to gpc auth", () => {
  const setup = read("commands/setup.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(setup, /argument-hint:\s*'\[--enable-review-gate\|--disable-review-gate\]'/);
  assert.doesNotMatch(setup, /AskUserQuestion/);
  assert.doesNotMatch(setup, /npm install -g @google\/gamepilot-cli/);
  assert.match(setup, /https:\/\/ai\.levelinfinite\.com\/dev/);
  assert.match(setup, /gamepilot-companion\.mjs" setup --json "\$ARGUMENTS"/);
  assert.match(setup, /GAMEPILOT_API_KEY/);
  assert.match(readme, /!gpc/);
  assert.match(readme, /download and install.*https:\/\/ai\.levelinfinite\.com\/dev/i);
  assert.match(readme, /\/gpc:setup --enable-review-gate/);
  assert.match(readme, /\/gpc:setup --disable-review-gate/);
});

test("companion command handlers use raw command argument parsing", () => {
  const source = fs.readFileSync(COMPANION_SCRIPT, "utf8");

  assert.match(source, /import \{ parseCommandInput \} from "\.\/lib\/args\.mjs"/);
  assert.doesNotMatch(source, /\bparseArgs\(/);
});

test("status command preserves health and last-progress fields when rendering", () => {
  const status = read("commands/status.md");

  assert.match(status, /Health/);
  assert.match(status, /Last Progress/);
  assert.match(status, /recommended action|recommendedAction/i);
});

test("README documents /gpc:status job health details and recommended actions", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(readme, /Health/);
  assert.match(readme, /Last Progress/);
  assert.match(readme, /active/);
  assert.match(readme, /quiet/);
  assert.match(readme, /possibly_stalled/);
  assert.match(readme, /rate_limited/);
  assert.match(readme, /auth_required/);
  assert.match(readme, /broker_unhealthy/);
  assert.match(readme, /worker_missing/);
  assert.match(readme, /failed/);
  assert.match(readme, /completed/);
  assert.match(readme, /cancelled/);
});

test("gamepilot-cli-runtime skill documents every job health label and recommended action", () => {
  const runtimeSkill = read("skills/gamepilot-cli-runtime/SKILL.md");

  const labels = [
    "active",
    "quiet",
    "possibly_stalled",
    "rate_limited",
    "auth_required",
    "broker_unhealthy",
    "worker_missing",
    "failed",
    "completed",
    "cancelled"
  ];
  for (const label of labels) {
    assert.match(runtimeSkill, new RegExp(label), `expected health label ${label} documented in runtime skill`);
  }
  assert.match(runtimeSkill, /health/i);
});

test("gamepilot-result-handling skill forbids fabricating results for incomplete jobs", () => {
  const resultHandling = read("skills/gamepilot-result-handling/SKILL.md");

  assert.match(resultHandling, /do not fabricate|do not invent|never fabricate/i);
  assert.match(resultHandling, /incomplete|non-terminal|still running|in progress/i);
  assert.match(resultHandling, /\/gamepilot:(status|cancel|result)/);
});

test("companion task rejects an invalid --thinking value with exit 1 and usage", () => {
  const cwd = makeTempDir();
  initGitRepo(cwd);
  const result = run(process.execPath, [COMPANION_SCRIPT, "task", "--thinking", "purple", "--", "noop"], {
    cwd,
    env: { ...process.env, PATH: process.env.PATH }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid --thinking value/i);
  assert.match(result.stderr, /off.*low.*medium.*high/);
});

test("companion --help mentions --thinking and --stream-output", () => {
  const result = run(process.execPath, [COMPANION_SCRIPT, "--help"], {});
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--thinking <off\|low\|medium\|high>/);
  assert.match(result.stdout, /--stream-output/);
});

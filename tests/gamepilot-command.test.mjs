import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGamePilotInvocation,
  resolveGamePilotCommand,
  splitCommand
} from "../plugins/gamepilot/scripts/lib/gamepilot-command.mjs";

test("resolveGamePilotCommand defaults to gpc", () => {
  assert.deepEqual(resolveGamePilotCommand({}), {
    command: "gpc",
    baseArgs: [],
    display: "gpc"
  });
});

test("resolveGamePilotCommand accepts node start.js override", () => {
  assert.deepEqual(
    resolveGamePilotCommand({
      GAMEPILOT_CLI_COMMAND: "node /Users/dev/gamepilot-cli/scripts/start.js"
    }),
    {
      command: "node",
      baseArgs: ["/Users/dev/gamepilot-cli/scripts/start.js"],
      display: "node /Users/dev/gamepilot-cli/scripts/start.js"
    }
  );
});

test("buildGamePilotInvocation appends args after override base args", () => {
  assert.deepEqual(
    buildGamePilotInvocation(["--acp"], {
      GAMEPILOT_CLI_COMMAND: "node /repo/scripts/start.js"
    }),
    {
      command: "node",
      args: ["/repo/scripts/start.js", "--acp"],
      display: "node /repo/scripts/start.js --acp"
    }
  );
});

test("splitCommand supports quotes and escaped whitespace", () => {
  assert.deepEqual(
    splitCommand("node '/repo with spaces/scripts/start.js' --flag\\ value"),
    ["node", "/repo with spaces/scripts/start.js", "--flag value"]
  );
});

test("splitCommand rejects unterminated quotes", () => {
  assert.throws(
    () => splitCommand("node '/repo/scripts/start.js"),
    /Unterminated quote in GAMEPILOT_CLI_COMMAND/
  );
});

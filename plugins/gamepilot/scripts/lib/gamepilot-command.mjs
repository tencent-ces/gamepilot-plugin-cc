/**
 * Resolve the local GamePilot CLI command.
 *
 * GAMEPILOT_CLI_COMMAND is intentionally split with a small shell-like parser so
 * local source checkouts can be used without changing PATH, e.g.:
 * GAMEPILOT_CLI_COMMAND="node /path/to/gamepilot-cli/scripts/start.js"
 */

export const GAMEPILOT_CLI_COMMAND_ENV = "GAMEPILOT_CLI_COMMAND";

/**
 * Split a command string into argv tokens without invoking a shell.
 * Supports whitespace, single quotes, double quotes, and backslash escaping.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function splitCommand(value) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const ch of String(value ?? "")) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (escaping) {
    current += "\\";
  }
  if (quote) {
    throw new Error(`Unterminated quote in ${GAMEPILOT_CLI_COMMAND_ENV}.`);
  }
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ command: string, baseArgs: string[], display: string }}
 */
export function resolveGamePilotCommand(env = process.env) {
  const override = env?.[GAMEPILOT_CLI_COMMAND_ENV]?.trim();
  if (!override) {
    return { command: "gpc", baseArgs: [], display: "gpc" };
  }

  const parts = splitCommand(override);
  if (parts.length === 0) {
    return { command: "gpc", baseArgs: [], display: "gpc" };
  }

  return {
    command: parts[0],
    baseArgs: parts.slice(1),
    display: parts.join(" ")
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ command: string, args: string[], display: string }}
 */
export function buildGamePilotInvocation(args = [], env = process.env) {
  const resolved = resolveGamePilotCommand(env);
  const invocationArgs = [...resolved.baseArgs, ...args];
  return {
    command: resolved.command,
    args: invocationArgs,
    display: [resolved.display, ...args].join(" ")
  };
}

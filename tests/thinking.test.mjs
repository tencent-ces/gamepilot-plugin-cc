import test from "node:test";
import assert from "node:assert/strict";

import { resolveThinkingConfig, THINKING_LEVELS } from "../plugins/gamepilot/scripts/lib/thinking.mjs";

test("THINKING_LEVELS enumerates the four accepted levels in order", () => {
  assert.deepEqual(THINKING_LEVELS, ["off", "low", "medium", "high"]);
});

test("resolveThinkingConfig returns empty config for undefined level (caller omitted flag)", () => {
  const result = resolveThinkingConfig(undefined, "studio-default");
  assert.deepEqual(result, { thinkingLevel: undefined, thinkingBudget: undefined, notes: [] });
});

test("resolveThinkingConfig treats Studio model names as opaque and does not infer budgets", () => {
  for (const level of THINKING_LEVELS) {
    const result = resolveThinkingConfig(level, "studio-fast");
    assert.equal(result.thinkingLevel, undefined);
    assert.equal(result.thinkingBudget, undefined);
    assert.match(result.notes[0], /thinking config not delivered/i);
    assert.match(result.notes[0], /Studio model studio-fast/i);
    assert.match(result.notes[0], /Studio model settings control reasoning/i);
  }
});

test("resolveThinkingConfig does not recognize legacy built-in model aliases", () => {
  const result = resolveThinkingConfig("high", "gamepilot-3-pro");
  assert.equal(result.thinkingLevel, undefined);
  assert.equal(result.thinkingBudget, undefined);
  assert.match(result.notes[0], /Studio model gamepilot-3-pro/i);
});

test("resolveThinkingConfig throws on invalid level", () => {
  assert.throws(() => resolveThinkingConfig("purple", "studio-fast"), /invalid thinking level/i);
});

test("resolveThinkingConfig accepts null modelId", () => {
  const result = resolveThinkingConfig("medium", null);
  assert.deepEqual(result, {
    thinkingLevel: undefined,
    thinkingBudget: undefined,
    notes: ["thinking config not delivered; GamePilot Studio model settings control reasoning"]
  });
});

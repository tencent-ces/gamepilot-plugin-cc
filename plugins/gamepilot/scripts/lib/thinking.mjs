/**
 * Thinking t-shirt sizing resolver.
 *
 * GamePilot model names are configured in GamePilot Studio LLM settings and
 * are opaque to this plugin, so per-model thinking budgets are not inferred.
 */

export const THINKING_LEVELS = ["off", "low", "medium", "high"];

const LEVEL_SET = new Set(THINKING_LEVELS);

/**
 * @typedef {Object} ThinkingConfig
 * @property {"low"|"high"|undefined} thinkingLevel
 * @property {number|undefined} thinkingBudget
 * @property {string[]} notes
 */

/**
 * @param {string|undefined} level
 * @param {string|null|undefined} modelId
 * @returns {ThinkingConfig}
 */
export function resolveThinkingConfig(level, modelId) {
  if (level === undefined) {
    return { thinkingLevel: undefined, thinkingBudget: undefined, notes: [] };
  }
  if (!LEVEL_SET.has(level)) {
    throw new Error(`Invalid thinking level: ${level}. Expected one of ${THINKING_LEVELS.join(", ")}.`);
  }

  const modelLabel = modelId ? ` for Studio model ${modelId}` : "";
  return {
    thinkingLevel: undefined,
    thinkingBudget: undefined,
    notes: [`thinking config not delivered${modelLabel}; GamePilot Studio model settings control reasoning`]
  };
}

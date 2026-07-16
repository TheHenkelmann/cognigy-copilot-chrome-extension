/**
 * Default config overrides applied when Cognigy nodes are created (POST /chart/nodes).
 */
(function ccpNodeCreateDefaultsModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const naming = (CCP.naming = CCP.naming || {});

  if (naming.applyNodeCreateDefaults) {
    return;
  }

  const GOTO_EXECUTE_DEFAULTS = {
    parseIntents: false,
    parseKeyphrases: false,
    absorbContext: true,
  };

  const LLM_PROMPT_DEFAULTS = {
    debugLogTokenCount: true,
    debugLogRequestAndCompletion: true,
    debugLogLLMLatency: true,
    debugLogToolDefinitions: true,
    advancedLogging: false,
    loggingWebhookUrl: "",
    loggingCustomData: "{}",
    loggingHeaders: "{}",
    conditionForLogging: "",
    storeLocation: "input",
    streamStoreCopyInInput: true,
    streamStopTokens: ["\\n\\n", "<p>"],
  };

  const AI_AGENT_TOOL_ANSWER_DEFAULTS = {
    debugToolAnswer: true,
  };

  /**
   * @param {string} nodeType
   * @param {Record<string, unknown>} [config]
   * @returns {Record<string, unknown>}
   */
  function applyNodeCreateDefaults(nodeType, config) {
    const cfg = { ...(config || {}) };
    switch (String(nodeType || "")) {
      case "executeFlow":
      case "goTo":
        return { ...cfg, ...GOTO_EXECUTE_DEFAULTS };
      case "llmPromptV2":
        return { ...cfg, ...LLM_PROMPT_DEFAULTS };
      case "aiAgentToolAnswer":
        return { ...cfg, ...AI_AGENT_TOOL_ANSWER_DEFAULTS };
      default:
        return cfg;
    }
  }

  naming.applyNodeCreateDefaults = applyNodeCreateDefaults;
})();

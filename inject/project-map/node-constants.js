/**
 * Cognigy Project-Map — node-type constants.
 *
 * Ports the Python constants from `cognigy_copilot_code/cognigy_project_map.py`
 * and `cognigy_copilot_code/cognigy_to_structured_json.py` so that all
 * issue-detection helpers and the structured-JSON serializer share the same
 * shape names without sprinkling magic strings across the codebase.
 */
(function ccpProjectMapNodeConstantsModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const pm = (CCP.projectMap = CCP.projectMap || {});

  if (pm.constants) {
    return;
  }

  // Node types whose execution unconditionally terminates the flow path: when
  // the node runs (and is not disabled), Cognigy never follows its outgoing
  // chart edges at runtime. The chart UI still allows next/children wiring
  // after them, which is exactly how dead paths come into existence.
  const DEAD_PATH_TERMINATOR_TYPES = new Set(["goTo", "aiAgentToolAnswer", "stop"]);

  // Node types that are part of the flow shell itself and must never be
  // reported as dead even if structural reachability would suggest so.
  const DEAD_PATH_GUARDED_TYPES = new Set(["start", "end"]);

  // Config keys under which a flow node may store an LLM reference (UUID or
  // the literal `"default"`). A node that uses any of these keys is
  // considered "LLM-capable" for the `llm_default_missing` project-level
  // check.
  const NODE_LLM_REFERENCE_FIELDS = [
    "llmProviderReferenceId",
    "llmEntityExtractLLMProviderReferenceId",
    "repromptLLMProvider",
  ];

  const LLM_DEFAULT_TOKEN = "default";

  // HTTP-request auth → connection-field map. Mirrors
  // `auth_field_by_type` inside `_builtin_per_node_issues`.
  const HTTP_AUTH_FIELD_BY_TYPE = {
    basic: "basicConnection",
    oauth2: "oAuth2Connection",
    apikey: "apiKeyAuthKeyConnection",
  };

  // Built-in container types: parent → set of implied child types.
  // Mirrors `_BUILTIN_PARENT_IMPLIES_CHILDREN` in Python.
  const BUILTIN_PARENT_IMPLIES_CHILDREN = {
    llmPromptV2: new Set(["llmPromptDefault", "llmPromptTool", "aiAgentToolAnswer"]),
    aiAgentJob: new Set(["aiAgentJobDefault", "aiAgentJobTool", "aiAgentToolAnswer"]),
    if: new Set(["then", "else"]),
    switch: new Set(["default", "case"]),
    optionalQuestion: new Set(["onAnswer", "onQuestion"]),
    once: new Set(["onFirstExecution", "afterwards"]),
    triggerFunction: new Set(["onScheduled", "onSchedulingError"]),
  };

  // Built-in container types that trigger chart-sync restraint (align with
  // copilot system rules). Mirrors `CHART_SYNC_PAUSE_BUILTIN_TYPES`.
  const CHART_SYNC_PAUSE_BUILTIN_TYPES = new Set([
    "llmPromptV2",
    "aiAgentJob",
    "if",
    "switch",
    "optionalQuestion",
    "triggerFunction",
  ]);

  pm.constants = {
    DEAD_PATH_TERMINATOR_TYPES,
    DEAD_PATH_GUARDED_TYPES,
    NODE_LLM_REFERENCE_FIELDS,
    LLM_DEFAULT_TOKEN,
    HTTP_AUTH_FIELD_BY_TYPE,
    BUILTIN_PARENT_IMPLIES_CHILDREN,
    CHART_SYNC_PAUSE_BUILTIN_TYPES,
  };
})();

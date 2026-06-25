/**
 * Cognigy node naming engine — rules, label computation, analytics sanitization.
 * Shared by fetch intercept, issue detection, and auto-fix.
 */
(function ccpNamingEngineModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const naming = (CCP.naming = CCP.naming || {});

  if (naming.createEngine) {
    return;
  }

  const NAMING_DELIMITER = "_";
  const OLD_NAMING_DELIMITERS = [":", "."];
  const ANALYTICS_LABEL_PREFIX = "node_";
  const EMIT_CODE_NODE_LABEL = "Emit";
  const FORBIDDEN_ANALYTICS_PATTERN = /[\/:*?"<>|¥!&$§%=»,.;+~#`'°µ€]/g;
  const MAX_ANALYTICS_LENGTH = 128;

  const NAMING_RULES = [
    {
      nodeType: "activateProfile",
      defaultName: "Activate Profile",
      rule: "prefix",
      value: "aPP",
      enabled: true,
    },
    { nodeType: "addToContext", defaultName: "Add To Context", rule: "prefix", value: "aCC", enabled: true },
    { nodeType: "afterwards", defaultName: "Afterwards", rule: "prefix", value: "after", enabled: true },
    {
      nodeType: "aiAgentHandover",
      defaultName: "Handover",
      rule: "custom",
      value: "handle_tool_nodes",
      enabled: true,
    },
    { nodeType: "aiAgentJob", defaultName: "AI Agent", rule: "prefix", value: "Agent", enabled: true },
    { nodeType: "aiAgentJobDefault", defaultName: null, rule: "static", value: "T_default", enabled: true },
    {
      nodeType: "aiAgentJobTool",
      defaultName: null,
      rule: "custom",
      value: "handle_tool_nodes",
      enabled: true,
    },
    {
      nodeType: "aiAgentToolAnswer",
      defaultName: "Resolve Tool Action",
      rule: "prefix",
      value: "RTA",
      enabled: true,
    },
    { nodeType: "case", defaultName: "Case", rule: "custom", value: "handle_case", enabled: true },
    {
      nodeType: "checkAgentAvailability",
      defaultName: null,
      rule: "static",
      value: "checkAgentAvailability",
      enabled: true,
    },
    { nodeType: "code", defaultName: "Code", rule: "prefix", value: "Code", enabled: true },
    {
      nodeType: "completeGoal",
      defaultName: "Complete Task",
      rule: "custom",
      value: "handle_complete_goal",
      enabled: true,
    },
    { nodeType: "datePicker", defaultName: "Datepicker", rule: "prefix", value: "Date", enabled: true },
    {
      nodeType: "deactivateProfile",
      defaultName: "Deactivate Profile",
      rule: "prefix",
      value: "dPP",
      enabled: true,
    },
    { nodeType: "debugMessage", defaultName: "Debug Message", rule: "prefix", value: "🐞", enabled: true },
    { nodeType: "default", defaultName: "Default", rule: "static", value: "C_default", enabled: true },
    {
      nodeType: "deleteProfile",
      defaultName: "Delete Profile",
      rule: "prefix",
      value: "rmPP",
      enabled: true,
    },
    { nodeType: "detectLanguage", defaultName: null, rule: "prefix", value: "Lang", enabled: true },
    { nodeType: "else", defaultName: "Else", rule: "custom", value: "handle_then_else", enabled: true },
    {
      nodeType: "emailNotification",
      defaultName: "Email Notification",
      rule: "prefix",
      value: "MAIL",
      enabled: true,
    },
    { nodeType: "end", defaultName: "End", rule: "custom", value: "handle_start_end", enabled: true },
    {
      nodeType: "executeFlow",
      defaultName: "Execute Flow",
      rule: "custom",
      value: "handle_goto_execute_flow",
      enabled: true,
    },
    { nodeType: "extensions", defaultName: null, rule: "prefix", value: "EXT", enabled: true },
    {
      nodeType: "getTranscript",
      defaultName: "Get Transcript",
      rule: "prefix",
      value: "getT",
      enabled: true,
    },
    {
      nodeType: "goTo",
      defaultName: "Go To",
      rule: "custom",
      value: "handle_goto_execute_flow",
      enabled: true,
    },
    {
      nodeType: "handoverToAgent",
      defaultName: "Handover to Human Agent",
      rule: "prefix",
      value: "HO",
      enabled: true,
    },
    { nodeType: "httpRequest", defaultName: "HTTP Request", rule: "prefix", value: "HTTP", enabled: true },
    { nodeType: "if", defaultName: "If", rule: "custom", value: "handle_if", enabled: true },
    { nodeType: "json", defaultName: null, rule: "prefix", value: "JSON", enabled: true },
    {
      nodeType: "llmEntityExtract",
      defaultName: "LLM Entity Extract",
      rule: "prefix",
      value: "LLMEE",
      enabled: true,
    },
    {
      nodeType: "llmPromptDefault",
      defaultName: "Default",
      rule: "static",
      value: "T_default",
      enabled: true,
    },
    {
      nodeType: "llmPromptTool",
      defaultName: null,
      rule: "custom",
      value: "handle_tool_nodes",
      enabled: true,
    },
    { nodeType: "llmPromptV2", defaultName: "LLM Prompt", rule: "prefix", value: "LLM", enabled: true },
    { nodeType: "log", defaultName: "Log Message", rule: "prefix", value: "🪵", enabled: true },
    { nodeType: "mergeProfile", defaultName: "Merge Profile", rule: "prefix", value: "mPP", enabled: true },
    { nodeType: "onAnswer", defaultName: "On Answer", rule: "static", value: "On Answer", enabled: true },
    {
      nodeType: "onFirstExecution",
      defaultName: "On First Time",
      rule: "prefix",
      value: "oFT",
      enabled: true,
    },
    {
      nodeType: "onQuestion",
      defaultName: "On Question",
      rule: "static",
      value: "On Question",
      enabled: true,
    },
    { nodeType: "once", defaultName: "Once", rule: "prefix", value: "Once", enabled: true },
    {
      nodeType: "optionalQuestion",
      defaultName: "Optional Question",
      rule: "prefix",
      value: "OQ",
      enabled: true,
    },
    {
      nodeType: "overwriteAnalytics",
      defaultName: "Overwrite Analytics",
      rule: "prefix",
      value: "A",
      enabled: true,
    },
    { nodeType: "placeholder", defaultName: "Placeholder", rule: "static", value: "TODO", enabled: true },
    { nodeType: "question", defaultName: "Question", rule: "prefix", value: "Q", enabled: true },
    {
      nodeType: "removeFromContext",
      defaultName: "Remove From Context",
      rule: "prefix",
      value: "rmCC",
      enabled: true,
    },
    {
      nodeType: "requestRating",
      defaultName: "Request Rating",
      rule: "prefix",
      value: "Rate",
      enabled: true,
    },
    { nodeType: "resetContext", defaultName: "Reset Context", rule: "prefix", value: "rsCC", enabled: true },
    { nodeType: "say", defaultName: "Say", rule: "prefix", value: "S", enabled: true },
    {
      nodeType: "searchExtractOutput",
      defaultName: "Search Extract Output",
      rule: "prefix",
      value: "SEO",
      enabled: true,
    },
    { nodeType: "sendEmail", defaultName: "Send SMTP Email", rule: "prefix", value: "MAIL", enabled: true },
    { nodeType: "setRating", defaultName: "Set Rating", rule: "prefix", value: "Rate", enabled: true },
    { nodeType: "sleep", defaultName: "Sleep", rule: "custom", value: "handle_sleep", enabled: true },
    { nodeType: "sqlRunQuery", defaultName: null, rule: "prefix", value: "SQL", enabled: true },
    { nodeType: "start", defaultName: "Start", rule: "custom", value: "handle_start_end", enabled: true },
    {
      nodeType: "stop",
      defaultName: "Stop and Return",
      rule: "static",
      value: "Stop and Return",
      enabled: true,
    },
    { nodeType: "switch", defaultName: "Lookup", rule: "prefix", value: "Lookup", enabled: true },
    { nodeType: "then", defaultName: "Then", rule: "custom", value: "handle_then_else", enabled: true },
    { nodeType: "think", defaultName: "Think", rule: "prefix", value: "Think", enabled: true },
    { nodeType: "trackGoal", defaultName: "Track Goal", rule: "prefix", value: "TG", enabled: true },
    {
      nodeType: "triggerFunction",
      defaultName: "Trigger Function",
      rule: "prefix",
      value: "Fn",
      enabled: true,
    },
    { nodeType: "updateProfile", defaultName: "Update Profile", rule: "prefix", value: "uPP", enabled: true },
    {
      nodeType: "wait",
      defaultName: "Wait for Input",
      rule: "static",
      value: "Wait for Input",
      enabled: true,
    },
    { nodeType: "extension", defaultName: null, rule: "prefix", value: "EXT", enabled: true },
  ];

  function buildRulesByType(rules) {
    const byType = {};
    for (const rule of rules) {
      if (rule && rule.enabled) {
        byType[rule.nodeType] = rule;
      }
    }
    return byType;
  }

  const RULES_BY_TYPE = buildRulesByType(NAMING_RULES);

  function isNameUnassigned(label, prefix) {
    if (!label || !String(label).trim()) return true;
    let rest = String(label);
    if (prefix && rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
    }
    return rest.trim().length === 0;
  }

  function handlePrefixNodeType(oldLabel, namingPrefix, defaultName) {
    let parsed = String(oldLabel || "")
      .replace(/\s*\(\d+\)\s*$/, "")
      .trim();
    if (defaultName && parsed === defaultName) {
      parsed = "";
    }
    if (parsed.startsWith(namingPrefix + NAMING_DELIMITER)) {
      parsed = parsed.slice((namingPrefix + NAMING_DELIMITER).length).trim();
    } else if (parsed === namingPrefix) {
      return namingPrefix;
    } else if (
      OLD_NAMING_DELIMITERS.some(function (delim) {
        return parsed.includes(delim);
      })
    ) {
      for (let i = 0; i < OLD_NAMING_DELIMITERS.length; i++) {
        const delim = OLD_NAMING_DELIMITERS[i];
        if (parsed.includes(delim)) {
          parsed = parsed.split(delim, 2)[1].trim();
          break;
        }
      }
    }
    parsed = parsed.trim();
    if (!parsed) return namingPrefix;
    return namingPrefix + NAMING_DELIMITER + parsed;
  }

  function formatCondition(conditionConfig) {
    if (!conditionConfig || typeof conditionConfig !== "object") return "";
    if (conditionConfig.type === "condition") {
      return String(conditionConfig.condition || "").trim();
    }
    if (conditionConfig.type === "rule") {
      const rule = conditionConfig.rule || {};
      return String((rule.left || "") + " " + (rule.operand || "") + " " + (rule.right || "")).trim();
    }
    return "";
  }

  function sanitizeAnalyticsLabel(label) {
    const source = String(label || "");
    let sanitized = source.replace(FORBIDDEN_ANALYTICS_PATTERN, "-");
    sanitized = sanitized.replace(/- /g, "-").replace(/ -/g, "-");
    sanitized = sanitized.replace(/\[/g, "(").replace(/\]/g, ")").replace(/\{/g, "(").replace(/\}/g, ")");
    sanitized = sanitized.trim();
    return sanitized.slice(0, MAX_ANALYTICS_LENGTH);
  }

  function analyticsLabelOf(node) {
    if (!node || typeof node !== "object") return "";
    const v = node.analyticsLabel !== undefined ? node.analyticsLabel : node.analytics_label;
    return v == null ? "" : String(v);
  }

  function normalizeAnalyticsValue(value) {
    return value == null ? "" : String(value);
  }

  function isEmitCodeNode(nodeType, label) {
    return String(nodeType || "") === "code" && String(label || "").trim() === EMIT_CODE_NODE_LABEL;
  }

  function buildAnalyticsLabelFromNodeLabel(nodeLabel, analyticsSourceOpt) {
    const source =
      analyticsSourceOpt !== undefined && analyticsSourceOpt !== null
        ? String(analyticsSourceOpt)
        : nodeLabel != null
          ? String(nodeLabel)
          : "";
    if (!source) return null;
    return sanitizeAnalyticsLabel(ANALYTICS_LABEL_PREFIX + source);
  }

  function buildAnalyticsLabelForNode(nodeType, nodeLabel, analyticsSourceOpt) {
    if (isEmitCodeNode(nodeType, nodeLabel)) return null;
    return buildAnalyticsLabelFromNodeLabel(nodeLabel, analyticsSourceOpt);
  }

  function finalizeNamingResult(nodeType, label, analyticsSourceOpt) {
    if (label == null) return { label: null, analyticsLabel: null };
    const finalLabel = String(label);
    if (isEmitCodeNode(nodeType, finalLabel)) {
      return { label: EMIT_CODE_NODE_LABEL, analyticsLabel: null };
    }
    if (analyticsSourceOpt === false) {
      return { label: finalLabel, analyticsLabel: null };
    }
    return {
      label: finalLabel,
      analyticsLabel: buildAnalyticsLabelFromNodeLabel(
        finalLabel,
        analyticsSourceOpt !== undefined ? analyticsSourceOpt : finalLabel
      ),
    };
  }

  function suffixFromIfLabel(ifLabel) {
    const label = String(ifLabel || "").trim();
    if (!label) return "";
    const ifPrefix = "If";
    if (label.startsWith(ifPrefix + NAMING_DELIMITER)) {
      return label.slice((ifPrefix + NAMING_DELIMITER).length).trim();
    }
    if (label === ifPrefix) return "";
    return label;
  }

  function buildThenElseAnalyticsSource(branchLabel, ifLabel) {
    const suffix = suffixFromIfLabel(ifLabel);
    if (!suffix) return branchLabel;
    return branchLabel + NAMING_DELIMITER + suffix;
  }

  function createEngine(deps) {
    const options = deps || {};
    const log = typeof options.log === "function" ? options.log : function () {};
    const getFlowById =
      options.getFlowById ||
      function () {
        return null;
      };
    const getFlowByRefId =
      options.getFlowByRefId ||
      function () {
        return null;
      };
    const getChart =
      options.getChart ||
      function () {
        return null;
      };
    const getNodeDetails =
      options.getNodeDetails ||
      function () {
        return Promise.resolve(null);
      };
    const resolveNodeSummaryByRefId =
      options.resolveNodeSummaryByRefId ||
      function () {
        return Promise.resolve(null);
      };

    async function handleStartEnd(nodeType, _config, flowId) {
      const flow = getFlowById(flowId);
      if (!flow || !flow.name) return null;
      return nodeType.charAt(0).toUpperCase() + nodeType.slice(1) + NAMING_DELIMITER + flow.name;
    }

    async function handleToolNodes(_nodeType, config) {
      const toolId = config && config.toolId ? String(config.toolId) : "";
      if (!toolId) return null;
      return "T_" + toolId;
    }

    async function handleCase(_nodeType, config) {
      const caseObj = (config && config.case) || {};
      const value = caseObj.value || caseObj.caseValue || "";
      if (!value) return null;
      return "C_" + String(value);
    }

    async function handleIf(_nodeType, config, _flowId, oldLabel) {
      const prefix = "If";
      if (!isNameUnassigned(oldLabel || "", prefix)) {
        return oldLabel || "";
      }
      const condition = formatCondition(config && config.condition);
      if (condition) return prefix + NAMING_DELIMITER + condition;
      return prefix;
    }

    async function resolveParentIfContext(flowId, context) {
      let parentId = "";
      if (context && context.targetNodeId) {
        parentId = String(context.targetNodeId);
      }
      if (!parentId) {
        const chart = getChart(flowId);
        const nodeId = context && context.nodeId ? String(context.nodeId) : "";
        parentId = chart && nodeId && chart.parentByChildId ? chart.parentByChildId.get(nodeId) || "" : "";
      }
      if (!parentId) {
        return { parentId: "", parentLabel: "" };
      }
      const chart = getChart(flowId);
      const parentSummary = chart && chart.nodesById ? chart.nodesById.get(String(parentId)) : null;
      if (!parentSummary || parentSummary.type !== "if") {
        return { parentId: parentId, parentLabel: "" };
      }
      let parentLabel = String(parentSummary.label || "");
      const parentDetails = await getNodeDetails(flowId, parentId);
      if (parentDetails && parentDetails.label != null) {
        parentLabel = String(parentDetails.label);
      }
      return { parentId: parentId, parentLabel: parentLabel };
    }

    async function handleThenElse(nodeType, _config, flowId, _oldLabel, _ruleCfg, context) {
      const branchLabel = nodeType === "then" ? "Then" : "Else";
      const parentCtx = await resolveParentIfContext(flowId, context || {});
      return {
        label: branchLabel,
        analyticsSource: buildThenElseAnalyticsSource(branchLabel, parentCtx.parentLabel),
      };
    }

    async function handleGoToExecuteFlow(nodeType, config, flowId) {
      const flowNode = (config && config.flowNode) || {};
      const flowRef = flowNode.flow || "";
      const targetFlow = getFlowByRefId(flowRef);
      if (!targetFlow) return null;

      let namingPrefix = "";
      if (nodeType === "goTo") {
        const executionMode = (config && config.executionMode) || "";
        namingPrefix = executionMode === "continue" ? "GT_" : "GTW_";
      } else {
        namingPrefix = "EX_";
      }

      const targetFlowId = String(targetFlow._id || targetFlow.id || "");
      if (!targetFlowId) return null;
      let newName =
        targetFlowId === String(flowId)
          ? namingPrefix + "[SELF]"
          : namingPrefix + "[" + String(targetFlow.name || "") + "]";

      const targetNodeRef = flowNode.node || "";
      if (!targetNodeRef) return newName;

      const targetNode = await resolveNodeSummaryByRefId(targetFlowId, targetNodeRef);
      if (targetNode && targetNode.type !== "start" && targetNode.label) {
        newName = newName + " " + String(targetNode.label);
      }
      return newName;
    }

    async function handleCompleteGoal(_nodeType, config) {
      const goal = config && config.goal ? String(config.goal) : "";
      if (!goal) return null;
      return "CG_" + goal;
    }

    async function handleSleep(_nodeType, config) {
      const milliseconds = config ? config.milliseconds : undefined;
      if (milliseconds === undefined || milliseconds === null) return null;
      return "sleep_" + String(milliseconds) + "ms";
    }

    const CUSTOM_HANDLERS = {
      handle_start_end: handleStartEnd,
      handle_tool_nodes: handleToolNodes,
      handle_case: handleCase,
      handle_if: handleIf,
      handle_then_else: handleThenElse,
      handle_goto_execute_flow: handleGoToExecuteFlow,
      handle_complete_goal: handleCompleteGoal,
      handle_sleep: handleSleep,
    };

    async function computeLabel(nodeType, extension, config, flowId, oldLabel, context) {
      if (isEmitCodeNode(nodeType, oldLabel)) {
        return { label: EMIT_CODE_NODE_LABEL, analyticsLabel: null };
      }

      const effectiveRule =
        extension && !String(extension).startsWith("@cognigy")
          ? RULES_BY_TYPE.extension
          : RULES_BY_TYPE[nodeType];
      if (!effectiveRule) {
        log("computeLabel no matching rule", { nodeType, extension, flowId });
        return { label: null, analyticsLabel: null };
      }
      let newLabel = null;
      let analyticsSourceOpt;
      if (effectiveRule.rule === "static") {
        newLabel = effectiveRule.value;
      } else if (effectiveRule.rule === "prefix") {
        newLabel = handlePrefixNodeType(
          oldLabel || "",
          effectiveRule.value,
          effectiveRule.defaultName || null
        );
      } else if (effectiveRule.rule === "custom") {
        const handler = CUSTOM_HANDLERS[effectiveRule.value];
        if (handler) {
          const handlerResult = await handler(
            nodeType,
            config || {},
            flowId,
            oldLabel || "",
            effectiveRule,
            context || {}
          );
          if (handlerResult && typeof handlerResult === "object" && handlerResult.label != null) {
            analyticsSourceOpt =
              handlerResult.analyticsSource != null
                ? handlerResult.analyticsSource
                : handlerResult.analyticsLabel != null
                  ? String(handlerResult.analyticsLabel)
                  : undefined;
            return finalizeNamingResult(nodeType, handlerResult.label, analyticsSourceOpt);
          }
          newLabel = handlerResult;
        }
      }
      if (newLabel == null) return { label: null, analyticsLabel: null };
      return finalizeNamingResult(nodeType, newLabel);
    }

    /**
     * Evaluate naming convention for a node. Returns null if compliant.
     */
    async function evaluateNodeNaming(node, flowId, flowMeta, contextExtra) {
      if (!node || typeof node !== "object") return null;
      const nodeType = String(node.type || "");
      const extension = String(node.extension || node.extensionId || "@cognigy/basic-nodes");
      const config = node.config && typeof node.config === "object" ? node.config : {};
      const currentLabel = String(node.label || "");
      const currentAnalytics = analyticsLabelOf(node);
      const nodeId = node.id || node._id ? String(node.id || node._id) : "";
      const context = Object.assign({ nodeId: nodeId }, contextExtra || {});

      const computed = await computeLabel(nodeType, extension, config, String(flowId), currentLabel, context);

      const labelViolation = computed.label != null && currentLabel !== computed.label;
      let expectedAnalytics = "";
      if (computed.label != null) {
        expectedAnalytics =
          computed.analyticsLabel === null
            ? ""
            : computed.analyticsLabel != null
              ? String(computed.analyticsLabel)
              : normalizeAnalyticsValue(buildAnalyticsLabelForNode(nodeType, computed.label));
      } else if (currentLabel) {
        expectedAnalytics = normalizeAnalyticsValue(buildAnalyticsLabelForNode(nodeType, currentLabel));
      }
      const analyticsViolation =
        normalizeAnalyticsValue(currentAnalytics) !== normalizeAnalyticsValue(expectedAnalytics);

      if (!labelViolation && !analyticsViolation) return null;

      const parts = [];
      if (labelViolation) {
        parts.push('label "' + currentLabel + '" → "' + computed.label + '"');
      }
      if (analyticsViolation) {
        parts.push('analytics "' + currentAnalytics + '" → "' + expectedAnalytics + '"');
      }

      const labelFixable = labelViolation && computed.label != null;
      const analyticsFixable = analyticsViolation;
      const fixable = labelFixable || analyticsFixable;

      return {
        labelViolation,
        analyticsViolation,
        fixable,
        expectedLabel: labelFixable ? computed.label : currentLabel,
        expectedAnalytics,
        message: "Naming convention: " + parts.join("; "),
        flow: flowMeta || null,
        node: node,
      };
    }

    /**
     * Build PATCH body for fixing naming on a node.
     */
    async function buildNamingFixPatch(node, flowId, contextExtra) {
      const evaluation = await evaluateNodeNaming(node, flowId, null, contextExtra);
      if (!evaluation || !evaluation.fixable) return null;
      const patch = {};
      if (evaluation.labelViolation) {
        patch.label = evaluation.expectedLabel;
      }
      if (evaluation.analyticsViolation) {
        patch.analyticsLabel = evaluation.expectedAnalytics === "" ? null : evaluation.expectedAnalytics;
      }
      if (!Object.keys(patch).length) return null;
      return patch;
    }

    return {
      computeLabel,
      sanitizeAnalyticsLabel,
      analyticsLabelOf,
      evaluateNodeNaming,
      buildNamingFixPatch,
      resolveParentIfContext,
      RULES_BY_TYPE,
    };
  }

  naming.ISSUE_TYPE_NAMING_CONVENTION = "naming_convention_violation";
  naming.NAMING_RULES = NAMING_RULES;
  naming.ANALYTICS_LABEL_PREFIX = ANALYTICS_LABEL_PREFIX;
  naming.createEngine = createEngine;
  naming.sanitizeAnalyticsLabel = sanitizeAnalyticsLabel;
  naming.buildAnalyticsLabelForNode = buildAnalyticsLabelForNode;
  naming.isEmitCodeNode = isEmitCodeNode;
})();

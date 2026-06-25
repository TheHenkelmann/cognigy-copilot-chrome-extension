/**
 * Async scan for naming convention violations across project flows.
 */
(function ccpNamingIssuesModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const naming = (CCP.naming = CCP.naming || {});

  if (naming.scanNamingConventionIssues) {
    return;
  }

  const ISSUE_TYPE = naming.ISSUE_TYPE_NAMING_CONVENTION || "naming_convention_violation";

  function idOf(obj) {
    if (!obj || typeof obj !== "object") return "";
    return String(obj.id || obj._id || "");
  }

  function makeNamingIssue(evaluation) {
    return {
      type: ISSUE_TYPE,
      severity: 1,
      message: evaluation.message,
      flow: evaluation.flow,
      node: evaluation.node,
      fixable: evaluation.fixable === true,
    };
  }

  /**
   * Scan all nodes in the given flows for naming convention violations.
   *
   * @param {object} args
   * @param {Array} args.flows - flow objects with nodes arrays
   * @param {object} args.engine - naming engine from createEngine()
   * @param {function} [args.getNodeDetails] - optional (flowId, nodeId) => Promise<node>
   * @param {function} [args.onProgress] - optional progress callback
   */
  async function scanNamingConventionIssues(args) {
    const opts = args || {};
    const flows = Array.isArray(opts.flows) ? opts.flows : [];
    const engine = opts.engine;
    if (!engine || typeof engine.evaluateNodeNaming !== "function") {
      return [];
    }
    const getNodeDetails = typeof opts.getNodeDetails === "function" ? opts.getNodeDetails : null;
    const issues = [];

    for (let fi = 0; fi < flows.length; fi++) {
      const flow = flows[fi];
      if (!flow || typeof flow !== "object") continue;
      const flowId = idOf(flow);
      if (!flowId) continue;
      const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];

      for (let ni = 0; ni < nodes.length; ni++) {
        const summary = nodes[ni];
        if (!summary || typeof summary !== "object") continue;

        const nodeId = idOf(summary);
        if (!nodeId) continue;

        let node = summary;
        const needsDetails =
          summary.type === "goTo" ||
          summary.type === "executeFlow" ||
          summary.type === "then" ||
          summary.type === "else" ||
          !engine.analyticsLabelOf(summary);

        if (needsDetails && getNodeDetails) {
          try {
            const details = await getNodeDetails(flowId, nodeId, false);
            if (details && typeof details === "object") {
              node = Object.assign({}, summary, details);
            }
          } catch (_) {}
        }

        const evaluation = await engine.evaluateNodeNaming(node, flowId, flow, {});
        if (!evaluation) continue;
        issues.push(makeNamingIssue(evaluation));
      }
    }

    issues.sort(function (a, b) {
      const aType = a.node && a.node.type ? String(a.node.type) : "";
      const bType = b.node && b.node.type ? String(b.node.type) : "";
      function typeRank(type) {
        if (type === "if") return 0;
        if (type === "then" || type === "else") return 2;
        return 1;
      }
      const ar = typeRank(aType);
      const br = typeRank(bType);
      if (ar !== br) return ar - br;

      const an = (a.flow && a.flow.name) || "";
      const bn = (b.flow && b.flow.name) || "";
      if (an < bn) return -1;
      if (an > bn) return 1;
      const al = (a.node && a.node.label) || "";
      const bl = (b.node && b.node.label) || "";
      if (al < bl) return -1;
      if (al > bl) return 1;
      return 0;
    });

    return issues;
  }

  naming.scanNamingConventionIssues = scanNamingConventionIssues;
})();

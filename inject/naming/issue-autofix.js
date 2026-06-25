/**
 * Extensible auto-fix registry for integrity issues.
 */
(function ccpIssueAutofixModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const naming = (CCP.naming = CCP.naming || {});

  if (naming.issueAutofix) {
    return;
  }

  const FIX_CONCURRENCY = 4;
  const handlers = new Map();

  function registerFixHandler(issueType, handler) {
    if (!issueType || !handler) return;
    handlers.set(String(issueType), handler);
  }

  function getFixHandler(issueType) {
    return handlers.get(String(issueType || "")) || null;
  }

  function canFixIssue(issue) {
    if (!issue || !issue.type) return false;
    const handler = getFixHandler(issue.type);
    if (!handler) return false;
    if (typeof handler.canFix === "function") {
      return handler.canFix(issue) === true;
    }
    return issue.fixable === true;
  }

  function getFixHandlerDisplayLabel(issueType) {
    const handler = getFixHandler(issueType);
    return handler && handler.displayLabel ? String(handler.displayLabel) : String(issueType || "Issue");
  }

  function collectFixableTypes(issues) {
    const types = new Map();
    const list = Array.isArray(issues) ? issues : [];
    for (let i = 0; i < list.length; i++) {
      const issue = list[i];
      if (!canFixIssue(issue)) continue;
      const t = String(issue.type || "");
      types.set(t, (types.get(t) || 0) + 1);
    }
    return types;
  }

  /**
   * Create an SVG progress ring with green (success), red (failure), gray (pending) segments.
   */
  function createProgressRingElement(size) {
    const px = size || 20;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(px));
    svg.setAttribute("height", String(px));
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.setAttribute("class", "ccp-fc-fix-progress-svg");

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bg.setAttribute("cx", "18");
    bg.setAttribute("cy", "18");
    bg.setAttribute("r", "14");
    bg.setAttribute("fill", "none");
    bg.setAttribute("stroke", "rgba(255,255,255,0.12)");
    bg.setAttribute("stroke-width", "4");

    const successArc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    successArc.setAttribute("data-ccp-fix-arc", "success");
    successArc.setAttribute("cx", "18");
    successArc.setAttribute("cy", "18");
    successArc.setAttribute("r", "14");
    successArc.setAttribute("fill", "none");
    successArc.setAttribute("stroke", "#22c55e");
    successArc.setAttribute("stroke-width", "4");
    successArc.setAttribute("stroke-linecap", "butt");
    successArc.setAttribute("transform", "rotate(-90 18 18)");

    const failureArc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    failureArc.setAttribute("data-ccp-fix-arc", "failure");
    failureArc.setAttribute("cx", "18");
    failureArc.setAttribute("cy", "18");
    failureArc.setAttribute("r", "14");
    failureArc.setAttribute("fill", "none");
    failureArc.setAttribute("stroke", "#dc2626");
    failureArc.setAttribute("stroke-width", "4");
    failureArc.setAttribute("stroke-linecap", "butt");
    failureArc.setAttribute("transform", "rotate(-90 18 18)");

    svg.appendChild(bg);
    svg.appendChild(successArc);
    svg.appendChild(failureArc);
    return { svg, successArc, failureArc };
  }

  function updateProgressRing(arcs, progress) {
    if (!arcs) return;
    const total = Math.max(0, Number(progress && progress.total) || 0);
    const success = Math.max(0, Number(progress && progress.success) || 0);
    const failure = Math.max(0, Number(progress && progress.failure) || 0);
    const done = success + failure;
    const circumference = 2 * Math.PI * 14;

    if (total <= 0) {
      arcs.successArc.setAttribute("stroke-dasharray", "0 " + circumference);
      arcs.failureArc.setAttribute("stroke-dasharray", "0 " + circumference);
      return;
    }

    const successLen = (success / total) * circumference;
    const failureLen = (failure / total) * circumference;
    const pendingLen = Math.max(0, circumference - successLen - failureLen);

    arcs.successArc.setAttribute("stroke-dasharray", successLen + " " + (circumference - successLen));
    arcs.successArc.setAttribute("stroke-dashoffset", "0");

    arcs.failureArc.setAttribute("stroke-dasharray", failureLen + " " + (circumference - failureLen));
    arcs.failureArc.setAttribute("stroke-dashoffset", String(-successLen));
  }

  async function fixSingleIssue(issue, ctx) {
    if (!canFixIssue(issue)) {
      return { ok: false, error: new Error("Issue is not fixable") };
    }
    const handler = getFixHandler(issue.type);
    try {
      await handler.applyFix(issue, ctx || {});
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error };
    }
  }

  async function runPool(items, worker, concurrency, onItemDone) {
    const list = Array.isArray(items) ? items.slice() : [];
    const limit = Math.max(1, Number(concurrency) || FIX_CONCURRENCY);
    let index = 0;
    let success = 0;
    let failure = 0;

    async function runOne() {
      while (index < list.length) {
        const currentIndex = index;
        index += 1;
        const item = list[currentIndex];
        let ok = false;
        try {
          ok = (await worker(item)) === true;
        } catch (_) {
          ok = false;
        }
        if (ok) success += 1;
        else failure += 1;
        if (typeof onItemDone === "function") {
          onItemDone({
            total: list.length,
            success,
            failure,
            pending: list.length - success - failure,
            done: success + failure,
          });
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(limit, list.length); i++) {
      workers.push(runOne());
    }
    await Promise.all(workers);
    return { total: list.length, success, failure };
  }

  async function fixIssuesByType(issueType, issues, options) {
    const opts = options || {};
    const type = String(issueType || "");
    const handler = getFixHandler(type);
    if (!handler) {
      return { total: 0, success: 0, failure: 0 };
    }

    const candidates = (Array.isArray(issues) ? issues : []).filter(function (issue) {
      return issue && String(issue.type || "") === type && canFixIssue(issue);
    });

    const concurrency = opts.concurrency != null ? opts.concurrency : FIX_CONCURRENCY;
    const ctx = opts.ctx || {};

    let partitions = [candidates];
    if (typeof handler.partitionForBatchFix === "function") {
      const parts = handler.partitionForBatchFix(candidates);
      if (Array.isArray(parts) && parts.length) {
        partitions = parts.filter(function (part) {
          return Array.isArray(part) && part.length > 0;
        });
        if (!partitions.length) {
          partitions = [candidates];
        }
      }
    }

    const grandTotal = partitions.reduce(function (sum, part) {
      return sum + part.length;
    }, 0);

    let success = 0;
    let failure = 0;

    for (let pi = 0; pi < partitions.length; pi++) {
      const part = partitions[pi];
      const partBaseSuccess = success;
      const partBaseFailure = failure;
      const result = await runPool(
        part,
        async function (issue) {
          const fixResult = await fixSingleIssue(issue, ctx);
          return fixResult.ok;
        },
        concurrency,
        function (progress) {
          if (typeof opts.onProgress !== "function") return;
          opts.onProgress({
            total: grandTotal,
            success: partBaseSuccess + (progress.success || 0),
            failure: partBaseFailure + (progress.failure || 0),
            pending:
              grandTotal -
              partBaseSuccess -
              partBaseFailure -
              (progress.success || 0) -
              (progress.failure || 0),
            done: partBaseSuccess + partBaseFailure + (progress.success || 0) + (progress.failure || 0),
          });
        }
      );
      success += result.total ? result.success || 0 : 0;
      failure += result.total ? result.failure || 0 : 0;
      if (typeof opts.onProgress === "function") {
        opts.onProgress({
          total: grandTotal,
          success: success,
          failure: failure,
          pending: Math.max(0, grandTotal - success - failure),
          done: success + failure,
        });
      }
    }

    return { total: grandTotal, success: success, failure: failure };
  }

  naming.issueAutofix = {
    FIX_CONCURRENCY,
    registerFixHandler,
    getFixHandler,
    canFixIssue,
    getFixHandlerDisplayLabel,
    collectFixableTypes,
    createProgressRingElement,
    updateProgressRing,
    fixSingleIssue,
    fixIssuesByType,
  };
})();

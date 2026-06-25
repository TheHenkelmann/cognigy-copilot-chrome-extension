(function ccpFlowCodeBootstrapModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  const flowCode = (CCP.flowCode = CCP.flowCode || {});

  if (flowCode.__bootstrapped) {
    return;
  }
  flowCode.__bootstrapped = true;

  let renderInFlight = false;
  let lastMode = "";
  let lastFlowId = "";
  let lastFailureReason = "";
  let mapRetryHookBound = false;
  const RENDER_TIMEOUT_MS = 15000;

  function scheduleCodeTabRetry() {
    lastFailureReason = "";
    tick();
  }

  function withTimeout(promise, ms, reason) {
    return Promise.race([
      promise,
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ ok: false, reason: reason || "render-timeout" });
        }, ms);
      }),
    ]);
  }

  function ensureCodeTabMapRetryHook(namingApi) {
    if (mapRetryHookBound) return;
    const map = namingApi && typeof namingApi.getProjectMap === "function" ? namingApi.getProjectMap() : null;
    if (!map || typeof map.addEventListener !== "function") return;
    mapRetryHookBound = true;
    const retryableFailures = {
      "flow-data-unavailable": true,
      "project-map-unavailable": true,
      "render-timeout": true,
    };
    function onMapReady() {
      if (!retryableFailures[lastFailureReason]) return;
      scheduleCodeTabRetry();
    }
    map.addEventListener("init-finished", onMapReady);
    map.addEventListener("chart-changed", onMapReady);
    map.addEventListener("flows-changed", onMapReady);
  }

  async function tick() {
    const tabs = flowCode.tabs || {};
    const view = flowCode.view || {};
    const editor = flowCode.editor || {};
    const namingApi = CCP.namingApi || {};
    if (typeof tabs.ensureCodeTab !== "function") return;
    tabs.ensureCodeTab();
    const mode =
      typeof tabs.getCurrentModeFromLocation === "function" ? tabs.getCurrentModeFromLocation() : "other";
    if (typeof tabs.syncSelection === "function") {
      tabs.syncSelection(mode);
    }
    if (mode !== "code") {
      if (typeof view.applyMode === "function") view.applyMode(mode);
      if (typeof view.setStatus === "function") view.setStatus("");
      lastMode = mode;
      return;
    }

    if (typeof view.applyMode === "function") view.applyMode("code");

    const flowId = typeof namingApi.getCurrentFlowId === "function" ? namingApi.getCurrentFlowId() : "";
    ensureCodeTabMapRetryHook(namingApi);
    if (!flowId) {
      if (typeof view.setStatus === "function") {
        view.setStatus("Code view unavailable (missing-flow-id).");
      }
      return;
    }
    if (renderInFlight) return;
    if (lastMode === "code" && lastFlowId === flowId && !lastFailureReason) return;
    if (lastFailureReason && lastFlowId === flowId) return;
    renderInFlight = true;
    let renderOk = false;
    let failureReason = "";
    try {
      if (typeof view.setStatus === "function") {
        view.setStatus("Loading code view...");
      }
      if (typeof editor.renderFlowCode === "function") {
        const result = await withTimeout(editor.renderFlowCode(flowId), RENDER_TIMEOUT_MS, "render-timeout");
        if (result && result.ok) {
          renderOk = true;
          failureReason = "";
          if (typeof view.applyMode === "function") view.applyMode("code");
          if (typeof view.setStatus === "function") view.setStatus("");
          console.log(LOG_PREFIX, "flow-code bootstrap render ok", {
            flowId: flowId,
            fallback: !!(result && result.fallback),
          });
        } else {
          failureReason = String((result && result.reason) || "unknown-error");
          // Keep code panel visible with explicit status instead of blank area.
          if (typeof view.applyMode === "function") view.applyMode("code");
          if (typeof view.setStatus === "function") {
            view.setStatus("Code view unavailable (" + failureReason + ").");
          }
        }
      } else {
        failureReason = "editor-module-missing";
        if (typeof view.applyMode === "function") view.applyMode("code");
        if (typeof view.setStatus === "function") {
          view.setStatus("Code view unavailable (editor-module-missing).");
        }
      }
    } catch (error) {
      failureReason = "render-exception";
      console.warn(LOG_PREFIX, "flow-code render failed", error);
      if (typeof view.applyMode === "function") view.applyMode("code");
      if (typeof view.setStatus === "function") {
        view.setStatus("Code view unavailable (render-exception).");
      }
    } finally {
      // Only lock "already rendered" state after a successful render.
      // Otherwise keep retrying while Monaco/chart become available.
      if (renderOk) {
        lastFlowId = flowId;
        lastMode = mode;
        lastFailureReason = "";
      } else {
        // Avoid tight retry loops on hard failures (e.g. missing local Monaco assets).
        // User can retry by switching tabs (chart -> code) or reloading after fixing assets.
        lastFlowId = flowId;
        lastMode = mode;
        lastFailureReason = failureReason;
        if (failureReason === "monaco-unavailable") {
          console.warn(
            LOG_PREFIX,
            "flow-code render paused: local Monaco unavailable. Add inject/vendor/monaco assets and reload."
          );
        }
      }
      renderInFlight = false;
    }
  }

  const observer = new MutationObserver(function () {
    tick();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", tick);
  window.addEventListener("hashchange", tick);
  setInterval(tick, 600);
  tick();

  flowCode.bootstrap = {
    scheduleRetry: scheduleCodeTabRetry,
  };
})();

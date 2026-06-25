(function ccpFlowCodeViewModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const flowCode = (CCP.flowCode = CCP.flowCode || {});
  const viewState = {
    boundsBound: false,
    fallbackInputHandler: null,
  };

  function getChartContentElement() {
    return document.querySelector("#chartContent");
  }

  function getFlowChartTabContentElement() {
    return document.getElementById("flowChartEditorTabContent");
  }

  function ensureCodeContainer() {
    let root = document.getElementById("flowCodeContent");
    let host = document.getElementById("flowCodeEditorHost");
    let fallback = document.getElementById("flowCodeTextFallback");
    let diagnostics = document.getElementById("flowCodeDiagnostics");
    let status = document.getElementById("flowCodeStatus");
    const chart = getChartContentElement();
    const chartTabContent = getFlowChartTabContentElement();
    const mountParent =
      chartTabContent && chartTabContent.parentElement
        ? chartTabContent.parentElement
        : chart && chart.parentElement
          ? chart.parentElement
          : null;
    if (!root) {
      root = document.createElement("div");
      root.id = "flowCodeContent";
      root.style.display = "none";
      root.style.position = "relative";
      root.style.left = "";
      root.style.top = "";
      root.style.width = "100%";
      root.style.height = "100%";
      root.style.zIndex = "2";
      root.style.borderRadius = "0";
      root.style.overflow = "hidden";
      root.style.border = "0";
      root.style.background = "#0b1220";
      root.style.boxShadow = "none";
    }
    if (!host) {
      host = document.createElement("div");
      host.id = "flowCodeEditorHost";
      host.style.width = "100%";
      host.style.height = "100%";
      root.appendChild(host);
    }
    if (!fallback) {
      fallback = document.createElement("textarea");
      fallback.id = "flowCodeTextFallback";
      fallback.style.width = "100%";
      fallback.style.height = "100%";
      fallback.style.margin = "0";
      fallback.style.boxSizing = "border-box";
      fallback.style.overflow = "auto";
      fallback.style.padding = "16px";
      fallback.style.display = "none";
      fallback.style.background = "#0f172a";
      fallback.style.color = "#e2e8f0";
      fallback.style.fontSize = "12px";
      fallback.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      fallback.style.border = "0";
      fallback.style.outline = "none";
      fallback.style.resize = "none";
      fallback.style.lineHeight = "1.45";
      fallback.style.whiteSpace = "pre";
      fallback.style.tabSize = "2";
      // Code tab is read-only — the textarea exists only for the no-Monaco
      // fallback path and must not be editable.
      fallback.readOnly = true;
      fallback.spellcheck = false;
      root.appendChild(fallback);
    }
    if (!diagnostics) {
      diagnostics = document.createElement("div");
      diagnostics.id = "flowCodeDiagnostics";
      diagnostics.style.position = "absolute";
      diagnostics.style.right = "12px";
      diagnostics.style.top = "12px";
      diagnostics.style.maxWidth = "min(46vw, 640px)";
      diagnostics.style.maxHeight = "40%";
      diagnostics.style.overflow = "auto";
      diagnostics.style.padding = "8px 10px";
      diagnostics.style.borderRadius = "8px";
      diagnostics.style.background = "rgba(2, 6, 23, 0.92)";
      diagnostics.style.border = "1px solid rgba(148, 163, 184, 0.35)";
      diagnostics.style.color = "#e2e8f0";
      diagnostics.style.fontSize = "12px";
      diagnostics.style.zIndex = "7";
      diagnostics.style.display = "none";
      diagnostics.style.whiteSpace = "pre-wrap";
      root.appendChild(diagnostics);
    }
    if (!status) {
      status = document.createElement("div");
      status.id = "flowCodeStatus";
      status.style.position = "absolute";
      status.style.top = "12px";
      status.style.left = "12px";
      status.style.padding = "8px 10px";
      status.style.borderRadius = "8px";
      status.style.background = "rgba(15, 23, 42, 0.92)";
      status.style.color = "#e2e8f0";
      status.style.fontSize = "12px";
      status.style.zIndex = "5";
      status.style.display = "none";
      root.appendChild(status);
    }
    if (mountParent && !root.parentElement) {
      mountParent.insertBefore(root, chartTabContent ? chartTabContent.nextSibling : null);
    }
    bindBoundsSyncIfNeeded();
    return root;
  }

  function updateOverlayBounds() {
    const root = document.getElementById("flowCodeContent");
    const chartTabContent = getFlowChartTabContentElement();
    if (!root || !chartTabContent) return;
    const chartRect = chartTabContent.getBoundingClientRect();
    if (!chartRect || chartRect.width < 20 || chartRect.height < 20) return;
    root.style.width = Math.max(20, chartRect.width) + "px";
    root.style.height = Math.max(20, chartRect.height) + "px";
  }

  function bindBoundsSyncIfNeeded() {
    if (viewState.boundsBound) return;
    viewState.boundsBound = true;
    window.addEventListener("resize", updateOverlayBounds, { passive: true });
    window.addEventListener("scroll", updateOverlayBounds, { passive: true, capture: true });
    const chart = getChartContentElement();
    if (chart && typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(updateOverlayBounds);
      observer.observe(chart, { attributes: true, attributeFilter: ["style", "class"] });
    }
  }

  function applyMode(mode) {
    const chart = getChartContentElement();
    const chartTabContent = getFlowChartTabContentElement();
    const root = ensureCodeContainer();
    if (!root) return;
    const showCode = mode === "code";
    root.style.display = showCode ? "block" : "none";
    if (showCode) updateOverlayBounds();
    // Toggle visibility only; chart state (pan/zoom) stays intact.
    if (chartTabContent) {
      chartTabContent.style.display = showCode ? "none" : "";
    } else if (chart) {
      chart.style.visibility = showCode ? "hidden" : "";
    }
  }

  function getEditorHost() {
    ensureCodeContainer();
    return document.getElementById("flowCodeEditorHost");
  }

  function setStatus(message) {
    const el = document.getElementById("flowCodeStatus");
    if (!el) return;
    if (!message) {
      el.textContent = "";
      el.style.display = "none";
      return;
    }
    el.textContent = String(message);
    el.style.display = "block";
  }

  function showFallbackText(text) {
    const fallback = document.getElementById("flowCodeTextFallback");
    const host = document.getElementById("flowCodeEditorHost");
    if (!fallback || !host) return;
    fallback.value = String(text || "");
    fallback.style.display = "block";
    host.style.display = "none";
  }

  function hideFallbackText() {
    const fallback = document.getElementById("flowCodeTextFallback");
    const host = document.getElementById("flowCodeEditorHost");
    if (!fallback || !host) return;
    fallback.style.display = "none";
    host.style.display = "block";
  }

  // The code tab is now read-only (JSON view of the project map). The
  // fallback textarea has no input binding anymore; we keep this helper
  // around as a no-op so older call sites don't have to be branched.
  function bindFallbackInput(_onInput) {
    const fallback = document.getElementById("flowCodeTextFallback");
    if (!fallback) return;
    if (viewState.fallbackInputHandler) {
      try {
        fallback.removeEventListener("input", viewState.fallbackInputHandler);
      } catch (_) {}
      viewState.fallbackInputHandler = null;
    }
  }

  function setDiagnostics(items) {
    const diagnostics = document.getElementById("flowCodeDiagnostics");
    if (!diagnostics) return;
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      diagnostics.textContent = "";
      diagnostics.style.display = "none";
      return;
    }
    const preview = list
      .slice(0, 10)
      .map((d, idx) => {
        const sev = d && d.severity === "warning" ? "warn" : "error";
        return String(idx + 1) + ". [" + sev + "] " + String(d.message || "Diagnostic");
      })
      .join("\n");
    diagnostics.textContent = preview;
    diagnostics.style.display = "block";
  }

  flowCode.view = {
    applyMode,
    ensureCodeContainer,
    getEditorHost,
    setStatus,
    showFallbackText,
    hideFallbackText,
    bindFallbackInput,
    setDiagnostics,
  };
})();

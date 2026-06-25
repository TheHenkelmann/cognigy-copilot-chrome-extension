(function ccpFlowCodeTabsModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  const flowCode = (CCP.flowCode = CCP.flowCode || {});

  function getTabList() {
    return (
      document.querySelector('[aria-label="Flow Editor"][role="tablist"]') ||
      document.querySelector('.MuiTabs-flexContainer[role="tablist"]')
    );
  }

  function getChartTab(tabList) {
    if (!tabList) return null;
    return tabList.querySelector('[data-test="FlowChartTabButton"]');
  }

  function getNluTab(tabList) {
    if (!tabList) return null;
    return tabList.querySelector('[data-test="FlowNLUTabButton"]');
  }

  function getCodeTab(tabList) {
    if (!tabList) return null;
    return tabList.querySelector('[data-test="FlowCodeTabButton"]');
  }

  function isFlowEditorPath(pathname) {
    return /\/flow\/[a-z0-9]{24}\//i.test(String(pathname || ""));
  }

  function getCurrentModeFromLocation() {
    const pathname = String(window.location.pathname || "");
    const hash = String(window.location.hash || "").toLowerCase();
    const search = new URLSearchParams(String(window.location.search || ""));
    if (!isFlowEditorPath(pathname)) return "other";
    if (hash === "#code" || search.get("view") === "code") return "code";
    if (/\/flow\/[a-z0-9]{24}\/chart(?:\/[a-z0-9]{24})?$/i.test(pathname)) return "chart";
    if (/\/flow\/[a-z0-9]{24}\/nlu$/i.test(pathname)) return "nlu";
    if (/\/flow\/[a-z0-9]{24}\/settings$/i.test(pathname)) return "settings";
    return "other";
  }

  function buildCodeHref(chartHref) {
    const raw = String(chartHref || "");
    if (!raw) return "";
    try {
      const url = new URL(raw, window.location.origin);
      // Keep a valid Cognigy route and toggle code mode via hash only.
      // A /code path is not registered in the app router.
      url.hash = "code";
      return url.toString();
    } catch (_) {
      return raw.replace(/#.*$/, "") + "#code";
    }
  }

  function navigateToCode(codeHref) {
    if (!codeHref) return;
    try {
      const target = new URL(codeHref, window.location.origin);
      const next = target.pathname + target.search + target.hash;
      if (next !== window.location.pathname + window.location.search + window.location.hash) {
        window.history.pushState({}, "", next);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    } catch (error) {
      console.warn(LOG_PREFIX, "flow-code navigateToCode failed", error);
    }
  }

  function syncSelection(mode) {
    const tabList = getTabList();
    if (!tabList) return;
    const codeTab = getCodeTab(tabList);
    if (!codeTab) return;
    if (mode !== "code") {
      codeTab.setAttribute("aria-selected", "false");
      codeTab.setAttribute("tabindex", "-1");
      return;
    }
    const tabs = tabList.querySelectorAll('[role="tab"]');
    for (const tab of tabs) {
      tab.setAttribute("aria-selected", tab === codeTab ? "true" : "false");
      tab.setAttribute("tabindex", tab === codeTab ? "0" : "-1");
    }
  }

  function ensureCodeTab() {
    const tabList = getTabList();
    if (!tabList) return null;
    const chartTab = getChartTab(tabList);
    const nluTab = getNluTab(tabList);
    if (!chartTab || !nluTab) return null;

    const codeHref = buildCodeHref(chartTab.getAttribute("href"));
    let codeTab = getCodeTab(tabList);
    if (!codeTab) {
      codeTab = chartTab.cloneNode(true);
      codeTab.setAttribute("data-test", "FlowCodeTabButton");
      codeTab.setAttribute("id", "flowCodeTabItem");
      codeTab.setAttribute("aria-controls", "flowCodeEditorTabContent");
      const wrappers = codeTab.querySelectorAll(".MuiTab-wrapper");
      if (wrappers.length > 0) {
        wrappers[0].textContent = "Code";
      } else {
        codeTab.textContent = "Code";
      }
      codeTab.addEventListener("click", function onCodeTabClick(event) {
        event.preventDefault();
        event.stopPropagation();
        navigateToCode(codeTab.getAttribute("href"));
      });
      tabList.insertBefore(codeTab, nluTab);
    }
    if (codeHref) {
      codeTab.setAttribute("href", codeHref);
    }
    return codeTab;
  }

  flowCode.tabs = {
    ensureCodeTab,
    getCurrentModeFromLocation,
    syncSelection,
  };
})();

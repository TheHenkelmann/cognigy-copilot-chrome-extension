/**
 * Cognigy Copilot bootstrap loader.
 * Loads runtime modules into the page in deterministic order.
 */
(function cognigyCopilotBootstrap() {
  if (window.__CCP__ && window.__CCP__.__bootstrapped) {
    return;
  }

  const CCP = (window.__CCP__ = window.__CCP__ || {});
  CCP.__bootstrapped = true;
  CCP.LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  CCP.MSG_INJECT = CCP.MSG_INJECT || "COGNIGY_COPILOT_INJECT";
  CCP.MSG_CONTENT = CCP.MSG_CONTENT || "COGNIGY_COPILOT_CONTENT";
  CCP.handlers = CCP.handlers || {};
  CCP.bootstrapScriptSrc =
    CCP.bootstrapScriptSrc || (document.currentScript && document.currentScript.src) || "";

  console.log(CCP.LOG_PREFIX, "inject.js bootstrap executing at", performance.now());
  console.log(CCP.LOG_PREFIX, "inject frame context", {
    href: window.location.href,
    isTop: window === window.top,
    origin: window.location.origin,
  });

  const runtimeModules = [
    "inject/core/logger.js",
    "inject/core/websocket.js",
    "inject/core/message-bridge.js",
    "inject/monaco/discovery.js",
    "inject/monaco/edit-stream.js",
    "inject/project-map/node-constants.js",
    "inject/project-map/storage.js",
    "inject/project-map/api-client.js",
    "inject/project-map/issues.js",
    "inject/project-map/structured-json.js",
    "inject/project-map/project-map.js",
    "inject/naming/naming-engine.js",
    "inject/naming/naming-issues.js",
    "inject/naming/issue-autofix.js",
    "inject/naming/state.js",
    "inject/release/release.js",
    "inject/release/release-api.js",
    "inject/release/release-ui.js",
    "inject/naming/flow-chat-ui.js",
    "inject/naming/routes.js",
    "inject/naming/cache.js",
    "inject/naming/validation.js",
    "inject/naming/ui.js",
    "inject/naming/network-fetch.js",
    "inject/naming/network-xhr.js",
    "inject/flow-code/tabs.js",
    "inject/flow-code/view.js",
    "inject/flow-code/editor.js",
    "inject/flow-code/bootstrap.js",
  ];

  function resolveModuleUrl(modPath) {
    // In page world, chrome.runtime is typically unavailable.
    // Resolve URLs relative to the original bootstrap script src.
    try {
      const baseSrc = CCP.bootstrapScriptSrc ? String(CCP.bootstrapScriptSrc) : "";
      if (baseSrc) {
        return new URL(modPath, baseSrc).toString();
      }
    } catch (e) {
      console.warn(CCP.LOG_PREFIX, "failed resolving module url from bootstrap src", modPath, e);
    }

    if (
      typeof chrome !== "undefined" &&
      chrome &&
      chrome.runtime &&
      typeof chrome.runtime.getURL === "function"
    ) {
      return chrome.runtime.getURL(modPath);
    }

    throw new Error("Could not resolve module URL for: " + modPath);
  }

  function loadScriptSequentially(idx) {
    if (idx >= runtimeModules.length) {
      console.log(CCP.LOG_PREFIX, "inject.js runtime modules loaded at", performance.now());
      return;
    }

    const modPath = runtimeModules[idx];
    const script = document.createElement("script");
    script.src = resolveModuleUrl(modPath);
    script.async = false;
    script.onload = function () {
      loadScriptSequentially(idx + 1);
    };
    script.onerror = function (err) {
      console.error(CCP.LOG_PREFIX, "failed loading runtime module", modPath, err);
      loadScriptSequentially(idx + 1);
    };
    (document.head || document.documentElement).appendChild(script);
  }

  loadScriptSequentially(0);
})();

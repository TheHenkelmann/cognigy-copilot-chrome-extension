(function ccpNamingStateModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  /** --- Cognigy node auto naming (fetch intercept) --- */
  const NAMING_LOG_PREFIX = "[CognigyCopilot:Naming]";
  const OWN_FETCH_MARKER_HEADER = "x-cognigy-copilot-naming";
  const OWN_FETCH_MARKER_VALUE = "1";
  const API_VERSION_SEGMENT = "/new/v2.0";
  const NAMING_DEBUG_VERBOSE = false;
  const ENABLE_NAMING_INTERCEPT = window === window.top;

  if (!ENABLE_NAMING_INTERCEPT) {
    console.log(NAMING_LOG_PREFIX, "Skipping naming intercept in non-top frame");
    console.log(LOG_PREFIX, "inject.js setup complete at", performance.now());
    return;
  }

  function namingLogDebug(message, meta) {
    if (!NAMING_DEBUG_VERBOSE) return;
    if (meta === undefined) {
      console.debug(NAMING_LOG_PREFIX, "[DEBUG]", message);
      return;
    }
    console.debug(NAMING_LOG_PREFIX, "[DEBUG]", message, meta);
  }

  function clipDebugValue(value, maxLength) {
    const text = String(value == null ? "" : value);
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...(+" + String(text.length - maxLength) + " chars)";
  }

  function summarizeBodyShape(bodyObj) {
    if (!bodyObj || typeof bodyObj !== "object") return { valid: false };
    return {
      valid: true,
      keys: Object.keys(bodyObj),
      nodeType: bodyObj.type || null,
      label: bodyObj.label || null,
      hasConfig: !!bodyObj.config,
      configKeys: bodyObj.config && typeof bodyObj.config === "object" ? Object.keys(bodyObj.config) : [],
      target: bodyObj.target || null,
    };
  }

  function logLabelMutation(stage, nodeType, oldLabel, newLabel, oldAnalytics, newAnalytics, context) {
    namingLogDebug(stage + " label mutation", {
      nodeType: nodeType || null,
      oldLabel: oldLabel == null ? null : String(oldLabel),
      newLabel: newLabel == null ? null : String(newLabel),
      oldAnalyticsLabel: oldAnalytics == null ? null : String(oldAnalytics),
      newAnalyticsLabel: newAnalytics == null ? null : String(newAnalytics),
      context: context || {},
    });
  }

  function resolveAssetUrl(assetPath) {
    const normalizedPath = String(assetPath || "").replace(/^\/+/, "");
    const bootstrapSrc = CCP && CCP.bootstrapScriptSrc ? String(CCP.bootstrapScriptSrc) : "";
    if (!normalizedPath) return "";
    try {
      if (bootstrapSrc) {
        return new URL(normalizedPath, bootstrapSrc).toString();
      }
    } catch (error) {
      console.warn(LOG_PREFIX, "Failed resolving asset URL from bootstrap src", normalizedPath, error);
    }
    try {
      if (
        typeof chrome !== "undefined" &&
        chrome &&
        chrome.runtime &&
        typeof chrome.runtime.getURL === "function"
      ) {
        return chrome.runtime.getURL(normalizedPath);
      }
    } catch (error) {
      console.warn(LOG_PREFIX, "Failed resolving asset URL from runtime API", normalizedPath, error);
    }
    return normalizedPath;
  }

  function createValidationUiState() {
    return {
      mounted: false,
      panelOpen: false,
      root: null,
      button: null,
      badge: null,
      currentFlowBadge: null,
      severityBadgeError: null,
      severityBadgeWarning: null,
      severityTabBar: null,
      severityTabButtons: { 1: null, 2: null, 3: null },
      severityTabCounts: { 1: null, 2: null, 3: null },
      severityTabUnderlines: { 1: null, 2: null, 3: null },
      suppressedTabButton: null,
      suppressedTabCount: null,
      suppressedTabUnderline: null,
      activeSeverityTab: null,
      integritySearchQuery: "",
      integritySearchWrap: null,
      integritySearchInput: null,
      integrityHeaderTools: null,
      integrityCopyControl: null,
      integrityCopyMain: null,
      integrityCopyActionButton: null,
      integrityCopyFormatButton: null,
      integrityCopyFormatMenu: null,
      integrityExportFormat: null,
      integrityExportFormatOutsideHandler: null,
      integrityCopyFeedbackTimer: null,
      dismissPickerOverlay: null,
      panel: null,
      list: null,
      chartOverlay: null,
      outsideHandler: null,
      incomingPopover: null,
      incomingOutsideHandler: null,
      visualsBound: false,
      repaintQueued: false,
      wheelHandler: null,
      resizeHandler: null,
      keydownHandler: null,
      chartMutationObserver: null,
      chartMutationRefreshTimer: null,
      commentTooltip: null,
      commentHoverBound: false,
      commentMoveHandler: null,
      commentLeaveHandler: null,
      fabLogo: null,
      dock: null,
      flowChatRoot: null,
      reloadButton: null,
      reloadIcon: null,
      dockResizeHandler: null,
      analysisSpinner: null,
      analysisPending: false,
      fixAllBar: null,
      fixAllInFlight: false,
    };
  }

  function createInitialNamingState() {
    return {
      bearerToken: null,
      baseUrl: null,
      rawFetch: null,
      flowsCache: {
        byId: new Map(),
        byRefId: new Map(),
      },
      chartCache: new Map(),
      nodeDetailsCache: new Map(),
      validation: {
        flowsLoaded: false,
        currentFlowChartLoaded: false,
        currentFlowId: "",
        projectId: "",
        runInFlight: false,
        rerunRequested: false,
        pendingTimer: null,
        hydrationInFlight: 0,
        errors: [],
        sameFlowEdges: [],
        incomingExternalTargets: {},
        deadPathNodeIds: [],
        dirtyChartLoadFlowIds: new Set(),
        dirtyDetailFlowRefreshById: new Map(),
        baselinePrepared: false,
        analysisCompletedOnce: false,
        initialAnalysisGate: {
          mapInitFinished: false,
          validationCompleted: false,
          namingScanCompleted: false,
          validationFinishPending: false,
        },
        namingConventionIssues: [],
        namingScanInFlight: false,
        namingScanTimer: null,
        ui: createValidationUiState(),
      },
      knownFlowIds: new Set(),
    };
  }

  function ensureNamingStateShape(state) {
    const base = state || {};
    base.flowsCache = base.flowsCache || { byId: new Map(), byRefId: new Map() };
    if (!(base.flowsCache.byId instanceof Map)) base.flowsCache.byId = new Map();
    if (!(base.flowsCache.byRefId instanceof Map)) base.flowsCache.byRefId = new Map();
    if (!(base.chartCache instanceof Map)) base.chartCache = new Map();
    if (!(base.nodeDetailsCache instanceof Map)) base.nodeDetailsCache = new Map();
    if (!(base.knownFlowIds instanceof Set)) base.knownFlowIds = new Set();
    base.validation = base.validation || {};
    const validation = base.validation;
    if (!(validation.dirtyChartLoadFlowIds instanceof Set)) validation.dirtyChartLoadFlowIds = new Set();
    if (!(validation.dirtyDetailFlowRefreshById instanceof Map))
      validation.dirtyDetailFlowRefreshById = new Map();
    if (typeof validation.baselinePrepared !== "boolean") validation.baselinePrepared = false;
    if (typeof validation.flowsLoaded !== "boolean") validation.flowsLoaded = false;
    if (typeof validation.currentFlowChartLoaded !== "boolean") validation.currentFlowChartLoaded = false;
    if (!Array.isArray(validation.errors)) validation.errors = [];
    if (!Array.isArray(validation.namingConventionIssues)) validation.namingConventionIssues = [];
    if (!Array.isArray(validation.sameFlowEdges)) validation.sameFlowEdges = [];
    if (!Array.isArray(validation.deadPathNodeIds)) validation.deadPathNodeIds = [];
    if (!validation.incomingExternalTargets || typeof validation.incomingExternalTargets !== "object") {
      validation.incomingExternalTargets = {};
    }
    if (typeof validation.analysisCompletedOnce !== "boolean") validation.analysisCompletedOnce = false;
    if (!validation.initialAnalysisGate || typeof validation.initialAnalysisGate !== "object") {
      validation.initialAnalysisGate = {
        mapInitFinished: false,
        validationCompleted: false,
        namingScanCompleted: false,
        validationFinishPending: false,
      };
    } else if (typeof validation.initialAnalysisGate.validationFinishPending !== "boolean") {
      validation.initialAnalysisGate.validationFinishPending = false;
    }
    validation.ui = Object.assign(createValidationUiState(), validation.ui || {});
    return base;
  }

  const NAMING_STATE_KEY = "__cognigyCopilotNamingState";
  const existingNamingState = window[NAMING_STATE_KEY];
  const namingState = ensureNamingStateShape(existingNamingState || createInitialNamingState());
  window[NAMING_STATE_KEY] = namingState;
  // Will be lazily created once we have an API context + project id.
  namingState.map = namingState.map || null;

  let namingEngineInstance = null;

  function ensureNamingEngine() {
    if (namingEngineInstance) return namingEngineInstance;
    const namingMod = CCP.naming;
    if (!namingMod || typeof namingMod.createEngine !== "function") return null;
    namingEngineInstance = namingMod.createEngine({
      getFlowById: getFlowById,
      getFlowByRefId: getFlowByRefId,
      getChart: function (flowId) {
        return namingState.chartCache.get(String(flowId));
      },
      getNodeDetails: getNodeDetails,
      resolveNodeSummaryByRefId: resolveNodeSummaryByRefId,
      log: namingLogDebug,
    });
    return namingEngineInstance;
  }

  async function computeLabel(nodeType, extension, config, flowId, oldLabel, context) {
    const engine = ensureNamingEngine();
    if (!engine) return { label: null, analyticsLabel: null };
    return engine.computeLabel(nodeType, extension, config, flowId, oldLabel, context);
  }

  function sanitizeAnalyticsLabel(label) {
    const namingMod = CCP.naming;
    if (namingMod && typeof namingMod.sanitizeAnalyticsLabel === "function") {
      return namingMod.sanitizeAnalyticsLabel(label);
    }
    return String(label || "");
  }

  function analyticsLabelForNode(nodeType, nodeLabel) {
    const namingMod = CCP.naming;
    if (namingMod && typeof namingMod.buildAnalyticsLabelForNode === "function") {
      const value = namingMod.buildAnalyticsLabelForNode(nodeType, nodeLabel);
      return value == null ? null : value;
    }
    return sanitizeAnalyticsLabel("node_" + String(nodeLabel || ""));
  }

  /**
   * Lazily create the `CognigyProjectMap` instance once the page world has
   * a project id and the project-map modules are loaded. Returns the
   * existing instance on subsequent calls.
   *
   * Wires `issues-changed` / `load-progress` / `init-finished` events into
   * the FAB validation widget so the UI reflects map state automatically.
   */
  function markInitialAnalysisPending() {
    if (namingState.validation.analysisCompletedOnce) return;
    namingState.validation.ui.analysisPending = true;
  }

  function ensureInitialAnalysisGate() {
    const validation = namingState.validation;
    if (!validation.initialAnalysisGate || typeof validation.initialAnalysisGate !== "object") {
      validation.initialAnalysisGate = {
        mapInitFinished: false,
        validationCompleted: false,
        namingScanCompleted: false,
        validationFinishPending: false,
      };
    } else if (typeof validation.initialAnalysisGate.validationFinishPending !== "boolean") {
      validation.initialAnalysisGate.validationFinishPending = false;
    }
    return validation.initialAnalysisGate;
  }

  function bootstrapInitialAnalysisIfMapReady() {
    const map = namingState.map;
    if (!map || !map._initialized) return;
    const gate = ensureInitialAnalysisGate();
    if (gate.mapInitFinished) return;
    gate.mapInitFinished = true;
    scheduleNamingConventionScan("map-already-initialized");
    scheduleCrossFlowValidation("map-already-initialized", {
      immediate: true,
      forceDuringHydration: true,
    });
    tryFinishInitialAnalysis();
  }

  function tryFinishInitialAnalysis() {
    const state = namingState.validation;
    if (state.analysisCompletedOnce) return;

    const gate = ensureInitialAnalysisGate();
    const map = namingState.map;

    if (map && map._initialized && !gate.mapInitFinished) {
      gate.mapInitFinished = true;
    }

    if (!gate.namingScanCompleted) return;

    if (!gate.validationCompleted) {
      if (state.runInFlight || state.namingScanInFlight || state.hydrationInFlight > 0) return;
      if (state.flowsLoaded && state.currentFlowChartLoaded) {
        if (!gate.validationFinishPending) {
          gate.validationFinishPending = true;
          scheduleCrossFlowValidation("initial-analysis-gate", {
            immediate: true,
            forceDuringHydration: true,
          });
        }
        return;
      }
      gate.validationCompleted = true;
    }

    if (state.hydrationInFlight > 0 || state.runInFlight || state.namingScanInFlight) return;

    state.analysisCompletedOnce = true;
    state.ui.analysisPending = false;
    try {
      renderValidationWidget();
      renderChartValidationVisuals();
    } catch (_) {}
  }

  function ensureProjectMap() {
    if (namingState.map) {
      bootstrapInitialAnalysisIfMapReady();
      return namingState.map;
    }
    const pmRoot = (window.__CCP__ && window.__CCP__.projectMap) || null;
    if (
      !pmRoot ||
      !pmRoot.CognigyProjectMap ||
      typeof pmRoot.createApiClient !== "function" ||
      typeof pmRoot.createStorage !== "function"
    ) {
      return null;
    }
    const projectId = getProjectIdFromLocation();
    if (!projectId) return null;

    const apiClient = pmRoot.createApiClient({
      getAuth: function () {
        return {
          baseUrl: namingState.baseUrl || "",
          bearerToken: namingState.bearerToken || "",
        };
      },
      rawFetch: namingState.rawFetch || window.fetch.bind(window),
      log: namingLogDebug,
    });
    const storage = pmRoot.createStorage({});
    const map = new pmRoot.CognigyProjectMap({
      projectId: projectId,
      apiClient: apiClient,
      storage: storage,
      log: namingLogDebug,
    });
    namingState.map = map;

    map.addEventListener("issues-changed", function () {
      try {
        scheduleNamingConventionScan("issues-changed");
        renderValidationWidget();
        renderChartValidationVisuals();
      } catch (e) {
        console.warn(NAMING_LOG_PREFIX, "issues-changed handler failed", e);
      }
    });
    map.addEventListener("load-progress", function (evt) {
      try {
        const detail = (evt && evt.detail) || {};
        const stage = String(detail.stage || "");
        // The first init pass goes through several stages
        // (flows-list/flows-load/extensions/llms/connections); we treat
        // anything other than "done" as still pending, so the FAB shows
        // its loading spinner.
        if (stage && stage !== "done") {
          if (!namingState.validation.analysisCompletedOnce) {
            markInitialAnalysisPending();
            renderValidationWidget();
          }
        }
      } catch (_) {}
    });
    map.addEventListener("init-finished", function () {
      try {
        ensureInitialAnalysisGate().mapInitFinished = true;
        scheduleNamingConventionScan("init-finished");
        scheduleCrossFlowValidation("init-finished", {
          immediate: true,
          forceDuringHydration: true,
        });
        tryFinishInitialAnalysis();
      } catch (_) {}
    });
    map.addEventListener("error", function (evt) {
      try {
        const detail = (evt && evt.detail) || {};
        console.warn(NAMING_LOG_PREFIX, "project-map error", detail.stage, detail.error);
      } catch (_) {}
    });

    // If we already have a bearer token + base URL from a prior intercept,
    // hand them over so the map can kick off its initial load.
    if (namingState.bearerToken && namingState.baseUrl) {
      map.setApiContext({
        bearerToken: namingState.bearerToken,
        baseUrl: namingState.baseUrl,
      });
    }
    // Seed currentFlowId from URL so per-flow badges work immediately.
    try {
      map.setCurrentFlowId(getCurrentFlowIdFromLocation());
    } catch (_) {}
    return map;
  }

  function parseUrl(input) {
    try {
      if (typeof input === "string") {
        const parsed = new URL(input, window.location.origin);
        namingLogDebug("parseUrl resolved string input", {
          href: parsed.href,
          pathname: parsed.pathname,
        });
        return parsed;
      }
      if (input instanceof Request) {
        const parsed = new URL(input.url, window.location.origin);
        namingLogDebug("parseUrl resolved Request input", {
          href: parsed.href,
          pathname: parsed.pathname,
          method: input.method || "GET",
        });
        return parsed;
      }
    } catch (error) {
      namingLogDebug("parseUrl failed", { error: String(error) });
    }
    namingLogDebug("parseUrl returned null (unsupported input type)");
    return null;
  }

  function parseJsonSafe(text) {
    try {
      const parsed = JSON.parse(text);
      namingLogDebug("parseJsonSafe succeeded", {
        length: text ? String(text).length : 0,
        shape: summarizeBodyShape(parsed),
      });
      return parsed;
    } catch (error) {
      namingLogDebug("parseJsonSafe failed", {
        error: String(error),
        preview: clipDebugValue(text || "", 220),
      });
      return null;
    }
  }

  function getOwnMarker(headers) {
    if (!headers) return false;
    if (headers instanceof Headers) {
      return headers.get(OWN_FETCH_MARKER_HEADER) === OWN_FETCH_MARKER_VALUE;
    }
    if (Array.isArray(headers)) {
      for (const pair of headers) {
        if (Array.isArray(pair) && String(pair[0]).toLowerCase() === OWN_FETCH_MARKER_HEADER) {
          return String(pair[1]) === OWN_FETCH_MARKER_VALUE;
        }
      }
      return false;
    }
    const keys = Object.keys(headers);
    for (const k of keys) {
      if (k.toLowerCase() === OWN_FETCH_MARKER_HEADER) {
        return String(headers[k]) === OWN_FETCH_MARKER_VALUE;
      }
    }
    return false;
  }

  function extractAuthHeader(req, init) {
    let auth = "";
    try {
      auth = req.headers.get("authorization") || "";
    } catch (_) {}
    if (!auth && init && init.headers) {
      const h = new Headers(init.headers);
      auth = h.get("authorization") || "";
    }
    return auth;
  }

  function rememberApiContext(urlObj, authHeader) {
    if (!urlObj) return;
    const isCognigyApiRoute =
      typeof urlObj.pathname === "string" && urlObj.pathname.startsWith(API_VERSION_SEGMENT + "/");
    if (isCognigyApiRoute && urlObj.origin && namingState.baseUrl !== urlObj.origin) {
      namingState.baseUrl = urlObj.origin;
      console.log(NAMING_LOG_PREFIX, "captured baseUrl", namingState.baseUrl);
    }
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      namingState.bearerToken = authHeader;
      namingLogDebug("captured bearer token from intercepted request", {
        tokenPreview: clipDebugValue(authHeader, 24),
      });
    } else {
      namingLogDebug("no bearer token found on request");
    }
    // Push the latest context into the project map (lazy-creates it on
    // first call). The map's own `setApiContext` will trigger its initial
    // load once both bearer + base URL + project id are known.
    try {
      const map = ensureProjectMap();
      if (map) {
        const pid = getProjectIdFromLocation();
        if (pid && pid !== map.projectId) {
          map.setProjectId(pid);
        }
        map.setApiContext({
          bearerToken: namingState.bearerToken || "",
          baseUrl: namingState.baseUrl || "",
        });
        const cur = getCurrentFlowIdFromLocation();
        if (cur && cur !== map.getCurrentFlowId()) {
          map.setCurrentFlowId(cur);
        }
      }
    } catch (e) {
      console.warn(NAMING_LOG_PREFIX, "rememberApiContext: project-map sync failed", e);
    }
  }

  function isFlowsListRoute(urlObj) {
    if (!urlObj) return false;
    return urlObj.pathname === API_VERSION_SEGMENT + "/flows" && !!urlObj.searchParams.get("projectId");
  }

  function isChartRoute(urlObj) {
    if (!urlObj) return false;
    return /^\/new\/v2\.0\/flows\/[a-z0-9]{24}\/chart$/i.test(urlObj.pathname);
  }

  function isCreateNodeRoute(urlObj) {
    if (!urlObj) return false;
    return /^\/new\/v2\.0\/flows\/[a-z0-9]{24}\/chart\/nodes$/i.test(urlObj.pathname);
  }

  function isPatchNodeRoute(urlObj) {
    if (!urlObj) return false;
    return /^\/new\/v2\.0\/flows\/[a-z0-9]{24}\/chart\/nodes\/[a-z0-9]{24}$/i.test(urlObj.pathname);
  }

  function isDeleteNodeRoute(urlObj) {
    return isPatchNodeRoute(urlObj);
  }

  function extractFlowIdFromPath(pathname) {
    const match = pathname.match(/^\/new\/v2\.0\/flows\/([a-z0-9]{24})(?:\/|$)/i);
    return match ? match[1] : "";
  }

  function extractNodeIdFromPatchPath(pathname) {
    const match = pathname.match(/^\/new\/v2\.0\/flows\/[a-z0-9]{24}\/chart\/nodes\/([a-z0-9]{24})$/i);
    return match ? match[1] : "";
  }

  function getCurrentFlowIdFromLocation() {
    const match = String(window.location.pathname || "").match(/\/flow\/([a-z0-9]{24})/i);
    return match ? String(match[1]) : "";
  }

  function getProjectIdFromLocation() {
    const match = String(window.location.pathname || "").match(/\/project\/([a-z0-9]{24})\//i);
    return match ? String(match[1]) : "";
  }

  function getLinkBaseFromLocation() {
    const href = String(window.location.href || "");
    const match = href.match(
      /^(https?:\/\/[^/]+\/project\/[a-z0-9]{24}\/[a-z0-9]{24})\/flow\/[a-z0-9]{24}\/chart(?:\/[a-z0-9]{24})?/i
    );
    if (match) return String(match[1]);
    const origin = String(window.location.origin || "");
    const pathMatch = String(window.location.pathname || "").match(
      /^(\/project\/[a-z0-9]{24}\/[a-z0-9]{24})/i
    );
    return pathMatch ? origin + String(pathMatch[1]) : origin;
  }

  function buildNodeLink(flowId, nodeId) {
    const base = getLinkBaseFromLocation();
    return String(base) + "/flow/" + String(flowId) + "/chart/" + String(nodeId);
  }
  function getChartContentElement() {
    return document.querySelector("#chartContent");
  }

  function getNodeWrapperElement(nodeId) {
    if (!nodeId) return null;
    try {
      return document.getElementById(String(nodeId));
    } catch (_) {
      return null;
    }
  }

  function getVisibleNodeElement(nodeId) {
    const wrapper = getNodeWrapperElement(nodeId);
    if (!wrapper) return null;
    const directKnown = wrapper.querySelector(".chartNode-normal, .chartNode-mini");
    if (directKnown) return directKnown;

    const chartNodeLike = wrapper.querySelectorAll('[class*="chartNode-"]');
    for (const candidate of chartNodeLike) {
      const cls = String((candidate && candidate.className) || "");
      if (cls.indexOf("cognigy-copilot-") >= 0) continue;
      return candidate;
    }

    const draggable = wrapper.querySelector('[draggable="true"]');
    if (draggable) return draggable;
    return wrapper.firstElementChild;
  }

  function getNodeAnchorRect(nodeId) {
    const visible = getVisibleNodeElement(nodeId);
    if (visible) return visible.getBoundingClientRect();
    const wrapper = getNodeWrapperElement(nodeId);
    return wrapper ? wrapper.getBoundingClientRect() : null;
  }

  function centerAndClickCurrentFlowNode(nodeId) {
    const target = getVisibleNodeElement(nodeId) || getNodeWrapperElement(nodeId);
    if (!target) return;
    try {
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    } catch (_) {}
    requestAnimationFrame(function () {
      try {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      } catch (_) {
        try {
          target.click();
        } catch (_) {}
      }
    });
  }

  function findNodeIdFromElement(element) {
    let cursor = element;
    while (cursor && cursor !== document.documentElement) {
      const id = cursor.id ? String(cursor.id) : "";
      if (/^[a-z0-9]{24}$/i.test(id)) return id;
      cursor = cursor.parentElement;
    }
    return "";
  }

  function getNodeCommentFromSummary(nodeSummary) {
    if (!nodeSummary || typeof nodeSummary !== "object") return "";
    const directComment = nodeSummary.comment;
    if (typeof directComment === "string" && directComment.trim()) return directComment.trim();
    const configComment = nodeSummary.config && nodeSummary.config.comment;
    if (typeof configComment === "string" && configComment.trim()) return configComment.trim();
    return "";
  }

  function ensureCommentTooltipElement() {
    const ui = namingState.validation.ui;
    if (ui.commentTooltip && ui.commentTooltip.isConnected) return ui.commentTooltip;
    const tooltip = document.createElement("div");
    tooltip.className = "cognigy-copilot-comment-tooltip";
    tooltip.style.position = "fixed";
    tooltip.style.zIndex = "2147483647";
    tooltip.style.maxWidth = "360px";
    tooltip.style.padding = "8px 10px";
    tooltip.style.borderRadius = "8px";
    tooltip.style.background = "rgba(24, 24, 27, 0.96)";
    tooltip.style.color = "#f4f4f5";
    tooltip.style.border = "1px solid rgba(244, 244, 245, 0.18)";
    tooltip.style.boxShadow = "0 12px 28px rgba(0,0,0,0.36)";
    tooltip.style.fontSize = "12px";
    tooltip.style.lineHeight = "1.4";
    tooltip.style.whiteSpace = "pre-wrap";
    tooltip.style.pointerEvents = "none";
    tooltip.style.display = "none";
    document.documentElement.appendChild(tooltip);
    ui.commentTooltip = tooltip;
    return tooltip;
  }

  function hideCommentTooltip() {
    const ui = namingState.validation.ui;
    if (!ui.commentTooltip || !ui.commentTooltip.isConnected) return;
    ui.commentTooltip.style.display = "none";
    ui.commentTooltip.textContent = "";
  }

  function findCommentAnchorFromTarget(target) {
    if (!target || !target.closest) return null;
    const svg = target.closest('svg[viewBox="0 0 18 16"]');
    if (!svg) return null;
    const path = svg.querySelector("path");
    const d = path && path.getAttribute ? String(path.getAttribute("d") || "") : "";
    if (!d || d.indexOf("M16 0H2C0.895431") === -1) return null;
    const chartNode = svg.closest(".chartNode-normal, [class*='chartNode-']");
    if (!chartNode) return { anchor: svg, svg };
    let anchor = svg;
    let cursor = svg;
    while (cursor && cursor.parentElement && cursor.parentElement !== chartNode) {
      cursor = cursor.parentElement;
      anchor = cursor;
    }
    return { anchor, svg };
  }

  function showCommentTooltipForMarker(anchor, commentText) {
    if (!anchor || !commentText) {
      hideCommentTooltip();
      return;
    }
    const tooltip = ensureCommentTooltipElement();
    const markerRect = anchor.getBoundingClientRect();
    const showBelow = markerRect.top < window.innerHeight * 0.5;

    tooltip.textContent = commentText;
    tooltip.style.display = "block";
    tooltip.style.visibility = "hidden";
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";

    const tooltipHeight = Math.max(1, tooltip.offsetHeight);
    const tooltipWidth = Math.max(1, tooltip.offsetWidth);
    const margin = 4;
    const left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, markerRect.right - tooltipWidth));
    const top = showBelow ? markerRect.bottom : markerRect.top - tooltipHeight;
    tooltip.style.left = Math.max(8, left) + "px";
    tooltip.style.top =
      Math.max(8, Math.min(window.innerHeight - tooltipHeight - 8, top + (showBelow ? margin : -margin))) +
      "px";
    tooltip.style.visibility = "visible";
  }

  function handleCommentHoverMove(event) {
    const target = event && event.target ? event.target : null;
    const match = findCommentAnchorFromTarget(target);
    if (!match) {
      hideCommentTooltip();
      return;
    }
    const anchor = match.anchor;
    const svg = match.svg;
    let rect = anchor.getBoundingClientRect();
    if ((rect.width <= 0 || rect.height <= 0) && svg) {
      const svgRect = svg.getBoundingClientRect();
      if (svgRect.width > 0 && svgRect.height > 0) {
        rect = svgRect;
      }
    }
    if (rect.width <= 0 || rect.height <= 0) {
      hideCommentTooltip();
      return;
    }
    const nodeId = findNodeIdFromElement(anchor);
    const flowId = getCurrentFlowIdFromLocation();
    if (!flowId || !nodeId) {
      hideCommentTooltip();
      return;
    }
    const chart = namingState.chartCache.get(String(flowId));
    const nodeSummary = chart && chart.nodesById ? chart.nodesById.get(String(nodeId)) : null;
    const commentText = getNodeCommentFromSummary(nodeSummary);
    if (!commentText) {
      hideCommentTooltip();
      return;
    }
    showCommentTooltipForMarker(anchor, commentText);
  }

  function bindCommentHoverIfNeeded() {
    const ui = namingState.validation.ui;
    if (ui.commentHoverBound) return;
    const chart = getChartContentElement();
    if (!chart) return;
    ui.commentHoverBound = true;
    ui.commentMoveHandler = function (event) {
      handleCommentHoverMove(event);
    };
    ui.commentLeaveHandler = function () {
      hideCommentTooltip();
    };
    chart.addEventListener("mousemove", ui.commentMoveHandler, true);
    chart.addEventListener("mouseleave", ui.commentLeaveHandler, true);
  }

  const COGNIGY_COPILOT_CHART_NODE_STYLE_ID = "cognigy-copilot-chart-node-styles";

  function ensureCopilotChartNodeStylesInjected() {
    let style = document.getElementById(COGNIGY_COPILOT_CHART_NODE_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = COGNIGY_COPILOT_CHART_NODE_STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = [
      "/* Cognigy Copilot: category fill, validation overlay, theme chrome overrides */",
      '#chartContent .chartNode[data-cognigy-copilot-node-chrome-reset="1"] {',
      "  border: none !important;",
      "  outline: none !important;",
      "  box-shadow: none !important;",
      "}",
      '#chartContent [data-cognigy-copilot-node-category-bg="1"] {',
      "  position: relative !important;",
      "  border: none !important;",
      "  border-bottom: none !important;",
      "  outline: none !important;",
      "  box-shadow: none !important;",
      "}",
      "/* Cognigy mini-node: decorative empty strip under the row (often reads as a blue bar) */",
      '#chartContent [data-cognigy-copilot-node-category-bg="1"] > div:last-child:empty {',
      "  display: none !important;",
      "  height: 0 !important;",
      "  min-height: 0 !important;",
      "  overflow: hidden !important;",
      "}",
      "/* chartNode-normal: strip sits inside the last top-level column (e.g. empty jss285 sibling under label) */",
      '#chartContent [data-cognigy-copilot-node-category-bg="1"] > div:last-child > div:last-child:empty {',
      "  display: none !important;",
      "  height: 0 !important;",
      "  min-height: 0 !important;",
      "  overflow: hidden !important;",
      "  border: none !important;",
      "  background: none !important;",
      "  box-shadow: none !important;",
      "}",
      '#chartContent [data-cognigy-copilot-node-category-bg="1"] > div:last-child {',
      "  border-bottom: none !important;",
      "  box-shadow: none !important;",
      "}",
      "/* Dead path: inset tint only — layout-neutral. */",
      "#chartContent .cognigy-copilot-node-dead-path {",
      "  border: none !important;",
      "  outline: none !important;",
      "  box-shadow: inset 0 0 0 9999px rgba(10, 14, 24, 0.4) !important;",
      "}",
      "/* If / Switch / Once: dead path darkens SVG fill only (no inset shadow). */",
      '#chartContent .cognigy-copilot-node-dead-path[data-cognigy-copilot-yellow-shape-dead="1"] {',
      "  box-shadow: none !important;",
      "}",
      "/* Error: white base, red 0.6 overlay, outer red glow (multi box-shadow). */",
      "#chartContent .cognigy-copilot-node-error {",
      "  background-color: #ffffff !important;",
      "  background-image: none !important;",
      "  border: none !important;",
      "  outline: none !important;",
      "  box-shadow:",
      "    inset 0 0 0 9999px rgba(220, 38, 38, 0.6),",
      "    0 0 0 1px rgba(220, 38, 38, 0.35),",
      "    0 0 12px 2px rgba(220, 38, 38, 0.5),",
      "    0 0 24px 6px rgba(220, 38, 38, 0.28) !important;",
      "}",
      "/* Error wins over dead-path; same look when both classes present. */",
      "#chartContent .cognigy-copilot-node-error.cognigy-copilot-node-dead-path {",
      "  background-color: #ffffff !important;",
      "  background-image: none !important;",
      "  border: none !important;",
      "  outline: none !important;",
      "  box-shadow:",
      "    inset 0 0 0 9999px rgba(220, 38, 38, 0.6),",
      "    0 0 0 1px rgba(220, 38, 38, 0.35),",
      "    0 0 12px 2px rgba(220, 38, 38, 0.5),",
      "    0 0 24px 6px rgba(220, 38, 38, 0.28) !important;",
      "}",
      "/* Floating validation badges — corner float on wrapper; transform centers on content TL */",
      "#chartContent .cognigy-copilot-validation-badge {",
      "  position: absolute;",
      "  z-index: 0;",
      "  box-sizing: border-box;",
      "  min-width: 22px;",
      "  min-height: 22px;",
      "  padding: 2px;",
      "  border-radius: 6px;",
      "  background: #ffffff !important;",
      "  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  pointer-events: none !important;",
      "  transform: translate(-50%, -50%);",
      "}",
      "#chartContent .cognigy-copilot-validation-badge--error,",
      "#chartContent .cognigy-copilot-validation-badge--dead {",
      "  font-size: 16px;",
      "  line-height: 1;",
      "}",
    ].join("\n");
  }

  function resetChartNodeOuterChrome(nodeId, enabled) {
    const wrapper = getNodeWrapperElement(nodeId);
    if (!wrapper) return;
    if (enabled) {
      wrapper.setAttribute("data-cognigy-copilot-node-chrome-reset", "1");
    } else {
      wrapper.removeAttribute("data-cognigy-copilot-node-chrome-reset");
    }
  }

  function closeIncomingPopover() {
    const ui = namingState.validation.ui;
    if (ui.incomingPopover && ui.incomingPopover.isConnected) {
      ui.incomingPopover.remove();
    }
    ui.incomingPopover = null;
    if (ui.incomingOutsideHandler) {
      document.removeEventListener("mousedown", ui.incomingOutsideHandler, true);
      ui.incomingOutsideHandler = null;
    }
  }

  function clearValidationNodeVisuals() {
    /* Do not call closeIncomingPopover() here — this runs on every chart repaint
       (queueChartVisualRefresh / renderChartValidationVisuals) and would instantly
       dismiss the "incoming from outside" popover the user just opened. */
    hideCommentTooltip();
    const chart = getChartContentElement();
    if (!chart) return;
    try {
      chart
        .querySelectorAll('svg path[data-cognigy-copilot-validation-svg-overlay="1"]')
        .forEach(function (p) {
          p.remove();
        });
    } catch (_) {}
    try {
      chart.querySelectorAll('[data-cognigy-copilot-svg-overlay-active="1"]').forEach(function (el) {
        el.removeAttribute("data-cognigy-copilot-svg-overlay-active");
      });
    } catch (_) {}
    const highlighted = chart.querySelectorAll(
      ".cognigy-copilot-node-error, .cognigy-copilot-node-dead-path"
    );
    highlighted.forEach((el) => {
      el.classList.remove("cognigy-copilot-node-error");
      el.classList.remove("cognigy-copilot-node-dead-path");
      el.style.boxShadow = "";
      el.style.border = "";
      el.style.backgroundColor = "";
      el.style.backgroundImage = "";
      el.style.backgroundRepeat = "";
      el.style.backgroundPosition = "";
      el.style.backgroundSize = "";
    });
    const chromeResets = chart.querySelectorAll('[data-cognigy-copilot-node-chrome-reset="1"]');
    chromeResets.forEach((el) => el.removeAttribute("data-cognigy-copilot-node-chrome-reset"));
    const deadWrappers = chart.querySelectorAll('[data-cognigy-copilot-dead-wrapper="1"]');
    deadWrappers.forEach((wrapper) => {
      wrapper.removeAttribute("data-cognigy-copilot-dead-wrapper");
      wrapper.style.filter = "";
      wrapper.style.opacity = "";
    });
    const deadSvgPaths = chart.querySelectorAll('[data-cognigy-copilot-dead-path-shape="1"]');
    deadSvgPaths.forEach((path) => {
      path.removeAttribute("data-cognigy-copilot-dead-path-shape");
      path.style.fill = "";
      path.style.stroke = "";
    });
    const badges = chart.querySelectorAll(".cognigy-copilot-incoming-badge");
    badges.forEach((el) => el.remove());
    chart.querySelectorAll(".cognigy-copilot-validation-badge").forEach(function (el) {
      el.remove();
    });
    try {
      chart.querySelectorAll('[data-cognigy-copilot-yellow-shape-dead="1"]').forEach(function (el) {
        el.removeAttribute("data-cognigy-copilot-yellow-shape-dead");
      });
      chart.querySelectorAll('[data-cognigy-copilot-yellow-svg-node="1"]').forEach(function (el) {
        el.removeAttribute("data-cognigy-copilot-yellow-svg-node");
      });
    } catch (_) {}
  }

  const FLOW_CONTROL_YELLOW = "rgb(255, 194, 55)";
  const FLOW_CONTROL_YELLOW_DEAD_FILL = "rgba(157, 122, 46)";

  function isYellowSvgShapeNodeType(nodeType) {
    const lower = String(nodeType || "")
      .trim()
      .toLowerCase();
    return lower === "if" || lower === "switch" || lower === "once";
  }

  function applyYellowShapeNodeSvgFills(visible, dead) {
    if (!visible || !visible.querySelector) return;
    const fill = dead ? FLOW_CONTROL_YELLOW_DEAD_FILL : FLOW_CONTROL_YELLOW;
    const svg = visible.querySelector("svg");
    if (!svg) return;
    svg.querySelectorAll("path").forEach(function (path) {
      if (path.getAttribute("fill") === "none") return;
      path.setAttribute("data-cognigy-copilot-node-category-shape", "1");
      path.style.setProperty("fill", fill, "important");
    });
  }

  function getNodeCategoryBackgroundByType(nodeType) {
    const type = String(nodeType || "").trim();
    if (!type) return "";
    const lower = type.toLowerCase();

    // Unimportant helpers (must run before broad AI "ai" substring — e.g. "placeholder")
    if (lower === "debugmessage" || lower === "log" || lower === "placeholder") {
      return "rgba(113, 113, 122, 0.22)";
    }

    // Utils (profile, context, analytics, goals, ratings, transcript, availability, …)
    if (
      lower === "activateprofile" ||
      lower === "deactivateprofile" ||
      lower === "deleteprofile" ||
      lower === "mergeprofile" ||
      lower === "updateprofile" ||
      lower === "addtocontext" ||
      lower === "removefromcontext" ||
      lower === "resetcontext" ||
      lower === "overwriteanalytics" ||
      lower === "requestrating" ||
      lower === "setrating" ||
      lower === "completegoal" ||
      lower === "trackgoal" ||
      lower === "gettranscript" ||
      lower === "checkagentavailability" ||
      lower === "handovertoagent" ||
      lower === "searchextractoutput"
    ) {
      return "rgba(100, 116, 139, 0.32)";
    }

    // Integration / Technik (before AI — e.g. "email" contains "ai")
    if (
      lower === "httprequest" ||
      lower === "emailnotification" ||
      lower === "sendemail" ||
      lower === "code"
    ) {
      return "#9483d4";
    }

    // Flow control: Then / Else / Case / … (background; dead path uses normal inset shadow)
    if (
      lower === "then" ||
      lower === "else" ||
      lower === "onfirstexecution" ||
      lower === "afterwards" ||
      lower === "default" ||
      lower === "case"
    ) {
      return FLOW_CONTROL_YELLOW;
    }

    // Flow Control
    if (
      lower === "start" ||
      lower === "end" ||
      lower === "goto" ||
      lower === "executeflow" ||
      lower === "executre" ||
      lower === "stop" ||
      lower === "stopandreturn" ||
      lower === "sleep" ||
      lower === "think" ||
      lower === "wait" ||
      lower === "triggerfunction"
    ) {
      return "#6ad38e";
    }

    // Responses (user-facing messages / input)
    if (
      lower === "say" ||
      lower === "question" ||
      lower === "optionalquestion" ||
      lower === "onquestion" ||
      lower === "onanswer" ||
      lower === "datepicker"
    ) {
      return "#e59a4c";
    }

    // AI / Agents
    if (
      lower === "llmpromptv2" ||
      lower === "llmpromptdefault" ||
      lower === "llmprompttool" ||
      lower === "aiagenttoolanswer" ||
      lower.indexOf("ai") >= 0 ||
      lower.indexOf("agent") >= 0 ||
      lower.indexOf("llm") >= 0
    ) {
      return "#46a2ff";
    }
    return "";
  }

  function applyCurrentFlowNodeCategoryBackgrounds() {
    ensureCopilotChartNodeStylesInjected();
    const currentFlowId = getCurrentFlowIdFromLocation();
    if (!currentFlowId) return;
    const chartContent = getChartContentElement();
    if (chartContent) {
      const previouslyStyled = chartContent.querySelectorAll('[data-cognigy-copilot-node-category-bg="1"]');
      previouslyStyled.forEach((el) => {
        el.removeAttribute("data-cognigy-copilot-node-category-bg");
        el.style.backgroundColor = "";
      });
      chartContent
        .querySelectorAll('[data-cognigy-copilot-node-category-shape="1"]')
        .forEach(function (path) {
          path.removeAttribute("data-cognigy-copilot-node-category-shape");
          path.style.fill = "";
          path.style.stroke = "";
        });
      chartContent.querySelectorAll('[data-cognigy-copilot-yellow-svg-node="1"]').forEach(function (el) {
        el.removeAttribute("data-cognigy-copilot-yellow-svg-node");
      });
    }
    const chart = namingState.chartCache.get(String(currentFlowId));
    if (!chart || !chart.nodesById || chart.nodesById.size === 0) return;

    for (const node of chart.nodesById.values()) {
      const nodeId = String((node && (node._id || node.id)) || "");
      if (!nodeId) continue;
      const visible = getVisibleNodeElement(nodeId);
      if (!visible) continue;
      if (isYellowSvgShapeNodeType(node.type)) {
        visible.style.backgroundColor = "";
        visible.setAttribute("data-cognigy-copilot-yellow-svg-node", "1");
        applyYellowShapeNodeSvgFills(visible, false);
        resetChartNodeOuterChrome(nodeId, true);
        continue;
      }
      const background = getNodeCategoryBackgroundByType(node.type || "");
      if (!background) continue;
      visible.style.backgroundColor = background;
      visible.setAttribute("data-cognigy-copilot-node-category-bg", "1");
      resetChartNodeOuterChrome(nodeId, true);
    }
  }

  function applyCurrentFlowErrorHighlight(errors) {
    ensureCopilotChartNodeStylesInjected();
    const currentFlowId = getCurrentFlowIdFromLocation();
    if (!currentFlowId) return;
    for (const error of errors) {
      if (Number(error && error.severity) < 3) continue;
      if (String(error.flowId) !== String(currentFlowId)) continue;
      const visible = getVisibleNodeElement(error.nodeId);
      if (!visible) continue;
      visible.classList.remove("cognigy-copilot-node-dead-path");
      visible.classList.add("cognigy-copilot-node-error");
      resetChartNodeOuterChrome(error.nodeId, true);
    }
  }

  function getSeverityColor(severity) {
    const sev = Number(severity || 1);
    if (sev >= 3) return "#d52f2f";
    if (sev >= 2) return "#d4a017";
    return "#1f9b45";
  }

  function applyCurrentFlowDeadPathHighlight(deadPathNodeIds) {
    ensureCopilotChartNodeStylesInjected();
    const deadSet = toNodeIdSet(deadPathNodeIds);
    if (!deadSet.size) return;
    const currentFlowId = getCurrentFlowIdFromLocation();
    const chart = currentFlowId ? namingState.chartCache.get(String(currentFlowId)) : null;
    for (const nodeId of deadSet.values()) {
      const visible = getVisibleNodeElement(nodeId);
      if (!visible) continue;
      // Error highlight keeps higher severity and visual priority.
      if (visible.classList.contains("cognigy-copilot-node-error")) continue;
      const node = chart && chart.nodesById ? chart.nodesById.get(String(nodeId)) : null;
      const nodeType = node && node.type;
      if (isYellowSvgShapeNodeType(nodeType)) {
        visible.setAttribute("data-cognigy-copilot-yellow-shape-dead", "1");
        applyYellowShapeNodeSvgFills(visible, true);
      }
      visible.classList.add("cognigy-copilot-node-dead-path");
      resetChartNodeOuterChrome(nodeId, true);
    }
  }

  /**
   * Float badge on the top-left corner of the real content (outside the box, no layout impact).
   * Appended to the outer node wrapper with absolute coords + translate(-50%,-50%) so mini-node
   * label text is not shifted. If/Once/Switch: anchor to the inner SVG top-left.
   */
  function appendValidationBadgeToNodeFace(nodeId, badge) {
    const wrapper = getNodeWrapperElement(nodeId);
    const visible = getVisibleNodeElement(nodeId);
    if (!wrapper || !wrapper.isConnected || !visible || !visible.isConnected) return false;

    const flowId = getCurrentFlowIdFromLocation();
    const chart = flowId ? namingState.chartCache.get(String(flowId)) : null;
    const node = chart && chart.nodesById ? chart.nodesById.get(String(nodeId)) : null;
    const nodeType = node && node.type;

    const wrapStyle = window.getComputedStyle(wrapper);
    if (wrapStyle.position === "static") {
      wrapper.style.position = "relative";
    }

    const wr = wrapper.getBoundingClientRect();
    let anchor = visible.getBoundingClientRect();
    if (isYellowSvgShapeNodeType(nodeType)) {
      const svg = visible.querySelector("svg");
      if (svg && svg.isConnected) {
        anchor = svg.getBoundingClientRect();
      }
    }

    badge.style.right = "auto";
    badge.style.bottom = "auto";
    badge.style.top = Math.round(anchor.top - wr.top) + "px";
    badge.style.left = Math.round(anchor.left - wr.left) + "px";
    badge.style.zIndex = "0";
    badge.style.pointerEvents = "none";
    wrapper.appendChild(badge);
    return true;
  }

  function applyValidationFloatingBadges() {
    ensureCopilotChartNodeStylesInjected();
    const currentFlowId = getCurrentFlowIdFromLocation();
    if (!currentFlowId) return;
    const chart = getChartContentElement();
    if (!chart) return;

    const errorIds = new Set();
    const errors = getVisibleProjectMapIssuesForUi();
    for (const error of errors) {
      if (Number(error && error.severity) < 3) continue;
      if (String(error.flowId) !== String(currentFlowId)) continue;
      const id = String((error && error.nodeId) || "");
      if (id) errorIds.add(id);
    }

    const deadSet = toNodeIdSet(
      filterDeadPathNodeIdsByDismissals(namingState.validation.deadPathNodeIds || [], currentFlowId)
    );

    for (const nodeId of errorIds.values()) {
      const badge = document.createElement("div");
      badge.className = "cognigy-copilot-validation-badge cognigy-copilot-validation-badge--error";
      badge.setAttribute("data-cognigy-copilot-validation-badge", "error");
      badge.textContent = "\u203C\uFE0F";
      badge.title = "Validation error";
      appendValidationBadgeToNodeFace(nodeId, badge);
    }

    for (const nodeId of deadSet.values()) {
      if (errorIds.has(String(nodeId))) continue;
      const visible = getVisibleNodeElement(nodeId);
      if (!visible || visible.classList.contains("cognigy-copilot-node-error")) continue;
      const badge = document.createElement("div");
      badge.className = "cognigy-copilot-validation-badge cognigy-copilot-validation-badge--dead";
      badge.setAttribute("data-cognigy-copilot-validation-badge", "dead");
      badge.textContent = "\u{1FAA6}";
      badge.title = "Dead path";
      appendValidationBadgeToNodeFace(nodeId, badge);
    }
  }

  function getOrCreateChartOverlaySvg() {
    const ui = namingState.validation.ui;
    const chart = getChartContentElement();
    if (!chart) return null;
    const chartStyle = window.getComputedStyle(chart);
    if (chartStyle.position === "static") {
      chart.style.position = "relative";
    }
    let svg = ui.chartOverlay;
    if (!svg || !svg.isConnected) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("data-cognigy-copilot-overlay", "true");
      svg.style.position = "absolute";
      svg.style.left = "0";
      svg.style.top = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.pointerEvents = "none";
      svg.style.zIndex = "0";
      svg.style.overflow = "visible";
      if (chart.firstChild) chart.insertBefore(svg, chart.firstChild);
      else chart.appendChild(svg);
      ui.chartOverlay = svg;
    }
    const box = chart.getBoundingClientRect();
    svg.setAttribute(
      "viewBox",
      "0 0 " + Math.max(1, Math.round(box.width)) + " " + Math.max(1, Math.round(box.height))
    );
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    return svg;
  }

  function drawSameFlowEdges(edges) {
    const svg = getOrCreateChartOverlaySvg();
    const chart = getChartContentElement();
    if (!svg || !chart) return;
    const chartRect = chart.getBoundingClientRect();
    for (const edge of edges) {
      const s = getNodeAnchorRect(edge.sourceNodeId);
      const t = getNodeAnchorRect(edge.targetNodeId);
      if (!s || !t) continue;
      const sx = s.right - chartRect.left;
      const sy = s.top + s.height * 0.5 - chartRect.top;
      const tx = t.left - chartRect.left;
      const ty = t.top + t.height * 0.5 - chartRect.top;
      const dx = Math.max(30, Math.abs(tx - sx) * 0.35);
      const d =
        "M " +
        sx +
        " " +
        sy +
        " C " +
        (sx + dx) +
        " " +
        sy +
        ", " +
        (tx - dx) +
        " " +
        ty +
        ", " +
        tx +
        " " +
        ty;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(37, 99, 235, 0.32)");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
    }
  }

  function openIncomingSourcesPopover(anchorBadge, sources) {
    closeIncomingPopover();
    const ui = namingState.validation.ui;
    const rect = anchorBadge.getBoundingClientRect();
    const pop = document.createElement("div");
    pop.className = "cognigy-copilot-incoming-popover";
    pop.style.position = "fixed";
    pop.style.left = Math.max(12, rect.left - 320) + "px";
    pop.style.top = Math.max(12, rect.bottom + 8) + "px";
    pop.style.width = "320px";
    pop.style.maxHeight = "320px";
    pop.style.overflowY = "auto";
    pop.style.zIndex = "2147483647";
    pop.style.borderRadius = "12px";
    pop.style.background = "rgba(24, 24, 27, 0.96)";
    pop.style.border = "1px solid rgba(244, 244, 245, 0.15)";
    pop.style.boxShadow = "0 12px 36px rgba(0,0,0,0.38)";
    pop.style.backdropFilter = "blur(3px)";
    pop.style.padding = "8px";
    pop.style.color = "#f4f4f5";
    pop.style.fontSize = "12px";

    const title = document.createElement("div");
    title.textContent = "Incoming from outside (" + String(sources.length) + ")";
    title.style.padding = "6px 8px 8px 8px";
    title.style.fontWeight = "600";
    title.style.opacity = "0.95";
    pop.appendChild(title);

    const grouped = new Map();
    for (const src of sources) {
      const key = String(src.sourceFlowId || "") + ":" + String(src.sourceNodeId || "");
      if (!grouped.has(key)) grouped.set(key, { ...src, count: 0 });
      grouped.get(key).count += 1;
    }

    for (const item of grouped.values()) {
      const flow = namingState.flowsCache.byId.get(String(item.sourceFlowId || ""));
      const sourceFlowName = flow && flow.name ? String(flow.name) : String(item.sourceFlowId || "");
      const sourceLabel = String(item.sourceLabel || item.sourceNodeId || "source");
      const row = document.createElement("a");
      row.href = buildNodeLink(item.sourceFlowId, item.sourceNodeId);
      row.target = "_blank";
      row.rel = "noopener noreferrer";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.padding = "8px";
      row.style.borderRadius = "8px";
      row.style.textDecoration = "none";
      row.style.color = "rgba(244,244,245,0.94)";
      row.style.border = "1px solid rgba(244,244,245,0.08)";
      row.style.marginBottom = "6px";
      row.style.background = "rgba(63,63,70,0.25)";
      row.addEventListener("mouseenter", () => {
        row.style.background = "rgba(63,63,70,0.45)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "rgba(63,63,70,0.25)";
      });

      const icon = document.createElement("span");
      icon.textContent = "↗";
      icon.style.fontSize = "13px";
      icon.style.opacity = "0.95";

      const label = document.createElement("span");
      label.style.flex = "1";
      label.textContent =
        sourceFlowName + " - " + sourceLabel + (item.count > 1 ? " x" + String(item.count) : "");

      row.appendChild(icon);
      row.appendChild(label);
      pop.appendChild(row);
    }

    document.documentElement.appendChild(pop);
    ui.incomingPopover = pop;
    ui.incomingOutsideHandler = function (event) {
      const raw = event.target;
      if (!raw) return;
      if (pop.contains(raw)) return;
      /* Chart refresh recreates .cognigy-copilot-incoming-badge nodes; stale anchorBadge
         would falsely treat clicks on the new badge as "outside" and close (or block opens). */
      const el = raw.nodeType === Node.TEXT_NODE ? raw.parentElement : raw;
      if (el && typeof el.closest === "function" && el.closest(".cognigy-copilot-incoming-badge")) return;
      closeIncomingPopover();
    };
    document.addEventListener("mousedown", ui.incomingOutsideHandler, true);
  }

  function renderIncomingExternalBadges(incomingExternalTargets) {
    const currentFlowId = getCurrentFlowIdFromLocation();
    if (!currentFlowId) return;
    for (const targetNodeId of Object.keys(incomingExternalTargets || {})) {
      const wrapper = getNodeWrapperElement(targetNodeId);
      const visible = getVisibleNodeElement(targetNodeId);
      if (!wrapper || !visible) continue;
      const sources = incomingExternalTargets[targetNodeId] || [];
      if (!sources.length) continue;

      const badge = document.createElement("div");
      badge.className = "cognigy-copilot-incoming-badge";
      badge.textContent = "↗ " + String(sources.length > 99 ? "99+" : sources.length);
      badge.style.position = "absolute";
      badge.style.padding = "2px 7px";
      badge.style.borderRadius = "999px";
      badge.style.background = "rgba(24, 24, 27, 0.86)";
      badge.style.color = "rgba(244, 244, 245, 0.96)";
      badge.style.fontSize = "10px";
      badge.style.fontWeight = "600";
      badge.style.border = "1px solid rgba(244, 244, 245, 0.18)";
      badge.style.letterSpacing = "0.01em";
      badge.style.pointerEvents = "auto";
      badge.style.cursor = "pointer";
      badge.style.backdropFilter = "blur(2px)";
      badge.style.zIndex = "100";
      badge.title = "Show external sources";

      const wrapperStyle = window.getComputedStyle(wrapper);
      if (wrapperStyle.position === "static") {
        wrapper.style.position = "relative";
      }
      const visibleOffsetTop = visible.offsetTop || 0;
      const visibleOffsetLeft = visible.offsetLeft || 0;
      badge.style.top = Math.max(2, visibleOffsetTop + 6) + "px";
      // Place badge left outside visible node, near the little incoming triangle.
      badge.style.left = Math.min(visibleOffsetLeft - 40, -8) + "px";
      badge.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openIncomingSourcesPopover(badge, sources);
      });
      wrapper.appendChild(badge);
    }
  }

  function queueChartVisualRefresh() {
    const ui = namingState.validation.ui;
    if (ui.repaintQueued) return;
    ui.repaintQueued = true;
    requestAnimationFrame(function () {
      ui.repaintQueued = false;
      // Always clear stale markers first; otherwise old red highlights can remain
      // when validation result transitions to "no visuals".
      clearValidationNodeVisuals();
      applyCurrentFlowNodeCategoryBackgrounds();
      const hasVisuals =
        (Array.isArray(namingState.validation.sameFlowEdges) &&
          namingState.validation.sameFlowEdges.length > 0) ||
        (namingState.validation.incomingExternalTargets &&
          Object.keys(namingState.validation.incomingExternalTargets).length > 0) ||
        (Array.isArray(namingState.validation.errors) && namingState.validation.errors.length > 0) ||
        (Array.isArray(namingState.validation.deadPathNodeIds) &&
          namingState.validation.deadPathNodeIds.length > 0);
      if (!hasVisuals) return;
      renderChartValidationVisuals();
    });
  }

  /**
   * Chart MutationObserver sees every Cognigy class/style/transform change (hover, focus, clicks).
   * Running a full validation repaint immediately can clear/repaint the node subtree between
   * mousedown and click and swallow the app's click handler. Debounce so the click gesture finishes first.
   */
  function scheduleChartVisualRefreshFromDomMutation() {
    const ui = namingState.validation.ui;
    if (ui.chartMutationRefreshTimer) {
      clearTimeout(ui.chartMutationRefreshTimer);
    }
    ui.chartMutationRefreshTimer = setTimeout(function () {
      ui.chartMutationRefreshTimer = null;
      queueChartVisualRefresh();
    }, 160);
  }

  function bindChartVisualSyncIfNeeded() {
    const ui = namingState.validation.ui;
    if (ui.visualsBound) return;
    const chart = getChartContentElement();
    if (!chart) return;
    ui.visualsBound = true;
    bindCommentHoverIfNeeded();

    ui.wheelHandler = function () {
      queueChartVisualRefresh();
    };
    ui.resizeHandler = function () {
      queueChartVisualRefresh();
    };
    ui.keydownHandler = function (event) {
      const key = String((event && event.key) || "");
      if (key === "+" || key === "-" || key === "0") {
        queueChartVisualRefresh();
      }
    };

    chart.addEventListener("wheel", ui.wheelHandler, { passive: true });
    window.addEventListener("resize", ui.resizeHandler, { passive: true });
    window.addEventListener("keydown", ui.keydownHandler, true);

    ui.chartMutationObserver = new MutationObserver(function () {
      scheduleChartVisualRefreshFromDomMutation();
    });
    ui.chartMutationObserver.observe(chart, {
      attributes: true,
      attributeFilter: ["style", "class", "transform"],
      subtree: true,
    });
  }

  const FAB_DOCK_STORAGE_KEY = "cognigyCopilotFabDockLeftPx";
  const FAB_DOCK_ORIGINAL_LEFT_KEY = "cognigyCopilotFabDockOriginalLeftPx";
  const FAB_DOCK_MARGIN = 8;
  /** Extra gap between the FAB dock's right edge and obstructing right-side UI. */
  const FAB_DOCK_RIGHT_UI_MARGIN = 28;
  const INTERACTION_PANEL_SELECTOR = "#interactionPanel";
  const EDIT_SIDEBAR_WRAPPER_SELECTOR = "#editSidebarWrapper";

  function getInteractionPanelElement() {
    return document.querySelector(INTERACTION_PANEL_SELECTOR);
  }

  function getEditSidebarWrapperElement() {
    return document.querySelector(EDIT_SIDEBAR_WRAPPER_SELECTOR);
  }

  function isFabDockAvoidanceTargetVisible(el) {
    if (!el || !el.isConnected) return false;
    let st = null;
    try {
      st = window.getComputedStyle(el);
    } catch (_) {
      return false;
    }
    if (!st || st.display === "none" || st.visibility === "hidden") return false;
    if (Number(st.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  }

  function getVisibleRightSidePanelWidth(el) {
    if (!isFabDockAvoidanceTargetVisible(el)) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0.5) return rect.width;
    let parsed = NaN;
    try {
      parsed = parseFloat(window.getComputedStyle(el).width);
    } catch (_) {}
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function getInteractionPanelWidth() {
    return getVisibleRightSidePanelWidth(getInteractionPanelElement());
  }

  function getEditSidebarWrapperWidth() {
    return getVisibleRightSidePanelWidth(getEditSidebarWrapperElement());
  }

  /**
   * Total horizontal space reserved on the right by Cognigy side panels.
   * `#interactionPanel` may animate its width; `#editSidebarWrapper` is
   * either fully visible (fixed width) or absent/hidden. When both are
   * visible we measure the combined obstruction via the leftmost panel
   * edge so adjacent sidebars stack correctly.
   */
  function getFabDockRightReservedWidth() {
    const rects = [];
    const interactionEl = getInteractionPanelElement();
    const editSidebarEl = getEditSidebarWrapperElement();
    if (interactionEl && isFabDockAvoidanceTargetVisible(interactionEl)) {
      const rect = interactionEl.getBoundingClientRect();
      if (rect.width > 0.5) rects.push(rect);
    }
    if (editSidebarEl && isFabDockAvoidanceTargetVisible(editSidebarEl)) {
      const rect = editSidebarEl.getBoundingClientRect();
      if (rect.width > 0.5) rects.push(rect);
    }
    if (!rects.length) return 0;

    let minLeft = window.innerWidth;
    for (let i = 0; i < rects.length; i++) {
      if (rects[i].left < minLeft) minLeft = rects[i].left;
    }
    const reserved = window.innerWidth - minLeft + FAB_DOCK_RIGHT_UI_MARGIN;
    return reserved > 0.5 ? reserved : 0;
  }

  function getFabDockWidth(dock) {
    const rect = dock.getBoundingClientRect();
    return rect.width > 0 ? rect.width : dock.offsetWidth || 120;
  }

  function getDefaultFabDockLeftPx(dock) {
    const w = getFabDockWidth(dock);
    return window.innerWidth - w - 20;
  }

  /**
   * The user's "home" dock position — restored once obstructing right-side
   * panels close. While avoidance is active the original is pinned in
   * `FAB_DOCK_ORIGINAL_LEFT_KEY`; otherwise we read the normal drag key.
   */
  function getFabDockHomeLeftPx(dock) {
    let raw = null;
    try {
      raw = localStorage.getItem(FAB_DOCK_ORIGINAL_LEFT_KEY) || localStorage.getItem(FAB_DOCK_STORAGE_KEY);
    } catch (_) {}
    let left = raw != null ? parseFloat(raw) : NaN;
    if (!Number.isFinite(left)) {
      left = getDefaultFabDockLeftPx(dock);
    }
    return left;
  }

  function clampFabDockLeft(dock, leftPx, reservedWidthPx) {
    const w = getFabDockWidth(dock);
    const reservedW =
      reservedWidthPx != null && Number.isFinite(Number(reservedWidthPx))
        ? Number(reservedWidthPx)
        : getFabDockRightReservedWidth();
    const panelReserve = reservedW > 0.5 ? reservedW : 0;
    const maxL = window.innerWidth - w - FAB_DOCK_MARGIN - panelReserve;
    const minL = FAB_DOCK_MARGIN;
    return Math.min(maxL, Math.max(minL, leftPx));
  }

  function computeFabDockLeftWithAvoidance(dock, homeLeftPx, reservedWidthPx) {
    const reservedW = Number(reservedWidthPx || 0);
    let left = Number(homeLeftPx);
    if (!Number.isFinite(left)) {
      left = getDefaultFabDockLeftPx(dock);
    }
    if (reservedW > 0.5) {
      const w = getFabDockWidth(dock);
      const obstructionLeftEdge = window.innerWidth - reservedW;
      const fabRight = left + w;
      if (fabRight > obstructionLeftEdge) {
        left = obstructionLeftEdge - w;
      }
    }
    return clampFabDockLeft(dock, left, reservedW);
  }

  function scheduleFabDockAvoidanceAnimationFrames(dock, durationMs) {
    if (!dock) return;
    const ms = typeof durationMs === "number" ? durationMs : 900;
    const until = Date.now() + ms;
    namingState.fabDockAvoidanceAnimateUntil = Math.max(namingState.fabDockAvoidanceAnimateUntil || 0, until);
    if (namingState.fabDockAvoidanceRafActive) return;
    namingState.fabDockAvoidanceRafActive = true;
    function tick() {
      syncFabDockInteractionPanelAvoidance(dock);
      if (Date.now() < (namingState.fabDockAvoidanceAnimateUntil || 0)) {
        namingState.fabDockAvoidanceRaf = requestAnimationFrame(tick);
      } else {
        namingState.fabDockAvoidanceRafActive = false;
        namingState.fabDockAvoidanceRaf = null;
      }
    }
    namingState.fabDockAvoidanceRaf = requestAnimationFrame(tick);
  }

  function syncFabDockInteractionPanelAvoidance(dock) {
    if (!dock || !dock.isConnected) return;
    // Never fight the user while they are dragging the dock horizontally.
    if (namingState.fabDockDragActive) return;

    const reservedW = getFabDockRightReservedWidth();
    const homeLeft = getFabDockHomeLeftPx(dock);
    const w = getFabDockWidth(dock);
    const obstructionLeftEdge = reservedW > 0.5 ? window.innerWidth - reservedW : window.innerWidth;
    const overlapsPanel = reservedW > 0.5 && homeLeft + w > obstructionLeftEdge + 0.5;

    if (overlapsPanel) {
      if (!namingState.fabDockAvoidanceSession) {
        namingState.fabDockAvoidanceSession = true;
        try {
          const storedHome = localStorage.getItem(FAB_DOCK_STORAGE_KEY);
          const homeToPin =
            storedHome != null && Number.isFinite(parseFloat(storedHome))
              ? String(parseFloat(storedHome))
              : String(homeLeft);
          localStorage.setItem(FAB_DOCK_ORIGINAL_LEFT_KEY, homeToPin);
        } catch (_) {}
      }
    } else if (reservedW <= 0.5 && namingState.fabDockAvoidanceSession) {
      namingState.fabDockAvoidanceSession = false;
      try {
        localStorage.removeItem(FAB_DOCK_ORIGINAL_LEFT_KEY);
      } catch (_) {}
    }

    const baseLeft = getFabDockHomeLeftPx(dock);
    const targetLeft = computeFabDockLeftWithAvoidance(dock, baseLeft, reservedW);
    dock.style.left = targetLeft + "px";
    updateFabDockAlignment(dock);
  }

  function bindInteractionPanelFabAvoidance(dock) {
    if (namingState.fabDockAvoidanceBound) {
      syncFabDockInteractionPanelAvoidance(dock);
      return;
    }
    namingState.fabDockAvoidanceBound = true;

    function onPanelChange() {
      syncFabDockInteractionPanelAvoidance(dock);
      scheduleFabDockAvoidanceAnimationFrames(dock, 900);
    }

    function attachToRightSidePanel(el) {
      if (!el || el.__ccpFabAvoidanceBound) return;
      el.__ccpFabAvoidanceBound = true;
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(onPanelChange);
        ro.observe(el);
        if (!namingState.fabDockRightPanelRos) namingState.fabDockRightPanelRos = [];
        namingState.fabDockRightPanelRos.push(ro);
      }
      const mo = new MutationObserver(onPanelChange);
      mo.observe(el, {
        attributes: true,
        attributeFilter: ["style", "class", "width", "hidden", "aria-hidden"],
      });
      if (!namingState.fabDockRightPanelMos) namingState.fabDockRightPanelMos = [];
      namingState.fabDockRightPanelMos.push(mo);
      onPanelChange();
    }

    function tryAttachRightSidePanels() {
      attachToRightSidePanel(getInteractionPanelElement());
      attachToRightSidePanel(getEditSidebarWrapperElement());
      syncFabDockInteractionPanelAvoidance(dock);
    }

    window.addEventListener("resize", onPanelChange, { passive: true });

    if (typeof MutationObserver !== "undefined") {
      const docMo = new MutationObserver(tryAttachRightSidePanels);
      docMo.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "aria-hidden"],
      });
      namingState.fabDockInteractionPanelDocMo = docMo;
    }

    tryAttachRightSidePanels();
  }

  function ensureFabDockStyleSheet() {
    if (document.getElementById("cognigy-copilot-fab-styles")) return;
    const st = document.createElement("style");
    st.id = "cognigy-copilot-fab-styles";
    st.textContent =
      "@keyframes ccpFabReloadSpin { to { transform: rotate(360deg); } } " +
      "#cognigy-copilot-fab-dock .ccp-reload-spinning { animation: ccpFabReloadSpin 0.85s linear infinite; transform-origin: 50% 50%; } " +
      "@keyframes ccpFabAnalysisSpin { to { transform: rotate(360deg); } } " +
      "#cognigy-copilot-fab-dock .ccp-fab-analysis-spinner-svg { " +
      "animation: ccpFabAnalysisSpin 0.9s linear infinite; transform-origin: 50% 50%; }";
    document.head.appendChild(st);
  }

  function ensurePendingChartGetResolversMap() {
    if (!namingState._pendingChartGetResolvers) {
      namingState._pendingChartGetResolvers = new Map();
    }
    return namingState._pendingChartGetResolvers;
  }

  function notifyInterceptedChartGetCompleted(flowId) {
    const fid = String(flowId || "");
    const map = namingState._pendingChartGetResolvers;
    if (!map) return;
    const set = map.get(fid);
    if (!set || !set.size) return;
    const copy = Array.from(set);
    set.clear();
    copy.forEach(function (fn) {
      try {
        fn();
      } catch (_) {}
    });
  }

  function waitForNextInterceptedChartGet(flowId, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const fid = String(flowId || "");
      const map = ensurePendingChartGetResolversMap();
      let set = map.get(fid);
      if (!set) {
        map.set(fid, (set = new Set()));
      }
      let settled = false;
      const timer = setTimeout(
        function () {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("timeout waiting for intercepted chart GET"));
        },
        typeof timeoutMs === "number" ? timeoutMs : 60000
      );

      function cleanup() {
        clearTimeout(timer);
        set.delete(onDone);
        if (set.size === 0) map.delete(fid);
      }

      function onDone() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ ok: true });
      }
      set.add(onDone);
    });
  }

  function flowRefreshButtonDomAndVisible() {
    const el = document.querySelector('button[data-test="FlowRefreshButton"]');
    if (!el) return null;
    const st = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const visible =
      st.display !== "none" &&
      st.visibility !== "hidden" &&
      Number(st.opacity) !== 0 &&
      rect.width > 1 &&
      rect.height > 1;
    return visible ? el : null;
  }

  function waitForFlowRefreshButtonThenClick(timeoutMs) {
    const deadline = Date.now() + (typeof timeoutMs === "number" ? timeoutMs : 15000);
    return new Promise(function (resolve, reject) {
      function tick() {
        const el = flowRefreshButtonDomAndVisible();
        if (el) {
          try {
            el.click();
          } catch (e) {
            reject(e);
            return;
          }
          resolve({ clicked: true });
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error('timeout waiting for button[data-test="FlowRefreshButton"]'));
          return;
        }
        window.requestAnimationFrame(tick);
      }
      tick();
    });
  }

  function resolveNodeIdForCollaboration(flowIdOpt, nodeIdOpt) {
    let nodeId = nodeIdOpt != null && String(nodeIdOpt) !== "" ? String(nodeIdOpt) : "";
    if (!nodeId) {
      const ch = getChartContentElement();
      if (ch) {
        const idNodes = ch.querySelectorAll("[id]");
        for (let i = 0; i < idNodes.length; i++) {
          const id = idNodes[i].id;
          if (id && /^[a-f0-9]{24}$/i.test(id)) {
            nodeId = id;
            break;
          }
        }
      }
    }
    return nodeId || "";
  }

  /**
   * Notify Cognigy's open flow editor that a single node changed (collaboration ping).
   */
  function notifyCognigyFlowNodeUpdated(options) {
    options = options || {};
    const fid = String(
      options.flowId != null && String(options.flowId) !== ""
        ? options.flowId
        : getCurrentFlowIdFromLocation() || ""
    );
    if (!fid) {
      return { ok: false, reason: "no-flowId" };
    }

    const CCPG = window.__CCP__ || {};
    if (
      typeof CCPG.buildEngineIoSocketIoEventPacket !== "function" ||
      typeof CCPG.dispatchCollaborationSocketIoMessage !== "function"
    ) {
      return { ok: false, reason: "no-ws-helpers", flowId: fid };
    }

    const nodeId = resolveNodeIdForCollaboration(fid, options.nodeId);
    if (!nodeId) {
      return { ok: false, reason: "no-nodeId", flowId: fid };
    }

    const peerUid =
      typeof CCPG.pickSyntheticPeerUserIdForCollab === "function"
        ? CCPG.pickSyntheticPeerUserIdForCollab()
        : "ffffffffffffffffffffffff";
    const frame = CCPG.buildEngineIoSocketIoEventPacket("flowChart:update", {
      userId: peerUid,
      flowId: fid,
      nodeId: nodeId,
      metadata: { action: "node_update" },
    });
    const r = CCPG.dispatchCollaborationSocketIoMessage(frame);
    queueChartVisualRefresh();
    return {
      ok: true,
      flowId: fid,
      nodeId: nodeId,
      peerSimUserId: peerUid,
      collabDispatched: !!(r && r.dispatched),
    };
  }

  /**
   * Lightweight canvas refresh after a single-node change: collaboration ping →
   * auto-click FlowRefreshButton. Does not wait for /chart GET or map.reloadFlow().
   */
  async function runCognigyFlowNodeVisualRefresh(options) {
    options = options || {};
    const waitBtnMs = typeof options.waitButtonMs === "number" ? options.waitButtonMs : 15000;
    const collabResult = notifyCognigyFlowNodeUpdated(options);
    if (!collabResult.ok) {
      return collabResult;
    }
    try {
      await waitForFlowRefreshButtonThenClick(waitBtnMs);
      queueChartVisualRefresh();
      return Object.assign({ ok: true, refreshClicked: true }, collabResult);
    } catch (e) {
      namingLogDebug("runCognigyFlowNodeVisualRefresh refresh button click failed", {
        flowId: collabResult.flowId,
        nodeId: collabResult.nodeId,
        error: String(e && e.message ? e.message : e),
      });
      return Object.assign(
        {
          ok: false,
          reason: "refresh-button-timeout",
          error: e && e.message ? String(e.message) : String(e),
        },
        collabResult
      );
    }
  }

  /**
   * Hard refresh: re-fetch flow list from API, then reload all flow nodes from API.
   * Options: onBusyChange(true|false), onProgress({ detail: { stage, done, total, flows? } }).
   */
  async function runHardProjectMapRefresh(options) {
    options = options || {};
    const onBusyChange =
      typeof options.onBusyChange === "function"
        ? options.onBusyChange
        : typeof options.onLoadingChange === "function"
          ? options.onLoadingChange
          : null;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

    const map = ensureProjectMap();
    if (!map) {
      return { ok: false, reason: "no-map" };
    }

    if (onBusyChange) {
      try {
        onBusyChange(true);
      } catch (_) {}
    }

    function handleProgress(ev) {
      if (!onProgress) return;
      try {
        onProgress(ev);
      } catch (_) {}
    }

    map.addEventListener("load-progress", handleProgress);
    try {
      if (map._initPromise && !map._initialized) {
        try {
          await map._initPromise;
        } catch (e) {
          namingLogDebug("runHardProjectMapRefresh init wait failed", { error: String(e) });
        }
      }
      if (namingState.bearerToken && namingState.baseUrl) {
        map.setApiContext({
          bearerToken: namingState.bearerToken,
          baseUrl: namingState.baseUrl,
        });
      }
      await map.reload({ force: true });
      try {
        await runNamingConventionScan("hard-refresh");
      } catch (e) {
        namingLogDebug("runHardProjectMapRefresh naming scan failed", { error: String(e) });
      }
      try {
        renderValidationWidget();
        renderChartValidationVisuals();
      } catch (_) {}
      return { ok: true, map: map };
    } catch (e) {
      return {
        ok: false,
        reason: "reload-failed",
        error: e && e.message ? String(e.message) : String(e),
      };
    } finally {
      map.removeEventListener("load-progress", handleProgress);
      if (onBusyChange) {
        try {
          onBusyChange(false);
        } catch (_) {}
      }
    }
  }

  /**
   * Full Cognigy canvas reload pipeline: synthetic collaboration message → FlowRefreshButton → wait for chart GET.
   * Options: flowId, nodeId, waitButtonMs, waitChartMs, onBusyChange(true|false).
   */
  async function runCognigyFlowChartReload(options) {
    options = options || {};
    const waitBtnMs = typeof options.waitButtonMs === "number" ? options.waitButtonMs : 15000;
    const waitChartMs = typeof options.waitChartMs === "number" ? options.waitChartMs : 60000;
    const flowIdOpt = options.flowId;
    const nodeIdOpt = options.nodeId;
    const onBusyChange =
      typeof options.onBusyChange === "function"
        ? options.onBusyChange
        : typeof options.onLoadingChange === "function"
          ? options.onLoadingChange
          : null;

    const fid = String(
      flowIdOpt != null && String(flowIdOpt) !== "" ? flowIdOpt : getCurrentFlowIdFromLocation() || ""
    );
    if (!fid) {
      return { ok: false, reason: "no-flowId" };
    }

    const CCPG = window.__CCP__ || {};
    if (
      typeof CCPG.buildEngineIoSocketIoEventPacket !== "function" ||
      typeof CCPG.dispatchCollaborationSocketIoMessage !== "function"
    ) {
      return { ok: false, reason: "no-ws-helpers", flowId: fid };
    }

    const nodeId = resolveNodeIdForCollaboration(fid, nodeIdOpt);
    if (!nodeId) {
      return { ok: false, reason: "no-nodeId", flowId: fid };
    }

    if (onBusyChange) {
      try {
        onBusyChange(true);
      } catch (_) {}
    }

    try {
      const collabResult = notifyCognigyFlowNodeUpdated({ flowId: fid, nodeId: nodeId });

      const chartPromise = waitForNextInterceptedChartGet(fid, waitChartMs);

      try {
        await waitForFlowRefreshButtonThenClick(waitBtnMs);
      } catch (btnErr) {
        namingLogDebug("runCognigyFlowChartReload refresh button click failed", {
          flowId: fid,
          error: String(btnErr && btnErr.message ? btnErr.message : btnErr),
        });
        throw btnErr;
      }
      await chartPromise;
      queueChartVisualRefresh();
      // After Cognigy's own chart reload finished, also force the
      // project-map to re-pull this flow (per-node detail GETs +
      // last_changed refresh) so the issue list is current.
      try {
        const map = ensureProjectMap();
        if (map) {
          map.reloadFlow(fid, { force: true }).catch(function () {});
        }
      } catch (_) {}
      return Object.assign({ ok: true }, collabResult || {}, { flowId: fid, nodeId: nodeId });
    } catch (e) {
      return {
        ok: false,
        reason: "reload-sequence-failed",
        error: e && e.message ? String(e.message) : String(e),
        flowId: fid,
      };
    } finally {
      if (onBusyChange) {
        try {
          onBusyChange(false);
        } catch (_) {}
      }
    }
  }

  /**
   * When the dock's horizontal center moves past the viewport midpoint (into the left half),
   * align the flyout panel to the dock's left edge (instead of right-aligned with the FAB)
   * and mirror the reload icon horizontally (arrow sense left→right).
   */
  function updateFabDockAlignment(dock) {
    const panel = dock.querySelector("[data-copilot-fab-panel]");
    const flipWrap = dock.querySelector(".ccp-fab-reload-flip-wrap");
    if (!panel) return;
    const rect = dock.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const alignLeft = centerX < window.innerWidth / 2;
    if (alignLeft) {
      panel.style.left = "0";
      panel.style.right = "auto";
    } else {
      panel.style.right = "0";
      panel.style.left = "auto";
    }
    if (flipWrap) {
      flipWrap.style.transform = alignLeft ? "scaleX(-1)" : "";
    }
  }

  function applyFabDockPositionFromStorage(dock) {
    syncFabDockInteractionPanelAvoidance(dock);
  }

  /** Horizontal drag for the whole dock (including both FAB buttons). Uses a move threshold so button clicks still work. */
  function bindFabDockHorizontalDrag(dock, panel) {
    const DRAG_THRESHOLD_PX = 6;
    let tracking = false;
    let dragging = false;
    let startClientX = 0;
    let startClientY = 0;
    let startLeftPx = 0;
    let suppressClicksUntil = 0;

    function onMove(e) {
      if (!tracking) return;
      const dx = e.clientX - startClientX;
      const dy = e.clientY - startClientY;
      if (!dragging) {
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        dragging = true;
        namingState.fabDockDragActive = true;
        dock.style.cursor = "grabbing";
        try {
          dock.setPointerCapture(e.pointerId);
        } catch (_) {}
        document.body.style.userSelect = "none";
      }
      let next = startLeftPx + dx;
      next = clampFabDockLeft(dock, next);
      dock.style.left = next + "px";
      updateFabDockAlignment(dock);
    }

    function onEnd(e) {
      if (!tracking) return;
      tracking = false;
      const wasDrag = dragging;
      dragging = false;
      namingState.fabDockDragActive = false;
      dock.style.cursor = "grab";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      try {
        if (e && e.pointerId != null) {
          dock.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      if (wasDrag) {
        const rect = dock.getBoundingClientRect();
        const left = String(rect.left);
        try {
          localStorage.setItem(FAB_DOCK_STORAGE_KEY, left);
          if (namingState.fabDockAvoidanceSession) {
            localStorage.setItem(FAB_DOCK_ORIGINAL_LEFT_KEY, left);
          }
        } catch (_) {}
        suppressClicksUntil =
          (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) + 400;
        syncFabDockInteractionPanelAvoidance(dock);
      }
    }

    dock.addEventListener(
      "pointerdown",
      function (e) {
        if (e.button !== 0) return;
        const p = panel;
        if (p && p.style.display !== "none" && p.contains(e.target)) return;
        tracking = true;
        dragging = false;
        namingState.fabDockDragActive = false;
        startClientX = e.clientX;
        startClientY = e.clientY;
        startLeftPx = dock.getBoundingClientRect().left;
        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onEnd, true);
        window.addEventListener("pointercancel", onEnd, true);
      },
      true
    );

    function suppressIfJustDragged(ev) {
      const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      if (now < suppressClicksUntil) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    }
    dock.addEventListener("click", suppressIfJustDragged, true);
  }

  function renderChartValidationVisuals() {
    bindChartVisualSyncIfNeeded();
    clearValidationNodeVisuals();
    applyCurrentFlowNodeCategoryBackgrounds();
    const edges = Array.isArray(namingState.validation.sameFlowEdges)
      ? namingState.validation.sameFlowEdges
      : [];
    drawSameFlowEdges(edges);
    applyCurrentFlowErrorHighlight(getVisibleProjectMapIssuesForUi());
    const currentFlowId = getCurrentFlowIdFromLocation();
    const deadPathIds = filterDeadPathNodeIdsByDismissals(
      namingState.validation.deadPathNodeIds || [],
      currentFlowId
    );
    applyCurrentFlowDeadPathHighlight(deadPathIds);
    applyValidationFloatingBadges();
    renderIncomingExternalBadges(namingState.validation.incomingExternalTargets || {});
  }

  function mountValidationWidgetIfNeeded() {
    const ui = namingState.validation.ui;
    if (ui.mounted) return;
    ensureFabDockStyleSheet();

    const dock = document.createElement("div");
    dock.id = "cognigy-copilot-fab-dock";
    dock.style.position = "fixed";
    dock.style.bottom = "20px";
    dock.style.left = "0";
    dock.style.right = "auto";
    dock.style.top = "auto";
    dock.style.zIndex = "2147483647";
    dock.style.display = "flex";
    dock.style.flexDirection = "row";
    dock.style.alignItems = "center";
    dock.style.gap = "10px";
    dock.style.fontFamily = "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    dock.style.boxSizing = "border-box";
    dock.style.touchAction = "none";
    dock.style.cursor = "grab";

    const reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.title = "Hard Refresh — alle Flows und Nodes neu laden";
    reloadBtn.setAttribute("aria-label", "Hard Refresh — alle Flows und Nodes neu laden");
    reloadBtn.style.width = "32px";
    reloadBtn.style.height = "32px";
    reloadBtn.style.padding = "0";
    reloadBtn.style.margin = "0";
    reloadBtn.style.border = "none";
    reloadBtn.style.background = "transparent";
    reloadBtn.style.boxShadow = "none";
    reloadBtn.style.cursor = "pointer";
    reloadBtn.style.position = "relative";
    reloadBtn.style.display = "flex";
    reloadBtn.style.alignItems = "center";
    reloadBtn.style.justifyContent = "center";
    reloadBtn.style.flexShrink = "0";
    reloadBtn.style.webkitTapHighlightColor = "transparent";

    const reloadSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    reloadSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    reloadSvg.setAttribute("viewBox", "0 0 24 24");
    reloadSvg.setAttribute("width", "24");
    reloadSvg.setAttribute("height", "24");
    reloadSvg.style.pointerEvents = "none";
    reloadSvg.style.display = "block";
    reloadSvg.style.overflow = "visible";
    reloadSvg.style.color = "rgba(0,0,0,0.8)";
    reloadSvg.innerHTML =
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 3v5h5"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M16 16h5v5"/>';
    const reloadFlipWrap = document.createElement("span");
    reloadFlipWrap.className = "ccp-fab-reload-flip-wrap";
    reloadFlipWrap.style.display = "flex";
    reloadFlipWrap.style.alignItems = "center";
    reloadFlipWrap.style.justifyContent = "center";
    reloadFlipWrap.style.width = "100%";
    reloadFlipWrap.style.height = "100%";
    reloadFlipWrap.appendChild(reloadSvg);
    reloadBtn.appendChild(reloadFlipWrap);

    reloadBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      void runHardProjectMapRefresh({
        onBusyChange: function (busy) {
          reloadBtn.disabled = !!busy;
          if (busy) {
            reloadSvg.classList.add("ccp-reload-spinning");
          } else {
            reloadSvg.classList.remove("ccp-reload-spinning");
          }
        },
      });
    });

    const button = document.createElement("button");
    button.type = "button";
    button.style.width = "56px";
    button.style.height = "56px";
    button.style.borderRadius = "999px";
    button.style.border = "2px solid rgba(255,255,255,0.8)";
    button.style.boxShadow = "0 8px 28px rgba(0,0,0,0.35)";
    button.style.cursor = "pointer";
    button.style.position = "relative";
    button.style.overflow = "visible";
    button.style.color = "#fff";
    button.style.fontSize = "13px";
    button.style.fontWeight = "700";
    button.title = "Copilot flow validation";

    const logo = document.createElement("img");
    logo.src = resolveAssetUrl("icon-128-bg-transparent.png");
    logo.alt = "Henley";
    logo.draggable = false;
    logo.style.position = "absolute";
    logo.style.left = "50%";
    logo.style.top = "50%";
    logo.style.width = "25px";
    logo.style.height = "25px";
    logo.style.transform = "translate(-50%, -50%)";
    logo.style.objectFit = "contain";
    logo.style.pointerEvents = "none";
    logo.style.userSelect = "none";
    button.appendChild(logo);

    const analysisSpinnerWrap = document.createElement("div");
    analysisSpinnerWrap.className = "ccp-fab-analysis-spinner-wrap";
    analysisSpinnerWrap.setAttribute("aria-hidden", "true");
    analysisSpinnerWrap.style.position = "absolute";
    analysisSpinnerWrap.style.left = "0";
    analysisSpinnerWrap.style.top = "0";
    analysisSpinnerWrap.style.right = "0";
    analysisSpinnerWrap.style.bottom = "0";
    analysisSpinnerWrap.style.display = "none";
    analysisSpinnerWrap.style.alignItems = "center";
    analysisSpinnerWrap.style.justifyContent = "center";
    analysisSpinnerWrap.style.pointerEvents = "none";
    const analysisSpinnerSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    analysisSpinnerSvg.setAttribute("class", "ccp-fab-analysis-spinner-svg");
    analysisSpinnerSvg.setAttribute("viewBox", "0 0 24 24");
    analysisSpinnerSvg.setAttribute("width", "28");
    analysisSpinnerSvg.setAttribute("height", "28");
    analysisSpinnerSvg.style.overflow = "visible";
    analysisSpinnerSvg.style.display = "block";
    const spinArc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    spinArc.setAttribute("cx", "12");
    spinArc.setAttribute("cy", "12");
    spinArc.setAttribute("r", "9");
    spinArc.setAttribute("fill", "none");
    spinArc.setAttribute("stroke", "rgba(55,55,55,0.55)");
    spinArc.setAttribute("stroke-width", "2.25");
    spinArc.setAttribute("stroke-linecap", "round");
    spinArc.setAttribute("stroke-dasharray", "14 40");
    analysisSpinnerSvg.appendChild(spinArc);
    analysisSpinnerWrap.appendChild(analysisSpinnerSvg);
    button.appendChild(analysisSpinnerWrap);

    // Severity-2 badge (warnings, yellow) sits in the top-right corner.
    //
    // Anchored by `left: calc(100% - 14px)` so the badge's LEFT edge sits
    // 14px inside the button's right edge and grows OUTWARD as the
    // content widens. Combined with the mirrored severity-3 badge below
    // this keeps the two badges from overlapping each other regardless
    // of how many digits the "x/y" labels need.
    const severityBadgeWarning = document.createElement("span");
    severityBadgeWarning.style.position = "absolute";
    severityBadgeWarning.style.top = "-9px";
    severityBadgeWarning.style.left = "calc(100% - 14px)";
    severityBadgeWarning.style.right = "auto";
    severityBadgeWarning.style.height = "20px";
    severityBadgeWarning.style.padding = "0 7px";
    severityBadgeWarning.style.borderRadius = "999px";
    severityBadgeWarning.style.display = "flex";
    severityBadgeWarning.style.alignItems = "center";
    severityBadgeWarning.style.justifyContent = "center";
    severityBadgeWarning.style.fontSize = "11px";
    severityBadgeWarning.style.fontWeight = "700";
    severityBadgeWarning.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    severityBadgeWarning.style.whiteSpace = "nowrap";
    severityBadgeWarning.style.background = "#fde68a";
    severityBadgeWarning.style.color = "#7c4a03";
    severityBadgeWarning.style.border = "1px solid rgba(124, 74, 3, 0.6)";
    severityBadgeWarning.style.zIndex = "2";
    severityBadgeWarning.style.cursor = "pointer";
    severityBadgeWarning.title = "Severity 2 issues (warnings): in-flow / project total";
    severityBadgeWarning.textContent = "0/0";
    button.appendChild(severityBadgeWarning);

    // Severity-3 badge (errors, red) sits in the top-left corner.
    //
    // Anchored by `right: calc(100% - 14px)` so the badge's RIGHT edge
    // sits 14px inside the button's left edge and grows OUTWARD (to the
    // left) as the content widens.
    const severityBadgeError = document.createElement("span");
    severityBadgeError.style.position = "absolute";
    severityBadgeError.style.top = "-9px";
    severityBadgeError.style.right = "calc(100% - 14px)";
    severityBadgeError.style.left = "auto";
    severityBadgeError.style.height = "20px";
    severityBadgeError.style.padding = "0 7px";
    severityBadgeError.style.borderRadius = "999px";
    severityBadgeError.style.display = "flex";
    severityBadgeError.style.alignItems = "center";
    severityBadgeError.style.justifyContent = "center";
    severityBadgeError.style.fontSize = "11px";
    severityBadgeError.style.fontWeight = "700";
    severityBadgeError.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    severityBadgeError.style.whiteSpace = "nowrap";
    severityBadgeError.style.background = "#fecaca";
    severityBadgeError.style.color = "#7f1d1d";
    severityBadgeError.style.border = "1px solid rgba(127, 29, 29, 0.6)";
    severityBadgeError.style.zIndex = "2";
    severityBadgeError.style.cursor = "pointer";
    severityBadgeError.title = "Severity 3 issues (errors): in-flow / project total";
    severityBadgeError.textContent = "0/0";
    button.appendChild(severityBadgeError);

    const panel = document.createElement("div");
    panel.setAttribute("data-copilot-fab-panel", "1");
    panel.style.position = "absolute";
    panel.style.right = "0";
    panel.style.bottom = "70px";
    panel.style.width = "min(440px, calc(100vw - 32px))";
    panel.style.maxHeight = "420px";
    panel.style.overflow = "hidden";
    panel.style.borderRadius = "14px";
    panel.style.background = "rgba(25, 28, 34, 0.98)";
    panel.style.color = "#f6f7fb";
    panel.style.boxShadow = "0 14px 44px rgba(0,0,0,0.45)";
    panel.style.border = "1px solid rgba(255,255,255,0.12)";
    panel.style.display = "none";

    let list = null;
    if (CCP.flowChatUi && typeof CCP.flowChatUi.buildFabPanelContent === "function") {
      const built = CCP.flowChatUi.buildFabPanelContent(panel, ui);
      list = built && built.integrityList ? built.integrityList : null;
    }
    if (!list) {
      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.gap = "8px";
      header.style.padding = "12px 14px";
      header.style.fontSize = "13px";
      header.style.fontWeight = "700";
      header.style.borderBottom = "1px solid rgba(255,255,255,0.12)";
      const headerTitle = document.createElement("span");
      headerTitle.textContent = "Flow Integrity Check";
      const headerTools = document.createElement("div");
      headerTools.setAttribute("data-ccp-integrity-head-tools", "1");
      headerTools.style.display = "flex";
      headerTools.style.alignItems = "center";
      headerTools.style.marginLeft = "auto";
      headerTools.style.flexShrink = "0";
      header.appendChild(headerTitle);
      header.appendChild(headerTools);
      ui.integrityHeaderTools = headerTools;
      panel.appendChild(header);
      list = document.createElement("div");
      list.style.maxHeight = "480px";
      list.style.minHeight = "220px";
      list.style.overflowY = "auto";
      list.style.padding = "8px";
      panel.appendChild(list);
    }

    button.addEventListener("click", function () {
      ui.panelOpen = !ui.panelOpen;
      if (!ui.panelOpen) closeDismissScopePicker(ui);
      closeIntegrityExportFormatMenu(ui);
      panel.style.display = ui.panelOpen ? (ui.flowChatRoot ? "flex" : "block") : "none";
    });

    const outsideHandler = function (event) {
      if (!ui.panelOpen) return;
      if (isDismissPickerEventTarget(event.target)) return;
      if (!dock.contains(event.target)) {
        ui.panelOpen = false;
        closeDismissScopePicker(ui);
        closeIntegrityExportFormatMenu(ui);
        panel.style.display = "none";
        if (CCP.flowChatUi && typeof CCP.flowChatUi.notifyPanelClosed === "function") {
          CCP.flowChatUi.notifyPanelClosed();
        }
      }
    };
    document.addEventListener("mousedown", outsideHandler, true);

    dock.appendChild(panel);
    dock.appendChild(reloadBtn);
    dock.appendChild(button);

    document.documentElement.appendChild(dock);
    applyFabDockPositionFromStorage(dock);
    bindFabDockHorizontalDrag(dock, panel);
    bindInteractionPanelFabAvoidance(dock);

    const dockResizeHandler = function () {
      applyFabDockPositionFromStorage(dock);
    };
    window.addEventListener("resize", dockResizeHandler, { passive: true });

    function openPanelAndActivateSeverity(targetSeverity) {
      ui.panelOpen = true;
      panel.style.display = ui.flowChatRoot ? "flex" : "block";
      setActiveSeverityTab(targetSeverity, { rerender: true, persist: true });
    }
    severityBadgeError.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openPanelAndActivateSeverity(3);
    });
    severityBadgeWarning.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openPanelAndActivateSeverity(2);
    });

    ui.mounted = true;
    ui.root = dock;
    ui.dock = dock;
    ui.reloadButton = reloadBtn;
    ui.reloadIcon = reloadSvg;
    ui.dockResizeHandler = dockResizeHandler;
    ui.button = button;
    ui.fabLogo = logo;
    ui.severityBadgeError = severityBadgeError;
    ui.severityBadgeWarning = severityBadgeWarning;
    // Legacy aliases — the rest of the code still references `badge` and
    // `currentFlowBadge`, so keep them pointing at the new corner badges
    // until the consumers are migrated.
    ui.badge = severityBadgeWarning;
    ui.currentFlowBadge = severityBadgeError;
    ui.panel = panel;
    ui.list = list;
    if (ui.flowChatRoot) {
      panel.style.flexDirection = "column";
    }
    ui.outsideHandler = outsideHandler;
    ui.analysisSpinner = analysisSpinnerWrap;
  }

  /**
   * Adapt a `CognigyFlowNodeIssue` (project-map shape) to the row format
   * the FAB panel renders. The legacy `validation.errors` shape used
   * `{ type, severity, message, flowId, flowName, nodeId, nodeName, url }`
   * and the issue rows already speak that vocabulary.
   */
  function adaptProjectMapIssueForUi(issue) {
    if (!issue || typeof issue !== "object") return null;
    const flow = issue.flow || null;
    const node = issue.node || null;
    const llm = issue.llm || null;
    const flowId = flow ? String(flow.id || flow._id || "") : "";
    const flowName = flow ? String(flow.name || "") : "";
    const nodeId = node ? String(node.id || node._id || "") : "";
    const nodeName = node ? String(node.label || node.id || "") : "";
    const url = flowId && nodeId ? buildNodeLink(flowId, nodeId) : "";
    // Project-scoped issues without flow/node (e.g. llm_default_missing,
    // llm_unused) are surfaced under a synthetic "Project" entry.
    let displayFlowName = flowName;
    let displayNodeName = nodeName;
    if (!flow && llm) {
      displayFlowName = "Project";
      displayNodeName = "LLM: " + (llm.name || llm.reference_id || llm.referenceId || "");
    } else if (!flow) {
      displayFlowName = "Project";
      displayNodeName = String(issue.type || "");
    }
    const nodeType = node ? String(node.type || "") : "";
    return {
      type: String(issue.type || ""),
      severity: Number(issue.severity || 1),
      message: String(issue.message || ""),
      flowId: flowId,
      flowName: displayFlowName,
      nodeId: nodeId,
      nodeName: displayNodeName,
      nodeType: nodeType,
      url: url,
      fixable: issue.fixable === true,
    };
  }

  function mergeIssuesForUi(baseIssues, namingIssues) {
    const merged = [];
    if (Array.isArray(baseIssues)) {
      for (let i = 0; i < baseIssues.length; i++) {
        if (baseIssues[i]) merged.push(baseIssues[i]);
      }
    }
    if (Array.isArray(namingIssues)) {
      for (let j = 0; j < namingIssues.length; j++) {
        if (namingIssues[j]) merged.push(namingIssues[j]);
      }
    }
    merged.sort(function (a, b) {
      return (Number(b.severity) || 0) - (Number(a.severity) || 0);
    });
    return merged;
  }

  function collectProjectMapIssuesForUi() {
    const map = namingState.map;
    let raw = [];
    if (map) {
      try {
        raw = map.issues;
        if (!Array.isArray(raw) || !raw.length) {
          raw = map.findFlowNodeIssues();
        }
      } catch (e) {
        console.warn(NAMING_LOG_PREFIX, "findFlowNodeIssues failed", e);
        raw = [];
      }
    }
    const namingRaw = namingState.validation.namingConventionIssues || [];
    const combined = mergeIssuesForUi(raw, namingRaw);
    const out = [];
    for (let i = 0; i < combined.length; i++) {
      const adapted = adaptProjectMapIssueForUi(combined[i]);
      if (adapted) out.push(adapted);
    }
    return out;
  }

  function getVisibleProjectMapIssuesForUi() {
    return filterDismissedIssues(collectProjectMapIssuesForUi());
  }

  // ---------------------------------------------------------------------
  // Dismissed integrity issues (persisted per project in localStorage).
  // ---------------------------------------------------------------------

  const ISSUE_DISMISSALS_STORAGE_PREFIX = "ccp.flowIntegrityDismissals";

  function getIssueDismissalsStorageKey() {
    const projectId = getProjectIdFromLocation() || namingState.validation.projectId || "global";
    return ISSUE_DISMISSALS_STORAGE_PREFIX + "." + String(projectId);
  }

  function createEmptyIssueDismissals() {
    return { nodeMessages: [], issueTypeNodeTypes: [], issueTypes: [], nodeTypes: [] };
  }

  function loadIssueDismissals() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(getIssueDismissalsStorageKey());
      if (!raw) return createEmptyIssueDismissals();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return createEmptyIssueDismissals();
      return {
        nodeMessages: Array.isArray(parsed.nodeMessages) ? parsed.nodeMessages : [],
        issueTypeNodeTypes: Array.isArray(parsed.issueTypeNodeTypes) ? parsed.issueTypeNodeTypes : [],
        issueTypes: Array.isArray(parsed.issueTypes) ? parsed.issueTypes : [],
        nodeTypes: Array.isArray(parsed.nodeTypes) ? parsed.nodeTypes : [],
      };
    } catch (_) {
      return createEmptyIssueDismissals();
    }
  }

  function saveIssueDismissals(dismissals) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(
          getIssueDismissalsStorageKey(),
          JSON.stringify(dismissals || createEmptyIssueDismissals())
        );
      }
    } catch (_) {}
  }

  function isIssueDismissed(issue, dismissals) {
    if (!issue || !dismissals) return false;
    const nodeId = normalizeIssueIdentityPart(issue.nodeId);
    const message = String(issue.message || "");
    const issueType = String(issue.type || "");
    const nodeType = String(issue.nodeType || "");
    const nodeMessages = dismissals.nodeMessages || [];
    for (let i = 0; i < nodeMessages.length; i++) {
      const rule = nodeMessages[i];
      if (!rule) continue;
      if (normalizeIssueIdentityPart(rule.nodeId) === nodeId && String(rule.message || "") === message) {
        return true;
      }
    }
    if (issueType && dismissals.issueTypes.indexOf(issueType) >= 0) return true;
    const issueTypeNodeTypes = dismissals.issueTypeNodeTypes || [];
    for (let j = 0; j < issueTypeNodeTypes.length; j++) {
      const rule = issueTypeNodeTypes[j];
      if (!rule) continue;
      if (String(rule.issueType || "") === issueType && String(rule.nodeType || "") === nodeType) {
        return true;
      }
    }
    if (nodeType && dismissals.nodeTypes.indexOf(nodeType) >= 0) return true;
    return false;
  }

  function filterDismissedIssues(errors) {
    const dismissals = loadIssueDismissals();
    const out = [];
    for (let i = 0; i < (errors || []).length; i++) {
      const err = errors[i];
      if (!isIssueDismissed(err, dismissals)) out.push(err);
    }
    return out;
  }

  function addIssueDismissal(scope, error) {
    if (!error) return;
    const dismissals = loadIssueDismissals();
    if (scope === "node-message") {
      const nodeId = normalizeIssueIdentityPart(error.nodeId);
      const message = String(error.message || "");
      if (!nodeId && !message) return;
      const exists = dismissals.nodeMessages.some(function (rule) {
        return normalizeIssueIdentityPart(rule.nodeId) === nodeId && String(rule.message || "") === message;
      });
      if (!exists) dismissals.nodeMessages.push({ nodeId: nodeId, message: message });
    } else if (scope === "issue-type-on-node-type") {
      const issueType = String(error.type || "");
      const nodeType = String(error.nodeType || "");
      if (!issueType || !nodeType) return;
      const exists = dismissals.issueTypeNodeTypes.some(function (rule) {
        return String(rule.issueType || "") === issueType && String(rule.nodeType || "") === nodeType;
      });
      if (!exists) {
        dismissals.issueTypeNodeTypes.push({ issueType: issueType, nodeType: nodeType });
      }
    } else if (scope === "issue-type") {
      const issueType = String(error.type || "");
      if (issueType && dismissals.issueTypes.indexOf(issueType) < 0) {
        dismissals.issueTypes.push(issueType);
      }
    }
    saveIssueDismissals(dismissals);
  }

  function removeIssueDismissal(kind, ruleData) {
    const dismissals = loadIssueDismissals();
    if (kind === "node-message") {
      const nodeId = normalizeIssueIdentityPart(ruleData && ruleData.nodeId);
      const message = String((ruleData && ruleData.message) || "");
      dismissals.nodeMessages = dismissals.nodeMessages.filter(function (rule) {
        return !(
          normalizeIssueIdentityPart(rule.nodeId) === nodeId && String(rule.message || "") === message
        );
      });
    } else if (kind === "issue-type-on-node-type") {
      const issueType = String((ruleData && ruleData.issueType) || "");
      const nodeType = String((ruleData && ruleData.nodeType) || "");
      dismissals.issueTypeNodeTypes = dismissals.issueTypeNodeTypes.filter(function (rule) {
        return !(String(rule.issueType || "") === issueType && String(rule.nodeType || "") === nodeType);
      });
    } else if (kind === "issue-type") {
      const issueType = String((ruleData && ruleData.issueType) || "");
      dismissals.issueTypes = dismissals.issueTypes.filter(function (t) {
        return t !== issueType;
      });
    } else if (kind === "node-type") {
      const nodeType = String((ruleData && ruleData.nodeType) || "");
      dismissals.nodeTypes = dismissals.nodeTypes.filter(function (t) {
        return t !== nodeType;
      });
    }
    saveIssueDismissals(dismissals);
  }

  function countIssuesMatchingNodeMessageRule(allIssues, nodeId, message) {
    let count = 0;
    const nid = normalizeIssueIdentityPart(nodeId);
    const msg = String(message || "");
    for (let i = 0; i < (allIssues || []).length; i++) {
      const issue = allIssues[i];
      if (
        normalizeIssueIdentityPart(issue && issue.nodeId) === nid &&
        String((issue && issue.message) || "") === msg
      ) {
        count += 1;
      }
    }
    return count;
  }

  function countIssuesMatchingIssueTypeOnNodeTypeRule(allIssues, issueType, nodeType) {
    let count = 0;
    const it = String(issueType || "");
    const nt = String(nodeType || "");
    for (let i = 0; i < (allIssues || []).length; i++) {
      const issue = allIssues[i];
      if (String((issue && issue.type) || "") === it && String((issue && issue.nodeType) || "") === nt) {
        count += 1;
      }
    }
    return count;
  }

  function countIssuesMatchingIssueTypeRule(allIssues, issueType) {
    let count = 0;
    const t = String(issueType || "");
    for (let i = 0; i < (allIssues || []).length; i++) {
      if (String((allIssues[i] && allIssues[i].type) || "") === t) count += 1;
    }
    return count;
  }

  function countIssuesMatchingNodeTypeRule(allIssues, nodeType) {
    let count = 0;
    const t = String(nodeType || "");
    for (let i = 0; i < (allIssues || []).length; i++) {
      if (String((allIssues[i] && allIssues[i].nodeType) || "") === t) count += 1;
    }
    return count;
  }

  function resolveNodeLabelForSuppressionRule(nodeId) {
    const nid = normalizeIssueIdentityPart(nodeId);
    if (!nid) return "";
    for (const chart of namingState.chartCache.values()) {
      if (!chart || !chart.nodesById) continue;
      const node = chart.nodesById.get(String(nid));
      if (node) return String(node.label || node.id || nid);
    }
    return nid;
  }

  function buildSuppressionRuleEntries(allIssues) {
    const dismissals = loadIssueDismissals();
    const entries = [];
    for (let i = 0; i < (dismissals.nodeMessages || []).length; i++) {
      const rule = dismissals.nodeMessages[i];
      if (!rule) continue;
      const nodeId = normalizeIssueIdentityPart(rule.nodeId);
      const message = String(rule.message || "");
      const shortMessage = message.length > 96 ? message.slice(0, 93) + "…" : message;
      const nodeLabel = resolveNodeLabelForSuppressionRule(nodeId);
      entries.push({
        kind: "node-message",
        nodeId: nodeId,
        message: message,
        label: "Meldung für Node",
        detail: shortMessage + (nodeLabel ? " · " + nodeLabel : ""),
        count: countIssuesMatchingNodeMessageRule(allIssues, nodeId, message),
      });
    }
    for (let j = 0; j < (dismissals.issueTypeNodeTypes || []).length; j++) {
      const rule = dismissals.issueTypeNodeTypes[j];
      if (!rule) continue;
      const issueType = String(rule.issueType || "");
      const nodeType = String(rule.nodeType || "");
      if (!issueType || !nodeType) continue;
      entries.push({
        kind: "issue-type-on-node-type",
        issueType: issueType,
        nodeType: nodeType,
        label: "Meldungstyp auf Node-Typ",
        detail: issueType + " · " + nodeType,
        count: countIssuesMatchingIssueTypeOnNodeTypeRule(allIssues, issueType, nodeType),
      });
    }
    for (let k = 0; k < (dismissals.issueTypes || []).length; k++) {
      const issueType = dismissals.issueTypes[k];
      if (!issueType) continue;
      entries.push({
        kind: "issue-type",
        issueType: String(issueType),
        label: "Meldungstyp global",
        detail: String(issueType) + " · alle Nodes",
        count: countIssuesMatchingIssueTypeRule(allIssues, issueType),
      });
    }
    for (let m = 0; m < (dismissals.nodeTypes || []).length; m++) {
      const nodeType = dismissals.nodeTypes[m];
      if (!nodeType) continue;
      entries.push({
        kind: "node-type",
        nodeType: String(nodeType),
        label: "Node-Typ (legacy)",
        detail: String(nodeType) + " · alle Meldungen",
        count: countIssuesMatchingNodeTypeRule(allIssues, nodeType),
      });
    }
    return entries;
  }

  function filterSuppressionRulesBySearch(entries, query) {
    const parsed = parseIntegritySearchQuery(query);
    if (!normalizeSearchText(parsed.query)) return entries.slice();
    const out = [];
    for (let i = 0; i < (entries || []).length; i++) {
      const entry = entries[i];
      const fields = [entry && entry.label, entry && entry.detail, entry && entry.kind];
      let matches = false;
      for (let j = 0; j < fields.length; j++) {
        if (fuzzyTextMatchesQuery(parsed.query, fields[j])) {
          matches = true;
          break;
        }
      }
      const keep = parsed.negate ? !matches : matches;
      if (keep) out.push(entry);
    }
    return out;
  }

  function renderSuppressedRulesPanel(ui, allIssues, searchQuery) {
    ui.list.innerHTML = "";
    const entries = filterSuppressionRulesBySearch(buildSuppressionRuleEntries(allIssues), searchQuery);
    if (ui.suppressedTabCount) {
      const totalRules = buildSuppressionRuleEntries(allIssues).length;
      ui.suppressedTabCount.textContent = totalRules > 999 ? "999+" : String(totalRules);
      ui.suppressedTabCount.style.opacity = totalRules === 0 ? "0.55" : "1";
    }
    if (!entries.length) {
      const row = document.createElement("div");
      row.textContent = normalizeSearchText(parseIntegritySearchQuery(searchQuery).query)
        ? parseIntegritySearchQuery(searchQuery).negate
          ? "Keine Regeln für die invertierte Suche."
          : "Keine Treffer für die Suche."
        : buildSuppressionRuleEntries(allIssues).length
          ? "Keine Ausblend-Regeln für diese Suche."
          : "Keine Ausblend-Regeln.";
      row.style.padding = "10px 8px";
      row.style.fontSize = "12px";
      row.style.opacity = "0.7";
      ui.list.appendChild(row);
      return;
    }

    const titleEl = document.createElement("div");
    titleEl.textContent = "Ausblend-Regeln";
    titleEl.style.padding = "4px 8px 4px 8px";
    titleEl.style.fontSize = "11px";
    titleEl.style.fontWeight = "500";
    titleEl.style.letterSpacing = "0.02em";
    titleEl.style.color = "rgba(203, 213, 225, 0.65)";
    ui.list.appendChild(titleEl);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "flex-start";
      row.style.gap = "10px";
      row.style.padding = "10px 8px";
      row.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

      const text = document.createElement("div");
      text.style.flex = "1";
      text.style.minWidth = "0";
      text.style.display = "flex";
      text.style.flexDirection = "column";
      text.style.gap = "4px";

      const line1 = document.createElement("div");
      line1.style.display = "flex";
      line1.style.alignItems = "center";
      line1.style.gap = "8px";
      line1.style.fontSize = "12px";
      line1.style.fontWeight = "600";
      line1.style.color = "rgba(241, 245, 249, 0.95)";

      const kindLabel = document.createElement("span");
      kindLabel.textContent = String(entry.label || "");
      line1.appendChild(kindLabel);

      const countBadge = document.createElement("span");
      const count = Number(entry.count || 0);
      countBadge.textContent = count > 999 ? "999+" : String(count);
      countBadge.title = count + " unterdrückte Meldung" + (count === 1 ? "" : "en");
      countBadge.style.flexShrink = "0";
      countBadge.style.minWidth = "18px";
      countBadge.style.height = "18px";
      countBadge.style.padding = "0 6px";
      countBadge.style.borderRadius = "999px";
      countBadge.style.display = "inline-flex";
      countBadge.style.alignItems = "center";
      countBadge.style.justifyContent = "center";
      countBadge.style.fontSize = "10px";
      countBadge.style.fontWeight = "700";
      countBadge.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      countBadge.style.lineHeight = "1";
      countBadge.style.background = "rgba(148, 163, 184, 0.16)";
      countBadge.style.color = "rgba(226, 232, 240, 0.92)";
      countBadge.style.border = "1px solid rgba(148, 163, 184, 0.22)";
      line1.appendChild(countBadge);
      text.appendChild(line1);

      const line2 = document.createElement("div");
      line2.textContent = String(entry.detail || "");
      line2.style.fontSize = "11px";
      line2.style.lineHeight = "1.45";
      line2.style.color = "rgba(203, 213, 225, 0.78)";
      line2.style.wordBreak = "break-word";
      text.appendChild(line2);
      row.appendChild(text);

      const revokeBtn = document.createElement("button");
      revokeBtn.type = "button";
      revokeBtn.textContent = "Aufheben";
      revokeBtn.title = "Regel entfernen und Meldungen wieder anzeigen";
      revokeBtn.style.flexShrink = "0";
      revokeBtn.style.alignSelf = "center";
      revokeBtn.style.padding = "6px 10px";
      revokeBtn.style.borderRadius = "8px";
      revokeBtn.style.border = "1px solid rgba(255,255,255,0.1)";
      revokeBtn.style.background = "rgba(255,255,255,0.04)";
      revokeBtn.style.color = "rgba(226, 232, 240, 0.9)";
      revokeBtn.style.fontSize = "11px";
      revokeBtn.style.fontWeight = "500";
      revokeBtn.style.cursor = "pointer";
      revokeBtn.style.transition = "background 120ms ease, border-color 120ms ease";
      revokeBtn.addEventListener("mouseenter", function () {
        revokeBtn.style.background = "rgba(148, 163, 184, 0.12)";
        revokeBtn.style.borderColor = "rgba(255,255,255,0.16)";
      });
      revokeBtn.addEventListener("mouseleave", function () {
        revokeBtn.style.background = "rgba(255,255,255,0.04)";
        revokeBtn.style.borderColor = "rgba(255,255,255,0.1)";
      });
      revokeBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        removeIssueDismissal(entry.kind, entry);
        renderValidationWidget();
        renderChartValidationVisuals();
      });
      row.appendChild(revokeBtn);
      ui.list.appendChild(row);
    }
  }

  function filterDeadPathNodeIdsByDismissals(nodeIds, flowId) {
    const ids = Array.isArray(nodeIds) ? nodeIds.slice() : [];
    const dismissals = loadIssueDismissals();
    if (dismissals.issueTypes.indexOf("deadPath") >= 0) return [];
    const issueTypeNodeTypes = dismissals.issueTypeNodeTypes || [];
    const legacyNodeTypes = dismissals.nodeTypes || [];
    const hasScopedDeadPath = issueTypeNodeTypes.some(function (rule) {
      return rule && String(rule.issueType) === "deadPath";
    });
    if (!hasScopedDeadPath && !legacyNodeTypes.length) return ids;
    const chart = namingState.chartCache.get(String(flowId || ""));
    if (!chart || !chart.nodesById) return ids;
    return ids.filter(function (nodeId) {
      const node = chart.nodesById.get(String(nodeId));
      const nodeType = node && node.type ? String(node.type) : "";
      if (legacyNodeTypes.indexOf(nodeType) >= 0) return false;
      for (let i = 0; i < issueTypeNodeTypes.length; i++) {
        const rule = issueTypeNodeTypes[i];
        if (!rule) continue;
        if (String(rule.issueType) === "deadPath" && String(rule.nodeType) === nodeType) {
          return false;
        }
      }
      return true;
    });
  }

  function isDismissPickerEventTarget(target) {
    if (!target) return false;
    const ui = namingState.validation.ui;
    if (ui && ui.dismissPickerOverlay && ui.dismissPickerOverlay.contains(target)) return true;
    const el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (el && typeof el.closest === "function") {
      return !!el.closest('[data-ccp-dismiss-picker="1"]');
    }
    return false;
  }

  function closeDismissScopePicker(ui) {
    if (!ui || !ui.dismissPickerOverlay) return;
    try {
      ui.dismissPickerOverlay.remove();
    } catch (_) {}
    ui.dismissPickerOverlay = null;
  }

  function showDismissScopePicker(error, ui) {
    if (!error || !ui) return;
    closeDismissScopePicker(ui);

    const overlay = document.createElement("div");
    overlay.setAttribute("data-ccp-dismiss-picker", "1");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "20px";
    overlay.style.background = "rgba(2, 6, 23, 0.52)";
    overlay.style.backdropFilter = "blur(3px)";
    overlay.style.webkitBackdropFilter = "blur(3px)";

    const card = document.createElement("div");
    card.style.width = "min(420px, 100%)";
    card.style.borderRadius = "14px";
    card.style.border = "1px solid rgba(255,255,255,0.1)";
    card.style.background = "rgba(15, 23, 42, 0.98)";
    card.style.boxShadow = "0 24px 48px rgba(0,0,0,0.45)";
    card.style.padding = "16px 16px 12px 16px";
    card.style.color = "rgba(241, 245, 249, 0.96)";
    card.style.fontFamily = "inherit";

    const title = document.createElement("div");
    title.textContent = "Meldung ausblenden";
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.letterSpacing = "0.01em";
    title.style.marginBottom = "4px";

    const subtitle = document.createElement("div");
    subtitle.textContent = "Was soll dauerhaft ausgeblendet werden?";
    subtitle.style.fontSize = "12px";
    subtitle.style.color = "rgba(203, 213, 225, 0.72)";
    subtitle.style.marginBottom = "14px";

    const nodeLabel = String(error.nodeName || error.nodeId || "Node");
    const nodeTypeLabel = String(error.nodeType || "—");
    const issueTypeLabel = String(error.type || "—");
    const messagePreview = String(error.message || "").trim();
    const shortMessage = messagePreview.length > 120 ? messagePreview.slice(0, 117) + "…" : messagePreview;

    function makeOption(label, detail, scope, enabled) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.display = "block";
      btn.style.width = "100%";
      btn.style.textAlign = "left";
      btn.style.padding = "10px 12px";
      btn.style.marginBottom = "8px";
      btn.style.borderRadius = "10px";
      btn.style.border = "1px solid rgba(255,255,255,0.08)";
      btn.style.background = "rgba(255,255,255,0.03)";
      btn.style.color = "inherit";
      btn.style.cursor = enabled ? "pointer" : "not-allowed";
      btn.style.opacity = enabled ? "1" : "0.45";
      btn.style.transition = "background 120ms ease, border-color 120ms ease";

      const lbl = document.createElement("div");
      lbl.textContent = label;
      lbl.style.fontSize = "12px";
      lbl.style.fontWeight = "600";
      lbl.style.marginBottom = "3px";

      const det = document.createElement("div");
      det.textContent = detail;
      det.style.fontSize = "11px";
      det.style.lineHeight = "1.45";
      det.style.color = "rgba(203, 213, 225, 0.78)";

      btn.appendChild(lbl);
      btn.appendChild(det);

      if (enabled) {
        btn.addEventListener("mouseenter", function () {
          btn.style.background = "rgba(148, 163, 184, 0.1)";
          btn.style.borderColor = "rgba(255,255,255,0.14)";
        });
        btn.addEventListener("mouseleave", function () {
          btn.style.background = "rgba(255,255,255,0.03)";
          btn.style.borderColor = "rgba(255,255,255,0.08)";
        });
        btn.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          addIssueDismissal(scope, error);
          closeDismissScopePicker(ui);
          renderValidationWidget();
          renderChartValidationVisuals();
        });
      }
      return btn;
    }

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(
      makeOption(
        "Nur diese Meldung für diese Node",
        shortMessage + " — Node: " + nodeLabel,
        "node-message",
        !!(normalizeIssueIdentityPart(error.nodeId) || shortMessage)
      )
    );
    card.appendChild(
      makeOption(
        "Diesen Meldungstyp auf diesem Node-Typ",
        "Typ: " + issueTypeLabel + " · Node-Typ: " + nodeTypeLabel,
        "issue-type-on-node-type",
        !!issueTypeLabel && issueTypeLabel !== "—" && !!nodeTypeLabel && nodeTypeLabel !== "—"
      )
    );
    card.appendChild(
      makeOption(
        "Diesen Meldungstyp auf allen Nodes",
        "Typ: " + issueTypeLabel,
        "issue-type",
        !!issueTypeLabel && issueTypeLabel !== "—"
      )
    );

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Abbrechen";
    cancel.style.width = "100%";
    cancel.style.marginTop = "4px";
    cancel.style.padding = "8px 12px";
    cancel.style.borderRadius = "10px";
    cancel.style.border = "0";
    cancel.style.background = "transparent";
    cancel.style.color = "rgba(203, 213, 225, 0.78)";
    cancel.style.fontSize = "12px";
    cancel.style.cursor = "pointer";
    cancel.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeDismissScopePicker(ui);
    });
    card.appendChild(cancel);

    overlay.appendChild(card);
    overlay.addEventListener(
      "mousedown",
      function (ev) {
        ev.stopPropagation();
      },
      true
    );
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) closeDismissScopePicker(ui);
    });
    card.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });

    ui.dismissPickerOverlay = overlay;
    // Same host as the FAB dock (documentElement) so the modal stacks above the panel.
    document.documentElement.appendChild(overlay);
  }

  function attachIntegrityRowSwipeDismiss(row, dismissBg, error, ui) {
    if (!row || !error || !ui) return;
    const thresholdPx = 72;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let activePointerId = null;
    let suppressClick = false;

    row.addEventListener(
      "click",
      function (ev) {
        if (suppressClick) {
          ev.preventDefault();
          ev.stopPropagation();
          suppressClick = false;
        }
      },
      true
    );
    row.addEventListener("dragstart", function (ev) {
      ev.preventDefault();
    });

    function setOffset(px) {
      const clamped = Math.max(-120, Math.min(0, px));
      row.style.transform = "translateX(" + clamped + "px)";
      if (dismissBg) {
        dismissBg.style.opacity = String(Math.min(1, Math.abs(clamped) / thresholdPx));
      }
    }

    function resetOffset(animate) {
      row.style.transition = animate ? "transform 160ms ease" : "none";
      setOffset(0);
      if (animate) {
        setTimeout(function () {
          row.style.transition = "background 120ms ease";
        }, 170);
      }
    }

    row.addEventListener("pointerdown", function (ev) {
      if (isIntegrityFixButtonTarget(ev.target)) return;
      if (ev.button != null && ev.button !== 0) return;
      dragging = true;
      suppressClick = false;
      activePointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      row.style.transition = "none";
      try {
        row.setPointerCapture(ev.pointerId);
      } catch (_) {}
    });

    row.addEventListener("pointermove", function (ev) {
      if (!dragging || ev.pointerId !== activePointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > Math.abs(dx) + 8 && Math.abs(dx) < 12) return;
      if (dx > 4) return;
      if (Math.abs(dx) > 10) suppressClick = true;
      setOffset(dx);
      if (Math.abs(dx) > 8) {
        ev.preventDefault();
        try {
          ev.stopPropagation();
        } catch (_) {}
      }
    });

    function finishPointer(ev) {
      if (!dragging || (ev && ev.pointerId !== activePointerId)) return;
      dragging = false;
      activePointerId = null;
      const matrix = window.getComputedStyle(row).transform;
      let offset = 0;
      if (matrix && matrix !== "none") {
        const parts = matrix.match(/matrix\(([^)]+)\)/);
        if (parts && parts[1]) {
          const values = parts[1].split(",").map(function (v) {
            return parseFloat(v);
          });
          if (values.length >= 6) offset = values[4] || 0;
        }
      }
      if (offset <= -thresholdPx) {
        resetOffset(true);
        showDismissScopePicker(error, ui);
      } else {
        resetOffset(true);
      }
      try {
        if (ev) row.releasePointerCapture(ev.pointerId);
      } catch (_) {}
    }

    row.addEventListener("pointerup", finishPointer);
    row.addEventListener("pointercancel", finishPointer);
  }

  // ---------------------------------------------------------------------
  // Flow-Integrity-Check tab bar (one tab per severity 3 / 2 / 1).
  //
  // The active tab is persisted in localStorage so the user comes back
  // to the same severity after a reload. Tabs intentionally use the
  // same dark/flat aesthetic as the rest of the FAB panel — colored
  // accents (severity dot + active underline) carry the information.
  // ---------------------------------------------------------------------

  const SEVERITY_TAB_STORAGE_KEY = "ccp.flowIntegrityActiveSeverityTab";
  const SEVERITY_TAB_LABELS = { 3: "Errors", 2: "Warnings", 1: "Info" };
  const SEVERITY_TAB_ACCENT = { 3: "#dc2626", 2: "#f59e0b", 1: "#3b82f6" };
  const SUPPRESSED_TAB_KEY = "suppressed";
  const SUPPRESSED_TAB_LABEL = "Ausgeblendet";
  const SUPPRESSED_TAB_ACCENT = "#94a3b8";

  function readPersistedSeverityTab() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(SEVERITY_TAB_STORAGE_KEY);
      if (raw === SUPPRESSED_TAB_KEY) return SUPPRESSED_TAB_KEY;
      const n = Number(raw);
      if (n === 1 || n === 2 || n === 3) return n;
    } catch (_) {}
    return null;
  }

  function persistSeverityTab(sev) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(SEVERITY_TAB_STORAGE_KEY, String(sev));
      }
    } catch (_) {}
  }

  function isSuppressedIntegrityTab(tab) {
    return tab === SUPPRESSED_TAB_KEY;
  }

  function resolveInitialSeverityTab() {
    const stored = readPersistedSeverityTab();
    if (stored) return stored;
    return 3;
  }

  /**
   * Normalize flow/node identity parts for deduplication. Empty strings,
   * null and undefined all collapse to "" so "all null" rows match.
   */
  function normalizeIssueIdentityPart(value) {
    if (value == null) return "";
    return String(value).trim();
  }

  function isProjectScopedIntegrityIssue(error) {
    if (!error || typeof error !== "object") return false;
    return !normalizeIssueIdentityPart(error.flowId);
  }

  /**
   * Build a stable grouping key for issue rows inside one severity tab +
   * section. Two issues merge when message text and flow identity are
   * identical (including the all-empty flow case). Node identity is
   * intentionally ignored so the same flow-level message collapses even
   * when it appears on different nodes.
   */
  function issueDisplayDedupeKey(error) {
    if (!error || typeof error !== "object") return "";
    const message = String(error.message || "");
    const flowId = normalizeIssueIdentityPart(error.flowId);
    const flowName = normalizeIssueIdentityPart(error.flowName);
    return [message, flowId, flowName].join("\x1e");
  }

  /**
   * Collapse duplicate display rows while preserving the input order of
   * the first occurrence in each group.
   */
  function groupIssuesForDisplay(errors) {
    const groups = new Map();
    const order = [];
    for (let i = 0; i < (errors || []).length; i++) {
      const err = errors[i];
      const key = issueDisplayDedupeKey(err);
      if (!groups.has(key)) {
        groups.set(key, { error: err, count: 1 });
        order.push(key);
      } else {
        groups.get(key).count += 1;
      }
    }
    return order.map(function (key) {
      return groups.get(key);
    });
  }

  function countGroupedIntegrityIssues(errors) {
    return groupIssuesForDisplay(errors || []).length;
  }

  function buildDuplicateCountTooltip(count, error) {
    const n = Number(count || 0);
    if (n <= 1) return "";
    const flowLabel =
      normalizeIssueIdentityPart(error && error.flowName) ||
      normalizeIssueIdentityPart(error && error.flowId) ||
      "ohne Flow";
    return "Diese Meldung tritt " + n + "-mal auf — jeweils mit gleichem Text und Flow (" + flowLabel + ").";
  }

  function createIntegrityDuplicateCountBadge(count, error) {
    const duplicateCount = Number(count || 1);
    const countBadge = document.createElement("span");
    countBadge.textContent = duplicateCount > 99 ? "99+" : String(duplicateCount);
    countBadge.title = buildDuplicateCountTooltip(duplicateCount, error);
    countBadge.style.flexShrink = "0";
    countBadge.style.alignSelf = "center";
    countBadge.style.minWidth = "18px";
    countBadge.style.height = "18px";
    countBadge.style.padding = "0 6px";
    countBadge.style.borderRadius = "999px";
    countBadge.style.display = "inline-flex";
    countBadge.style.alignItems = "center";
    countBadge.style.justifyContent = "center";
    countBadge.style.fontSize = "10px";
    countBadge.style.fontWeight = "700";
    countBadge.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    countBadge.style.lineHeight = "1";
    countBadge.style.background = "rgba(255, 255, 255, 0.1)";
    countBadge.style.color = "rgba(226, 232, 240, 0.92)";
    countBadge.style.border = "1px solid rgba(255, 255, 255, 0.14)";
    countBadge.style.cursor = "default";
    countBadge.style.userSelect = "none";
    return countBadge;
  }

  function normalizeSearchText(value) {
    if (value == null) return "";
    return String(value).trim().toLowerCase();
  }

  function levenshteinDistance(a, b) {
    const s = String(a || "");
    const t = String(b || "");
    const m = s.length;
    const n = t.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      const sc = s.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = sc === t.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      const swap = prev;
      prev = curr;
      curr = swap;
    }
    return prev[n];
  }

  function fuzzyTextMatchesQuery(query, text) {
    const q = normalizeSearchText(query);
    const hay = normalizeSearchText(text);
    if (!q) return true;
    if (!hay) return false;
    if (hay.indexOf(q) >= 0) return true;

    const threshold = Math.max(1, Math.ceil(q.length * 0.35));
    if (hay.length <= q.length + threshold) {
      return levenshteinDistance(q, hay) <= threshold;
    }
    const windowLen = Math.min(hay.length, q.length + threshold + 2);
    for (let i = 0; i <= hay.length - q.length; i++) {
      const slice = hay.slice(i, i + windowLen);
      if (levenshteinDistance(q, slice) <= threshold) return true;
    }
    return false;
  }

  function parseIntegritySearchQuery(raw) {
    const text = String(raw || "");
    const trimmed = text.trim();
    if (trimmed.startsWith("!")) {
      return { negate: true, query: trimmed.slice(1).trim() };
    }
    return { negate: false, query: trimmed };
  }

  function issueMatchesIntegritySearch(issue, query) {
    if (!normalizeSearchText(query)) return true;
    const fields = [
      issue && issue.flowId,
      issue && issue.flowName,
      issue && issue.nodeId,
      issue && issue.nodeName,
      issue && issue.nodeType,
      issue && issue.type,
      issue && issue.message,
    ];
    for (let i = 0; i < fields.length; i++) {
      if (fuzzyTextMatchesQuery(query, fields[i])) return true;
    }
    return false;
  }

  function filterIssuesByIntegritySearch(errors, query) {
    const parsed = parseIntegritySearchQuery(query);
    if (!normalizeSearchText(parsed.query)) return errors.slice();
    const out = [];
    for (let i = 0; i < (errors || []).length; i++) {
      const err = errors[i];
      const matches = issueMatchesIntegritySearch(err, parsed.query);
      const keep = parsed.negate ? !matches : matches;
      if (keep) out.push(err);
    }
    return out;
  }

  const INTEGRITY_EXPORT_FORMAT_STORAGE_KEY = "ccp.flowIntegrityExportFormat";

  function readPersistedIntegrityExportFormat() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(INTEGRITY_EXPORT_FORMAT_STORAGE_KEY);
      if (raw === "csv" || raw === "text") return raw;
    } catch (_) {}
    return "text";
  }

  function persistIntegrityExportFormat(format) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(INTEGRITY_EXPORT_FORMAT_STORAGE_KEY, String(format));
      }
    } catch (_) {}
  }

  function getIntegrityExportFormat(ui) {
    if (ui && (ui.integrityExportFormat === "text" || ui.integrityExportFormat === "csv")) {
      return ui.integrityExportFormat;
    }
    return readPersistedIntegrityExportFormat();
  }

  function setIntegrityExportFormat(ui, format) {
    if (format !== "text" && format !== "csv") return;
    if (ui) ui.integrityExportFormat = format;
    persistIntegrityExportFormat(format);
    updateIntegrityCopyActionLabel(ui);
    updateIntegrityExportFormatMenu(ui);
  }

  function integrityExportFormatLabel(format) {
    return format === "csv" ? "CSV" : "Text";
  }

  function integrityClipboardIconSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
      '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
      "</svg>"
    );
  }

  function integrityChevronDownSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="m6 9 6 6 6-6"></path>' +
      "</svg>"
    );
  }

  function sortIntegrityIssuesForDisplay(a, b) {
    const projectA = isProjectScopedIntegrityIssue(a);
    const projectB = isProjectScopedIntegrityIssue(b);
    if (projectA !== projectB) return projectA ? -1 : 1;
    const flowA = String(a.flowName || a.flowId || "").toLowerCase();
    const flowB = String(b.flowName || b.flowId || "").toLowerCase();
    if (flowA !== flowB) return flowA.localeCompare(flowB);
    const nodeA = String(a.nodeName || a.nodeId || "").toLowerCase();
    const nodeB = String(b.nodeName || b.nodeId || "").toLowerCase();
    if (nodeA !== nodeB) return nodeA.localeCompare(nodeB);
    return String(a.message || "").localeCompare(String(b.message || ""));
  }

  function collectIntegrityIssuesBySeverityForClipboard(ui) {
    const visible = getVisibleProjectMapIssuesForUi();
    const searchQuery = (ui && ui.integritySearchQuery) || "";
    const filtered = filterIssuesByIntegritySearch(visible, searchQuery);
    const bySeverity = { 1: [], 2: [], 3: [] };
    for (let i = 0; i < filtered.length; i++) {
      const err = filtered[i];
      const sev = Number(err && err.severity ? err.severity : 1);
      if (sev === 1 || sev === 2 || sev === 3) bySeverity[sev].push(err);
    }
    for (const sev of [3, 2, 1]) {
      bySeverity[sev].sort(sortIntegrityIssuesForDisplay);
    }
    return bySeverity;
  }

  function formatIntegrityClipboardEntry(group, severityLabel) {
    const err = group && group.error ? group.error : {};
    const count = Number(group && group.count ? group.count : 1);
    const lines = [];
    if (severityLabel) lines.push("Severity: " + String(severityLabel));
    lines.push(
      "Häufigkeit: " + String(count),
      "Text: " + String(err.message || ""),
      "Flow: " + String(err.flowName || ""),
      "Flow-ID: " + String(err.flowId || ""),
      "Node: " + String(err.nodeName || ""),
      "Node-ID: " + String(err.nodeId || "")
    );
    return lines.join("\n");
  }

  function collectIntegrityExportRows(ui) {
    const bySeverity = collectIntegrityIssuesBySeverityForClipboard(ui);
    const levelLabels = { 3: "Errors", 2: "Warnings", 1: "Info" };
    const rows = [];
    for (const sev of [3, 2, 1]) {
      const errors = bySeverity[sev] || [];
      if (!errors.length) continue;
      const grouped = groupIssuesForDisplay(errors);
      for (let i = 0; i < grouped.length; i++) {
        const g = grouped[i];
        const err = g.error || {};
        rows.push({
          severity: levelLabels[sev],
          count: Number(g.count || 1),
          message: String(err.message || ""),
          flowName: String(err.flowName || ""),
          flowId: String(err.flowId || ""),
          nodeName: String(err.nodeName || ""),
          nodeId: String(err.nodeId || ""),
        });
      }
    }
    return rows;
  }

  function integrityExportEmptyMessage(ui) {
    const parsed = parseIntegritySearchQuery((ui && ui.integritySearchQuery) || "");
    if (normalizeSearchText(parsed.query)) {
      return parsed.negate
        ? "Keine Meldungen für die invertierte Suche (nicht unterdrückt)."
        : "Keine Meldungen für die aktuelle Suche (nicht unterdrückt).";
    }
    return "Keine Meldungen (nicht unterdrückt).";
  }

  function csvEscapeField(value) {
    const s = String(value == null ? "" : value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildIntegrityClipboardCsv(ui) {
    const rows = collectIntegrityExportRows(ui);
    if (!rows.length) return integrityExportEmptyMessage(ui);
    const header = ["severity", "count", "message", "flow_name", "flow_id", "node_name", "node_id"];
    const lines = [header.join(",")];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      lines.push(
        [
          csvEscapeField(row.severity),
          csvEscapeField(row.count),
          csvEscapeField(row.message),
          csvEscapeField(row.flowName),
          csvEscapeField(row.flowId),
          csvEscapeField(row.nodeName),
          csvEscapeField(row.nodeId),
        ].join(",")
      );
    }
    return lines.join("\n");
  }

  function buildIntegrityClipboardText(ui) {
    const bySeverity = collectIntegrityIssuesBySeverityForClipboard(ui);
    const levelLabels = { 3: "Errors", 2: "Warnings", 1: "Info" };
    const parts = [];
    let totalEntries = 0;

    for (const sev of [3, 2, 1]) {
      const errors = bySeverity[sev] || [];
      if (!errors.length) continue;
      const grouped = groupIssuesForDisplay(errors);
      totalEntries += grouped.length;
      parts.push("=== " + levelLabels[sev] + " (" + errors.length + " Meldungen) ===");
      parts.push("");
      for (let i = 0; i < grouped.length; i++) {
        parts.push(formatIntegrityClipboardEntry(grouped[i], levelLabels[sev]));
        if (i < grouped.length - 1) {
          parts.push("");
          parts.push("---");
          parts.push("");
        }
      }
      parts.push("");
    }

    if (!totalEntries) return integrityExportEmptyMessage(ui);
    return parts.join("\n").trim();
  }

  function buildIntegrityExportPayload(ui, format) {
    if (format === "csv") return buildIntegrityClipboardCsv(ui);
    return buildIntegrityClipboardText(ui);
  }

  function writeTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "readonly");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (ok) resolve();
        else reject(new Error("execCommand copy failed"));
      } catch (e) {
        reject(e);
      }
    });
  }

  function showIntegrityCopySuccessFeedback(ui) {
    if (!ui) return;
    const wrap = ui.integrityCopyControl;
    const main = ui.integrityCopyMain;
    const btn = ui.integrityCopyActionButton;
    const icon = main && main.querySelector(".ccp-fc-integrity-copy-icon");
    if (ui.integrityCopyFeedbackTimer) {
      clearTimeout(ui.integrityCopyFeedbackTimer);
      ui.integrityCopyFeedbackTimer = null;
    }
    if (wrap) wrap.classList.add("ccp-copied");
    if (main) main.classList.add("ccp-copied");
    if (btn) {
      btn.classList.add("ccp-copied");
      btn.textContent = "Copied!";
    }
    if (icon) icon.classList.add("ccp-copied");
    ui.integrityCopyFeedbackTimer = setTimeout(function () {
      ui.integrityCopyFeedbackTimer = null;
      if (wrap) wrap.classList.remove("ccp-copied");
      if (main) main.classList.remove("ccp-copied");
      if (btn) btn.classList.remove("ccp-copied");
      if (icon) icon.classList.remove("ccp-copied");
      updateIntegrityCopyActionLabel(ui);
    }, 1600);
  }

  function copyFilteredIntegrityIssuesToClipboard(ui, actionButton) {
    const format = getIntegrityExportFormat(ui);
    const payload = buildIntegrityExportPayload(ui, format);
    return writeTextToClipboard(payload)
      .then(function () {
        showIntegrityCopySuccessFeedback(ui);
      })
      .catch(function (e) {
        console.warn(NAMING_LOG_PREFIX, "integrity clipboard copy failed", e);
        if (actionButton) actionButton.title = "Kopieren fehlgeschlagen";
      });
  }

  function closeIntegrityExportFormatMenu(ui) {
    if (!ui || !ui.integrityCopyFormatMenu) return;
    ui.integrityCopyFormatMenu.style.display = "none";
    if (ui.integrityCopyFormatButton) {
      ui.integrityCopyFormatButton.setAttribute("aria-expanded", "false");
    }
  }

  function bindIntegrityExportFormatOutsideClose(ui) {
    if (!ui || ui.integrityExportFormatOutsideHandler) return;
    ui.integrityExportFormatOutsideHandler = function (event) {
      const target = event.target;
      if (!target || !ui.integrityCopyControl) return;
      if (ui.integrityCopyControl.contains(target)) return;
      closeIntegrityExportFormatMenu(ui);
    };
    document.addEventListener("mousedown", ui.integrityExportFormatOutsideHandler, true);
  }

  function updateIntegrityCopyActionLabel(ui) {
    const btn = ui && ui.integrityCopyActionButton;
    if (!btn) return;
    const format = getIntegrityExportFormat(ui);
    const typeLabel = integrityExportFormatLabel(format);
    btn.textContent = "Copy " + typeLabel;
    btn.title = "Gefilterte Meldungen als " + typeLabel + " kopieren";
    btn.setAttribute("aria-label", "Copy " + typeLabel);
  }

  function updateIntegrityExportFormatMenu(ui) {
    const menu = ui && ui.integrityCopyFormatMenu;
    if (!menu) return;
    const active = getIntegrityExportFormat(ui);
    const options = menu.querySelectorAll("[data-ccp-integrity-export-format]");
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const fmt = opt.getAttribute("data-ccp-integrity-export-format");
      const isActive = fmt === active;
      opt.setAttribute("aria-checked", isActive ? "true" : "false");
      opt.style.background = isActive ? "rgba(148, 163, 184, 0.14)" : "transparent";
      opt.style.color = isActive ? "rgba(241, 245, 249, 0.96)" : "rgba(226, 232, 240, 0.88)";
    }
  }

  function toggleIntegrityExportFormatMenu(ui) {
    if (!ui || !ui.integrityCopyFormatMenu) return;
    const open = ui.integrityCopyFormatMenu.style.display !== "block";
    if (open) {
      updateIntegrityExportFormatMenu(ui);
      ui.integrityCopyFormatMenu.style.display = "block";
      if (ui.integrityCopyFormatButton) {
        ui.integrityCopyFormatButton.setAttribute("aria-expanded", "true");
      }
    } else {
      closeIntegrityExportFormatMenu(ui);
    }
  }

  function resolveIntegrityHeaderTools(ui) {
    if (!ui) return null;
    if (ui.integrityHeaderTools && ui.integrityHeaderTools.isConnected) {
      return ui.integrityHeaderTools;
    }
    if (ui.list) {
      const wrap = ui.list.closest("[data-ccp-integrity-wrap]") || ui.list.closest(".ccp-fc-integrity");
      if (wrap) {
        const tools = wrap.querySelector("[data-ccp-integrity-head-tools]");
        if (tools) {
          ui.integrityHeaderTools = tools;
          return tools;
        }
      }
    }
    return null;
  }

  function ensureIntegrityHeaderCopyButton(ui) {
    if (!ui) return null;
    const tools = resolveIntegrityHeaderTools(ui);
    if (!tools) return null;
    if (ui.integrityExportFormat == null) {
      ui.integrityExportFormat = readPersistedIntegrityExportFormat();
    }
    if (ui.integrityCopyControl && ui.integrityCopyControl.isConnected) {
      updateIntegrityCopyActionLabel(ui);
      updateIntegrityExportFormatMenu(ui);
      return ui.integrityCopyControl;
    }

    const wrap = document.createElement("div");
    wrap.className = "ccp-fc-integrity-export-wrap";
    wrap.setAttribute("data-ccp-integrity-export-wrap", "1");
    wrap.style.position = "relative";
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "2px";
    wrap.style.flexShrink = "0";

    const copyMain = document.createElement("div");
    copyMain.className = "ccp-fc-integrity-copy-main";
    copyMain.setAttribute("data-ccp-integrity-copy-main", "1");

    const icon = document.createElement("span");
    icon.className = "ccp-fc-integrity-copy-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = integrityClipboardIconSvg();

    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "ccp-fc-integrity-copy-action";
    actionBtn.setAttribute("data-ccp-integrity-copy-action", "1");
    actionBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeIntegrityExportFormatMenu(ui);
      void copyFilteredIntegrityIssuesToClipboard(ui, actionBtn);
    });

    copyMain.appendChild(icon);
    copyMain.appendChild(actionBtn);

    const formatBtn = document.createElement("button");
    formatBtn.type = "button";
    formatBtn.className = "ccp-fc-integrity-format-btn";
    formatBtn.setAttribute("data-ccp-integrity-format-btn", "1");
    formatBtn.title = "Export-Format wählen";
    formatBtn.setAttribute("aria-label", "Export-Format wählen");
    formatBtn.setAttribute("aria-haspopup", "menu");
    formatBtn.setAttribute("aria-expanded", "false");
    formatBtn.innerHTML = integrityChevronDownSvg();
    formatBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleIntegrityExportFormatMenu(ui);
    });

    const menu = document.createElement("div");
    menu.className = "ccp-fc-integrity-format-menu";
    menu.setAttribute("data-ccp-integrity-format-menu", "1");
    menu.setAttribute("role", "menu");
    menu.style.display = "none";

    function makeFormatOption(format, label) {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "ccp-fc-integrity-format-option";
      opt.setAttribute("data-ccp-integrity-export-format", format);
      opt.setAttribute("role", "menuitemradio");
      opt.textContent = label;
      opt.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setIntegrityExportFormat(ui, format);
        closeIntegrityExportFormatMenu(ui);
      });
      return opt;
    }

    menu.appendChild(makeFormatOption("text", "Text"));
    menu.appendChild(makeFormatOption("csv", "CSV"));

    wrap.appendChild(copyMain);
    wrap.appendChild(formatBtn);
    wrap.appendChild(menu);
    tools.appendChild(wrap);

    ui.integrityCopyControl = wrap;
    ui.integrityCopyMain = copyMain;
    ui.integrityCopyActionButton = actionBtn;
    ui.integrityCopyFormatButton = formatBtn;
    ui.integrityCopyFormatMenu = menu;
    bindIntegrityExportFormatOutsideClose(ui);
    updateIntegrityCopyActionLabel(ui);
    updateIntegrityExportFormatMenu(ui);
    return wrap;
  }

  function buildIntegritySearchBar(ui) {
    if (ui.integritySearchWrap && ui.integritySearchWrap.isConnected) {
      if (ui.integritySearchInput && document.activeElement !== ui.integritySearchInput) {
        ui.integritySearchInput.value = ui.integritySearchQuery || "";
      }
      return ui.integritySearchWrap;
    }
    const list = ui.list;
    if (!list || !list.parentNode) return null;

    const wrap = document.createElement("div");
    wrap.setAttribute("data-ccp-integrity-search", "1");
    wrap.style.padding = "8px 8px 4px 8px";
    wrap.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
    wrap.style.background = "transparent";
    wrap.style.flexShrink = "0";

    const input = document.createElement("input");
    input.type = "search";
    input.setAttribute("aria-label", "Flow Integrity Check durchsuchen");
    input.placeholder = "Suchen… (! = invertieren)";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = ui.integritySearchQuery || "";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.padding = "7px 10px";
    input.style.borderRadius = "8px";
    input.style.border = "1px solid rgba(255,255,255,0.1)";
    input.style.background = "rgba(255,255,255,0.04)";
    input.style.color = "rgba(240, 242, 248, 0.95)";
    input.style.fontSize = "12px";
    input.style.fontFamily = "inherit";
    input.style.outline = "none";
    input.style.transition = "border-color 120ms ease, background 120ms ease";
    input.addEventListener("focus", function () {
      input.style.borderColor = "rgba(255,255,255,0.18)";
      input.style.background = "rgba(255,255,255,0.06)";
    });
    input.addEventListener("blur", function () {
      input.style.borderColor = "rgba(255,255,255,0.1)";
      input.style.background = "rgba(255,255,255,0.04)";
    });
    input.addEventListener("input", function () {
      ui.integritySearchQuery = input.value;
      renderValidationWidget();
    });
    input.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });
    input.addEventListener("keydown", function (ev) {
      ev.stopPropagation();
    });

    wrap.appendChild(input);
    const insertBefore =
      ui.severityTabBar && ui.severityTabBar.parentNode === list.parentNode ? ui.severityTabBar : list;
    list.parentNode.insertBefore(wrap, insertBefore);
    ui.integritySearchWrap = wrap;
    ui.integritySearchInput = input;
    return wrap;
  }

  function ensureIntegrityPanelChrome(ui) {
    buildIntegritySearchBar(ui);
    buildSeverityTabBar(ui);
    ensureIntegrityHeaderCopyButton(ui);
  }

  function isIntegrityFixButtonTarget(target) {
    return !!(target && target.closest && target.closest(".ccp-fc-integrity-fix-btn"));
  }

  function attachIntegrityRowNavigate(row, handler) {
    if (!row || typeof handler !== "function") return;
    row.addEventListener("click", function (event) {
      if (isIntegrityFixButtonTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    });
    row.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (isIntegrityFixButtonTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      handler(event);
    });
  }

  function createIntegrityFixButton(error, ui) {
    const autofix = getAutofixApi();
    if (!autofix || !autofix.canFixIssue(error)) return null;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ccp-fc-integrity-fix-btn";
    btn.textContent = "Fix";
    btn.title = "Naming convention auto-fix";
    function stopRowActivation(ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    btn.addEventListener("mousedown", stopRowActivation);
    btn.addEventListener("pointerdown", stopRowActivation);
    btn.addEventListener("click", function (ev) {
      stopRowActivation(ev);
      if (btn.disabled || (ui && ui.fixAllInFlight)) return;
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = "…";
      void autofix
        .fixSingleIssue(error, getAutofixContext())
        .then(function (result) {
          if (!result || !result.ok) return;
          // applyNamingConventionFix → refreshUiAfterNamingAutofix handles UI.
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = prevText;
        });
    });
    return btn;
  }

  function renderFixAllBar(ui, visibleIssues) {
    const autofix = getAutofixApi();
    if (!ui || !ui.list || !ui.list.parentNode) return;

    const fixableTypes = autofix ? autofix.collectFixableTypes(visibleIssues) : new Map();
    const hasFixable = fixableTypes.size > 0;

    if (!hasFixable) {
      if (ui.fixAllBar && ui.fixAllBar.parentNode) {
        ui.fixAllBar.parentNode.removeChild(ui.fixAllBar);
      }
      ui.fixAllBar = null;
      return;
    }

    let bar = ui.fixAllBar;
    if (!bar || !bar.isConnected) {
      bar = document.createElement("div");
      bar.className = "ccp-fc-fix-all-bar";
      bar.setAttribute("data-ccp-fix-all-bar", "1");
      ui.list.parentNode.insertBefore(bar, ui.list);
      ui.fixAllBar = bar;
    }

    bar.innerHTML = "";
    fixableTypes.forEach(function (count, issueType) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ccp-fc-fix-all-btn";
      btn.setAttribute("data-ccp-fix-all-type", String(issueType));
      btn.disabled = !!ui.fixAllInFlight;

      const progressWrap = document.createElement("span");
      progressWrap.className = "ccp-fc-fix-progress-wrap";
      progressWrap.style.display = "none";
      const ringParts = autofix.createProgressRingElement(20);
      progressWrap.appendChild(ringParts.svg);
      const progressLabel = document.createElement("span");
      progressLabel.className = "ccp-fc-fix-progress-label";
      progressWrap.appendChild(progressLabel);

      const primary = document.createElement("span");
      primary.className = "ccp-fc-fix-all-btn-primary";
      primary.textContent = "Fix All";

      const divider = document.createElement("span");
      divider.className = "ccp-fc-fix-all-btn-divider";
      divider.setAttribute("aria-hidden", "true");

      const typeLabel = document.createElement("span");
      typeLabel.className = "ccp-fc-fix-all-btn-type";
      typeLabel.textContent = autofix.getFixHandlerDisplayLabel(issueType);

      const countBadge = document.createElement("span");
      countBadge.className = "ccp-fc-fix-all-btn-count";
      countBadge.textContent = String(count);

      btn.appendChild(progressWrap);
      btn.appendChild(primary);
      btn.appendChild(divider);
      btn.appendChild(typeLabel);
      btn.appendChild(countBadge);

      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ui.fixAllInFlight) return;
        const candidates = (visibleIssues || []).filter(function (issue) {
          return issue && String(issue.type || "") === String(issueType) && autofix.canFixIssue(issue);
        });
        if (!candidates.length) return;

        ui.fixAllInFlight = true;
        btn.disabled = true;
        progressWrap.style.display = "inline-flex";
        progressLabel.textContent = "0/" + String(candidates.length);
        autofix.updateProgressRing(ringParts, { total: candidates.length, success: 0, failure: 0 });

        void autofix
          .fixIssuesByType(issueType, candidates, {
            concurrency: autofix.FIX_CONCURRENCY,
            ctx: getAutofixContext(),
            onProgress: function (progress) {
              autofix.updateProgressRing(ringParts, progress);
              progressLabel.textContent = String(progress.done || 0) + "/" + String(progress.total || 0);
            },
          })
          .then(function (result) {
            progressLabel.textContent =
              String(result.success || 0) +
              "/" +
              String(result.total || 0) +
              (result.failure ? " ✗" + result.failure : "");
          })
          .finally(function () {
            setTimeout(function () {
              ui.fixAllInFlight = false;
              renderValidationWidget();
            }, 1200);
          });
      });

      bar.appendChild(btn);
    });
  }

  function buildSeverityTabBar(ui) {
    if (ui.severityTabBar && ui.severityTabBar.isConnected) return ui.severityTabBar;
    const list = ui.list;
    if (!list || !list.parentNode) return null;

    const bar = document.createElement("div");
    bar.setAttribute("data-ccp-severity-tabs", "1");
    bar.style.display = "flex";
    bar.style.alignItems = "stretch";
    bar.style.gap = "2px";
    bar.style.padding = "4px 8px 0 8px";
    bar.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
    bar.style.background = "transparent";
    bar.style.userSelect = "none";
    bar.style.flexShrink = "0";

    function buildTab(sev) {
      const wrap = document.createElement("button");
      wrap.type = "button";
      wrap.setAttribute("data-ccp-severity-tab", String(sev));
      wrap.style.position = "relative";
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "6px";
      wrap.style.padding = "6px 10px 7px 10px";
      wrap.style.border = "0";
      wrap.style.background = "transparent";
      wrap.style.color = "rgba(220, 222, 230, 0.78)";
      wrap.style.fontSize = "11px";
      wrap.style.fontWeight = "500";
      wrap.style.letterSpacing = "0.02em";
      wrap.style.cursor = "pointer";
      wrap.style.borderRadius = "6px 6px 0 0";
      wrap.style.transition = "color 120ms ease, background 120ms ease";

      const dot = document.createElement("span");
      dot.style.width = "6px";
      dot.style.height = "6px";
      dot.style.borderRadius = "999px";
      dot.style.background = SEVERITY_TAB_ACCENT[sev];
      dot.style.flexShrink = "0";
      wrap.appendChild(dot);

      const label = document.createElement("span");
      label.textContent = SEVERITY_TAB_LABELS[sev];
      label.style.lineHeight = "1.1";
      wrap.appendChild(label);

      const count = document.createElement("span");
      count.setAttribute("data-ccp-severity-tab-count", String(sev));
      count.textContent = "0";
      count.style.fontSize = "10px";
      count.style.fontWeight = "600";
      count.style.padding = "1px 6px";
      count.style.borderRadius = "999px";
      count.style.background = "rgba(255,255,255,0.06)";
      count.style.color = "rgba(225, 228, 234, 0.78)";
      count.style.lineHeight = "1.4";
      count.style.minWidth = "16px";
      count.style.textAlign = "center";
      count.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      wrap.appendChild(count);

      const underline = document.createElement("span");
      underline.style.position = "absolute";
      underline.style.left = "8px";
      underline.style.right = "8px";
      underline.style.bottom = "-1px";
      underline.style.height = "2px";
      underline.style.background = SEVERITY_TAB_ACCENT[sev];
      underline.style.borderRadius = "2px 2px 0 0";
      underline.style.opacity = "0";
      underline.style.transition = "opacity 120ms ease";
      underline.style.pointerEvents = "none";
      wrap.appendChild(underline);

      wrap.addEventListener("mouseenter", function () {
        if (ui.activeSeverityTab !== sev) {
          wrap.style.color = "rgba(240, 242, 248, 0.95)";
        }
      });
      wrap.addEventListener("mouseleave", function () {
        if (ui.activeSeverityTab !== sev) {
          wrap.style.color = "rgba(220, 222, 230, 0.78)";
        }
      });
      wrap.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setActiveSeverityTab(sev, { rerender: true, persist: true });
      });

      ui.severityTabButtons[sev] = wrap;
      ui.severityTabCounts[sev] = count;
      ui.severityTabUnderlines[sev] = underline;
      return wrap;
    }

    // Severity-3 first (most important), then 2, then 1, then suppressed rules.
    bar.appendChild(buildTab(3));
    bar.appendChild(buildTab(2));
    bar.appendChild(buildTab(1));

    const suppressedWrap = document.createElement("button");
    suppressedWrap.type = "button";
    suppressedWrap.setAttribute("data-ccp-severity-tab", SUPPRESSED_TAB_KEY);
    suppressedWrap.style.position = "relative";
    suppressedWrap.style.display = "inline-flex";
    suppressedWrap.style.alignItems = "center";
    suppressedWrap.style.gap = "6px";
    suppressedWrap.style.padding = "6px 10px 7px 10px";
    suppressedWrap.style.border = "0";
    suppressedWrap.style.background = "transparent";
    suppressedWrap.style.color = "rgba(220, 222, 230, 0.78)";
    suppressedWrap.style.fontSize = "11px";
    suppressedWrap.style.fontWeight = "500";
    suppressedWrap.style.letterSpacing = "0.02em";
    suppressedWrap.style.cursor = "pointer";
    suppressedWrap.style.borderRadius = "6px 6px 0 0";
    suppressedWrap.style.transition = "color 120ms ease, background 120ms ease";

    const suppressedDot = document.createElement("span");
    suppressedDot.style.width = "6px";
    suppressedDot.style.height = "6px";
    suppressedDot.style.borderRadius = "999px";
    suppressedDot.style.background = SUPPRESSED_TAB_ACCENT;
    suppressedDot.style.flexShrink = "0";
    suppressedWrap.appendChild(suppressedDot);

    const suppressedLabel = document.createElement("span");
    suppressedLabel.textContent = SUPPRESSED_TAB_LABEL;
    suppressedLabel.style.lineHeight = "1.1";
    suppressedWrap.appendChild(suppressedLabel);

    const suppressedCount = document.createElement("span");
    suppressedCount.setAttribute("data-ccp-severity-tab-count", SUPPRESSED_TAB_KEY);
    suppressedCount.textContent = "0";
    suppressedCount.style.fontSize = "10px";
    suppressedCount.style.fontWeight = "600";
    suppressedCount.style.padding = "1px 6px";
    suppressedCount.style.borderRadius = "999px";
    suppressedCount.style.background = "rgba(255,255,255,0.06)";
    suppressedCount.style.color = "rgba(225, 228, 234, 0.78)";
    suppressedCount.style.lineHeight = "1.4";
    suppressedCount.style.minWidth = "16px";
    suppressedCount.style.textAlign = "center";
    suppressedCount.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    suppressedWrap.appendChild(suppressedCount);

    const suppressedUnderline = document.createElement("span");
    suppressedUnderline.style.position = "absolute";
    suppressedUnderline.style.left = "8px";
    suppressedUnderline.style.right = "8px";
    suppressedUnderline.style.bottom = "-1px";
    suppressedUnderline.style.height = "2px";
    suppressedUnderline.style.background = SUPPRESSED_TAB_ACCENT;
    suppressedUnderline.style.borderRadius = "2px 2px 0 0";
    suppressedUnderline.style.opacity = "0";
    suppressedUnderline.style.transition = "opacity 120ms ease";
    suppressedUnderline.style.pointerEvents = "none";
    suppressedWrap.appendChild(suppressedUnderline);

    suppressedWrap.addEventListener("mouseenter", function () {
      if (ui.activeSeverityTab !== SUPPRESSED_TAB_KEY) {
        suppressedWrap.style.color = "rgba(240, 242, 248, 0.95)";
      }
    });
    suppressedWrap.addEventListener("mouseleave", function () {
      if (ui.activeSeverityTab !== SUPPRESSED_TAB_KEY) {
        suppressedWrap.style.color = "rgba(220, 222, 230, 0.78)";
      }
    });
    suppressedWrap.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setActiveSeverityTab(SUPPRESSED_TAB_KEY, { rerender: true, persist: true });
    });

    ui.suppressedTabButton = suppressedWrap;
    ui.suppressedTabCount = suppressedCount;
    ui.suppressedTabUnderline = suppressedUnderline;
    bar.appendChild(suppressedWrap);

    list.parentNode.insertBefore(bar, list);
    ui.severityTabBar = bar;
    return bar;
  }

  function applySeverityTabActiveStyles(ui) {
    const active = ui.activeSeverityTab;
    for (const sev of [3, 2, 1]) {
      const btn = ui.severityTabButtons[sev];
      const underline = ui.severityTabUnderlines[sev];
      if (!btn || !underline) continue;
      const isActive = active === sev;
      btn.style.color = isActive ? "rgba(245, 247, 252, 1)" : "rgba(220, 222, 230, 0.78)";
      btn.style.background = isActive ? "rgba(255, 255, 255, 0.04)" : "transparent";
      underline.style.opacity = isActive ? "1" : "0";
    }
    if (ui.suppressedTabButton && ui.suppressedTabUnderline) {
      const isActive = active === SUPPRESSED_TAB_KEY;
      ui.suppressedTabButton.style.color = isActive ? "rgba(245, 247, 252, 1)" : "rgba(220, 222, 230, 0.78)";
      ui.suppressedTabButton.style.background = isActive ? "rgba(255, 255, 255, 0.04)" : "transparent";
      ui.suppressedTabUnderline.style.opacity = isActive ? "1" : "0";
    }
  }

  function setActiveSeverityTab(sev, options) {
    const opts = options || {};
    const ui = namingState.validation.ui;
    if (sev !== 1 && sev !== 2 && sev !== 3 && sev !== SUPPRESSED_TAB_KEY) return;
    ui.activeSeverityTab = sev;
    if (opts.persist) persistSeverityTab(sev);
    applySeverityTabActiveStyles(ui);
    if (opts.rerender) renderValidationWidget();
  }

  /**
   * Compute the FAB status from a list of UI-adapted issues:
   *   - red    when any severity-3 issue exists project-wide
   *   - yellow when any severity-2 (but no severity-3) issue exists
   *   - blue   when any severity-1 info (but no severity-2/3) issue exists
   *   - green  when no visible issues exist (dismissed/suppressed are excluded upstream)
   */
  function computeFabSeverityStatus(uiIssues, currentFlowId) {
    const totals = { 1: 0, 2: 0, 3: 0 };
    const inFlow = { 1: 0, 2: 0, 3: 0 };
    const cfid = String(currentFlowId || "");
    for (let i = 0; i < uiIssues.length; i++) {
      const it = uiIssues[i];
      const sev = Number(it && it.severity ? it.severity : 1);
      if (sev < 1 || sev > 3) continue;
      totals[sev] = (totals[sev] || 0) + 1;
      if (cfid && String(it.flowId || "") === cfid) {
        inFlow[sev] = (inFlow[sev] || 0) + 1;
      }
    }
    let color;
    if (totals[3] > 0)
      color = "#dc2626"; // red
    else if (totals[2] > 0)
      color = "#f59e0b"; // yellow
    else if (totals[1] > 0)
      color = "#3b82f6"; // blue (info)
    else color = "#22c55e"; // green — no visible issues
    return { totals, inFlow, color };
  }

  function renderValidationWidget() {
    mountValidationWidgetIfNeeded();
    const ui = namingState.validation.ui;
    // Source the issues exclusively from the project-map; the legacy
    // `validation.errors` are kept only as a compatibility shim for the
    // few helpers that still mutate it during the transition.
    const errors = getVisibleProjectMapIssuesForUi();
    const allIssues = collectProjectMapIssuesForUi();
    const errorCount = errors.length;
    if (!ui.button || !ui.list) return;

    // Lazily build search + severity tab bar the first time we have a list
    // element wired up (it might come from `buildFabPanelContent` or the
    // fallback simple panel).
    ensureIntegrityPanelChrome(ui);
    if (ui.activeSeverityTab == null) {
      ui.activeSeverityTab = resolveInitialSeverityTab();
      applySeverityTabActiveStyles(ui);
    }

    const searchQuery = ui.integritySearchQuery || "";
    const filteredErrors = filterIssuesByIntegritySearch(errors, searchQuery);

    const loadingFirstAnalysis = !namingState.validation.analysisCompletedOnce && !!ui.analysisPending;
    if (loadingFirstAnalysis) {
      ui.button.style.background = "#b7b7b7";
      ui.button.style.border = "2px solid rgba(255,255,255,0.75)";
      if (ui.fabLogo) {
        ui.fabLogo.style.opacity = "0";
      }
      if (ui.analysisSpinner) {
        ui.analysisSpinner.style.display = "flex";
      }
      if (ui.severityBadgeError) ui.severityBadgeError.style.opacity = "0.35";
      if (ui.severityBadgeWarning) ui.severityBadgeWarning.style.opacity = "0.35";
      // Reset tab counts while analysing.
      for (const sev of [3, 2, 1]) {
        if (ui.severityTabCounts[sev]) ui.severityTabCounts[sev].textContent = "—";
      }
      if (ui.suppressedTabCount) ui.suppressedTabCount.textContent = "—";
      renderFixAllBar(ui, []);
      ui.list.innerHTML = "";
      const pendingRow = document.createElement("div");
      pendingRow.textContent = "Flow-Analyse läuft…";
      pendingRow.style.padding = "12px 10px";
      pendingRow.style.fontSize = "12px";
      pendingRow.style.opacity = "0.85";
      ui.list.appendChild(pendingRow);
      return;
    }

    if (ui.fabLogo) {
      ui.fabLogo.style.opacity = "1";
    }
    if (ui.analysisSpinner) {
      ui.analysisSpinner.style.display = "none";
    }

    const currentFlowId = getCurrentFlowIdFromLocation();
    const status = computeFabSeverityStatus(errors, currentFlowId);
    ui.button.style.background = status.color;

    if (ui.severityBadgeError) {
      const x = status.inFlow[3] || 0;
      const y = status.totals[3] || 0;
      ui.severityBadgeError.textContent = x + "/" + y;
      ui.severityBadgeError.style.display = "flex";
      ui.severityBadgeError.style.opacity = x === 0 && y === 0 ? "0.35" : "1";
      ui.severityBadgeError.title = "Severity 3 (errors): " + x + " in this flow, " + y + " in the project";
    }
    if (ui.severityBadgeWarning) {
      const x = status.inFlow[2] || 0;
      const y = status.totals[2] || 0;
      ui.severityBadgeWarning.textContent = x + "/" + y;
      ui.severityBadgeWarning.style.display = "flex";
      ui.severityBadgeWarning.style.opacity = x === 0 && y === 0 ? "0.35" : "1";
      ui.severityBadgeWarning.title =
        "Severity 2 (warnings): " + x + " in this flow, " + y + " in the project";
    }

    // Pre-compute per-severity buckets from the search-filtered set so tab
    // counts reflect the active query across all three levels.
    const bySeverity = { 1: [], 2: [], 3: [] };
    for (let i = 0; i < filteredErrors.length; i++) {
      const err = filteredErrors[i];
      const sev = Number(err && err.severity ? err.severity : 1);
      if (sev === 1 || sev === 2 || sev === 3) bySeverity[sev].push(err);
    }
    for (const sev of [3, 2, 1]) {
      if (ui.severityTabCounts[sev]) {
        const c = countGroupedIntegrityIssues(bySeverity[sev]);
        ui.severityTabCounts[sev].textContent = c > 999 ? "999+" : String(c);
        ui.severityTabCounts[sev].style.opacity = c === 0 ? "0.55" : "1";
      }
    }
    if (ui.suppressedTabCount) {
      const ruleCount = buildSuppressionRuleEntries(allIssues).length;
      ui.suppressedTabCount.textContent = ruleCount > 999 ? "999+" : String(ruleCount);
      ui.suppressedTabCount.style.opacity = ruleCount === 0 ? "0.55" : "1";
    }

    const activeTab = ui.activeSeverityTab || resolveInitialSeverityTab();
    if (isSuppressedIntegrityTab(activeTab)) {
      renderFixAllBar(ui, []);
      renderSuppressedRulesPanel(ui, allIssues, searchQuery);
      return;
    }

    const activeSev = activeTab;
    const activeErrors = bySeverity[activeSev] || [];
    renderFixAllBar(ui, activeErrors);
    const currentFlowErrors = currentFlowId
      ? activeErrors.filter((error) => String(error.flowId || "") === String(currentFlowId))
      : [];
    const otherFlowErrors = currentFlowId
      ? activeErrors.filter((error) => String(error.flowId || "") !== String(currentFlowId))
      : activeErrors.slice();
    currentFlowErrors.sort(sortIntegrityIssuesForDisplay);
    otherFlowErrors.sort(sortIntegrityIssuesForDisplay);

    ui.list.innerHTML = "";
    if (!errorCount) {
      const row = document.createElement("div");
      row.textContent = "No validation issues found.";
      row.style.padding = "10px 8px";
      row.style.fontSize = "12px";
      row.style.opacity = "0.9";
      ui.list.appendChild(row);
      return;
    }
    if (normalizeSearchText(parseIntegritySearchQuery(searchQuery).query) && filteredErrors.length === 0) {
      const row = document.createElement("div");
      row.textContent = parseIntegritySearchQuery(searchQuery).negate
        ? "Keine Einträge für die invertierte Suche."
        : "Keine Treffer für die Suche.";
      row.style.padding = "10px 8px";
      row.style.fontSize = "12px";
      row.style.opacity = "0.7";
      ui.list.appendChild(row);
      return;
    }
    if (activeErrors.length === 0) {
      const row = document.createElement("div");
      row.textContent =
        activeSev === 3
          ? "Keine Errors gefunden."
          : activeSev === 2
            ? "Keine Warnings gefunden."
            : "Keine Info-Hinweise gefunden.";
      row.style.padding = "10px 8px";
      row.style.fontSize = "12px";
      row.style.opacity = "0.7";
      ui.list.appendChild(row);
      return;
    }

    function createFlowIcon() {
      const wrap = document.createElement("span");
      wrap.style.display = "inline-flex";
      wrap.style.width = "14px";
      wrap.style.height = "14px";
      wrap.style.color = "rgba(203, 213, 225, 0.95)";
      wrap.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"></path><path d="m7 16.5-4.74-2.85"></path><path d="m7 16.5 5-3"></path><path d="M7 16.5v5.17"></path><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"></path><path d="m17 16.5-5-3"></path><path d="m17 16.5 4.74-2.85"></path><path d="M17 16.5v5.17"></path><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"></path><path d="M12 8 7.26 5.15"></path><path d="m12 8 4.74-2.85"></path><path d="M12 13.5V8"></path></svg>';
      return wrap;
    }

    function createNodeIcon() {
      const wrap = document.createElement("span");
      wrap.style.display = "inline-flex";
      wrap.style.width = "14px";
      wrap.style.height = "14px";
      wrap.style.color = "rgba(203, 213, 225, 0.95)";
      wrap.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>';
      return wrap;
    }

    function renderSection(title, sectionErrors, sectionTopSpacing, isCurrentFlowSection) {
      if (!Array.isArray(sectionErrors) || sectionErrors.length === 0) return;
      const titleEl = document.createElement("div");
      titleEl.textContent = title;
      titleEl.style.padding = sectionTopSpacing ? "12px 8px 4px 8px" : "4px 8px 4px 8px";
      titleEl.style.fontSize = "11px";
      titleEl.style.fontWeight = "500";
      titleEl.style.letterSpacing = "0.02em";
      titleEl.style.color = "rgba(203, 213, 225, 0.65)";
      ui.list.appendChild(titleEl);

      const groupedErrors = groupIssuesForDisplay(sectionErrors);
      for (let gi = 0; gi < groupedErrors.length; gi++) {
        const group = groupedErrors[gi];
        const error = group.error;
        const duplicateCount = Number(group.count || 1);

        const swipeWrap = document.createElement("div");
        swipeWrap.style.position = "relative";
        swipeWrap.style.overflow = "hidden";

        const dismissBg = document.createElement("div");
        dismissBg.style.position = "absolute";
        dismissBg.style.inset = "0";
        dismissBg.style.display = "flex";
        dismissBg.style.alignItems = "center";
        dismissBg.style.justifyContent = "flex-end";
        dismissBg.style.paddingRight = "14px";
        dismissBg.style.background = "rgba(220, 38, 38, 0.12)";
        dismissBg.style.opacity = "0";
        dismissBg.style.pointerEvents = "none";
        dismissBg.style.transition = "opacity 120ms ease";
        const dismissHint = document.createElement("span");
        dismissHint.textContent = "Ausblenden";
        dismissHint.style.fontSize = "11px";
        dismissHint.style.fontWeight = "600";
        dismissHint.style.letterSpacing = "0.03em";
        dismissHint.style.color = "rgba(254, 226, 226, 0.92)";
        dismissBg.appendChild(dismissHint);
        swipeWrap.appendChild(dismissBg);

        const row = document.createElement("div");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        if (isCurrentFlowSection) {
          attachIntegrityRowNavigate(row, function () {
            centerAndClickCurrentFlowNode(error.nodeId);
          });
        } else {
          attachIntegrityRowNavigate(row, function () {
            const url = String(error.url || "");
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          });
        }
        row.draggable = false;
        row.style.display = "block";
        row.style.padding = "10px 8px";
        row.style.textDecoration = "none";
        row.style.color = "inherit";
        row.style.font = "inherit";
        row.style.fontFamily = "inherit";
        row.style.borderRadius = "0";
        row.style.width = "100%";
        row.style.textAlign = "left";
        row.style.border = "0";
        row.style.background = "rgba(15, 23, 42, 0.98)";
        row.style.cursor = "pointer";
        row.style.position = "relative";
        row.style.zIndex = "1";
        row.style.touchAction = "pan-y";
        row.style.transition = "transform 160ms ease, background 120ms ease";
        row.style.willChange = "transform";
        row.addEventListener("mouseenter", function () {
          if (
            row.style.transform &&
            row.style.transform !== "translateX(0px)" &&
            row.style.transform !== "none"
          ) {
            return;
          }
          row.style.background = "rgba(148, 163, 184, 0.08)";
        });
        row.addEventListener("mouseleave", function () {
          row.style.background = "rgba(15, 23, 42, 0.98)";
        });

        const rowInner = document.createElement("div");
        rowInner.style.display = "flex";
        rowInner.style.alignItems = "flex-start";
        rowInner.style.gap = "8px";
        rowInner.style.minWidth = "0";
        rowInner.style.width = "100%";

        const text = document.createElement("div");
        text.style.flex = "1";
        text.style.minWidth = "0";
        text.style.width = "100%";
        text.style.display = "flex";
        text.style.flexDirection = "column";
        text.style.gap = "4px";
        text.style.lineHeight = "1.4";

        const line1 = document.createElement("div");
        line1.style.display = "flex";
        line1.style.alignItems = "center";
        line1.style.gap = "8px";
        line1.style.width = "100%";
        line1.style.minWidth = "0";
        line1.style.fontSize = "12px";
        line1.style.fontWeight = "500";
        line1.style.color = "rgba(226, 232, 240, 0.82)";

        const flowPart = document.createElement("span");
        flowPart.style.display = "inline-flex";
        flowPart.style.alignItems = "center";
        flowPart.style.gap = "6px";
        flowPart.style.flexShrink = "0";
        flowPart.appendChild(createFlowIcon());
        const flowText = document.createElement("span");
        flowText.textContent = String(error.flowName || error.flowId || "Unknown Flow");
        flowPart.appendChild(flowText);

        const sep = document.createElement("span");
        sep.textContent = "/";
        sep.style.opacity = "0.5";
        sep.style.flexShrink = "0";

        const nodePart = document.createElement("span");
        nodePart.style.display = "inline-flex";
        nodePart.style.alignItems = "center";
        nodePart.style.gap = "6px";
        nodePart.style.minWidth = "0";
        nodePart.appendChild(createNodeIcon());
        const nodeText = document.createElement("span");
        nodeText.textContent = String(error.nodeName || error.nodeId || "Unknown Node");
        nodeText.style.minWidth = "0";
        nodeText.style.overflow = "hidden";
        nodeText.style.textOverflow = "ellipsis";
        nodeText.style.whiteSpace = "nowrap";
        nodePart.appendChild(nodeText);

        if (duplicateCount > 1) {
          line1.appendChild(createIntegrityDuplicateCountBadge(duplicateCount, error));
        }
        line1.appendChild(flowPart);
        line1.appendChild(sep);
        line1.appendChild(nodePart);

        const line2 = document.createElement("div");
        line2.style.display = "flex";
        line2.style.alignItems = "flex-start";
        line2.style.gap = "8px";
        line2.style.width = "100%";
        line2.style.minWidth = "0";
        line2.style.fontSize = "12px";
        line2.style.fontWeight = "600";
        line2.style.color = "rgba(241, 245, 249, 0.95)";

        const msgText = document.createElement("span");
        msgText.style.flex = "1";
        msgText.style.minWidth = "0";
        msgText.style.wordBreak = "break-word";
        msgText.style.overflowWrap = "anywhere";
        msgText.textContent = String(error.message || "");
        line2.appendChild(msgText);

        const fixBtn = createIntegrityFixButton(error, ui);
        if (fixBtn) line2.appendChild(fixBtn);

        text.appendChild(line1);
        text.appendChild(line2);
        // Rows are now grouped under a single-severity tab, so the
        // per-row severity dot would only repeat the tab indicator.
        // Drop it and let the row breathe.
        rowInner.appendChild(text);
        row.appendChild(rowInner);
        attachIntegrityRowSwipeDismiss(row, dismissBg, error, ui);
        swipeWrap.appendChild(row);
        swipeWrap.style.borderBottom = "1px solid rgba(255,255,255,0.08)";
        ui.list.appendChild(swipeWrap);
      }
    }
    if (currentFlowId) {
      renderSection("Dieser Flow", currentFlowErrors, false, true);
      renderSection("Gesamt", otherFlowErrors, currentFlowErrors.length > 0, false);
    } else {
      renderSection("Gesamt", otherFlowErrors, false, false);
    }
  }
  function markFlowDirtyForChartLoad(flowId) {
    if (!flowId) return;
    namingState.validation.dirtyChartLoadFlowIds.add(String(flowId));
  }

  function markFlowDirtyForDetails(flowId, forceRefresh) {
    if (!flowId) return;
    const key = String(flowId);
    const current = namingState.validation.dirtyDetailFlowRefreshById.get(key);
    namingState.validation.dirtyDetailFlowRefreshById.set(key, Boolean(current) || Boolean(forceRefresh));
  }

  async function hydrateGotoExecuteNodeDetailsForFlow(flowId, forceRefresh) {
    const chart = namingState.chartCache.get(String(flowId));
    if (!chart || !chart.nodesById || chart.nodesById.size === 0) return;
    namingState.validation.hydrationInFlight += 1;
    const nodeIds = [];
    for (const node of chart.nodesById.values()) {
      if (!node || typeof node !== "object") continue;
      if (node.type === "goTo" || node.type === "executeFlow") {
        const id = node._id || node.id;
        if (id) nodeIds.push(String(id));
      }
    }
    if (!nodeIds.length) {
      namingState.validation.hydrationInFlight = Math.max(0, namingState.validation.hydrationInFlight - 1);
      return;
    }
    try {
      await Promise.all(
        nodeIds.map(async (nodeId) => {
          try {
            await getNodeDetails(flowId, nodeId, !!forceRefresh);
          } catch (_) {}
        })
      );
    } finally {
      namingState.validation.hydrationInFlight = Math.max(0, namingState.validation.hydrationInFlight - 1);
    }
  }

  async function processDirtyFlowLoadsAndDetails() {
    const dirtyChartLoadIds = Array.from(namingState.validation.dirtyChartLoadFlowIds.values());
    namingState.validation.dirtyChartLoadFlowIds.clear();
    if (dirtyChartLoadIds.length > 0) {
      await Promise.all(
        dirtyChartLoadIds.map(async (flowId) => {
          try {
            const chart = await ensureChartForFlow(flowId);
            if (chart) {
              markFlowDirtyForDetails(flowId, false);
            }
          } catch (_) {}
        })
      );
    }

    const dirtyDetailEntries = Array.from(namingState.validation.dirtyDetailFlowRefreshById.entries());
    namingState.validation.dirtyDetailFlowRefreshById.clear();
    if (dirtyDetailEntries.length > 0) {
      await Promise.all(
        dirtyDetailEntries.map(async ([flowId, forceRefresh]) => {
          try {
            await hydrateGotoExecuteNodeDetailsForFlow(flowId, forceRefresh);
          } catch (_) {}
        })
      );
    }
  }

  function getNodeId(node) {
    if (!node || typeof node !== "object") return "";
    const raw = node._id || node.id;
    return raw ? String(raw) : "";
  }

  function getNodeNextId(node) {
    if (!node || typeof node !== "object") return "";
    const raw = node.next_node_id || node.nextNodeId || node.nextNode || node.next;
    return raw ? String(raw) : "";
  }

  function getNodeChildIds(node) {
    if (!node || typeof node !== "object") return [];
    const raw = node.child_node_ids || node.childNodeIds || node.children || node.childNodes || [];
    return Array.isArray(raw) ? raw.map((id) => String(id)).filter(Boolean) : [];
  }

  function isNodeDisabled(node) {
    if (!node || typeof node !== "object") return false;
    return Boolean(node.isDisabled || node.is_disabled);
  }

  function getRelationParentId(relation) {
    if (!relation || typeof relation !== "object") return "";
    const raw = relation.node || relation.parent || relation.source || relation.from || relation.nodeId;
    return raw ? String(raw) : "";
  }

  function getRelationChildIds(relation) {
    if (!relation || typeof relation !== "object") return [];
    const children = relation.children || relation.targets || relation.to || relation.childNodes;
    if (Array.isArray(children)) return children.map((id) => String(id)).filter(Boolean);
    const single = relation.child || relation.target;
    return single ? [String(single)] : [];
  }

  function getRelationNextId(relation) {
    if (!relation || typeof relation !== "object") return "";
    const raw = relation.next || relation.nextNodeId || relation.next_node_id;
    return raw ? String(raw) : "";
  }

  function mergeChartCacheTopologyOntoNodes(chart) {
    if (!chart || !Array.isArray(chart.nodes)) return [];
    const nodes = chart.nodes.map(function (node) {
      return Object.assign({}, node);
    });
    const byId = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const nodeId = getNodeId(nodes[i]);
      if (nodeId) byId.set(nodeId, nodes[i]);
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nodeId = getNodeId(node);
      if (!nodeId) continue;
      const nextNodeId = getNodeNextId(node);
      if (nextNodeId) {
        node.next_node_id = nextNodeId;
        node.nextNodeId = nextNodeId;
      }
      const childIds = getNodeChildIds(node);
      if (childIds.length) {
        node.child_node_ids = childIds.slice();
        node.childNodeIds = childIds.slice();
      }
    }
    for (const relation of chart.relations || []) {
      const parentId = getRelationParentId(relation);
      if (!parentId) continue;
      const node = byId.get(parentId);
      if (!node) continue;
      const nextId = getRelationNextId(relation);
      if (nextId) {
        node.next_node_id = nextId;
        node.nextNodeId = nextId;
      }
      const children = getRelationChildIds(relation);
      if (children.length) {
        node.child_node_ids = children.slice();
        node.childNodeIds = children.slice();
      }
    }
    return nodes;
  }

  function buildStructuredJsonFromNamingChartCache(flowId, options) {
    const chart = namingState.chartCache.get(String(flowId || ""));
    if (!chart || !chart.nodes || !chart.nodes.length) return null;
    const map = ensureProjectMap();
    if (!map) return null;
    const nodes = mergeChartCacheTopologyOntoNodes(chart);
    try {
      return map.flowToStructuredJson(
        {
          _id: String(flowId),
          id: String(flowId),
          nodes: nodes,
        },
        Object.assign({}, options || {}, {
          silenceUnknownNodeTypeWarnings: true,
          allowUnreachableNodes: true,
        })
      );
    } catch (e) {
      console.warn(NAMING_LOG_PREFIX, "buildStructuredJsonFromNamingChartCache failed", flowId, e);
      return null;
    }
  }

  function toNodeIdSet(values) {
    const out = new Set();
    for (const value of values || []) {
      if (!value) continue;
      out.add(String(value));
    }
    return out;
  }

  function buildFlowAdjacencyGraph(chart) {
    const adjacency = new Map();
    const indegree = new Map();
    if (!chart || !chart.nodesById) {
      return { adjacency, indegree };
    }

    function ensureNode(nodeId) {
      if (!adjacency.has(nodeId)) adjacency.set(nodeId, new Set());
      if (!indegree.has(nodeId)) indegree.set(nodeId, 0);
    }

    function addEdge(fromId, toId) {
      if (!fromId || !toId) return;
      const fromKey = String(fromId);
      const toKey = String(toId);
      ensureNode(fromKey);
      ensureNode(toKey);
      const targets = adjacency.get(fromKey);
      if (targets.has(toKey)) return;
      targets.add(toKey);
      indegree.set(toKey, (indegree.get(toKey) || 0) + 1);
    }

    for (const node of chart.nodesById.values()) {
      const nodeId = getNodeId(node);
      if (!nodeId) continue;
      ensureNode(nodeId);

      const nextNodeId = getNodeNextId(node);
      if (nextNodeId) addEdge(nodeId, nextNodeId);

      const children = getNodeChildIds(node);
      for (const childId of children) {
        if (!childId) continue;
        addEdge(nodeId, String(childId));
      }
    }

    // Fallback: relation edges can preserve branch heads for summary nodes.
    for (const relation of chart.relations || []) {
      const parentId = getRelationParentId(relation);
      if (!parentId) continue;
      const nextId = getRelationNextId(relation);
      if (nextId) {
        addEdge(parentId, nextId);
      }
      const children = getRelationChildIds(relation);
      for (const childId of children) {
        if (!childId) continue;
        addEdge(parentId, String(childId));
      }
    }

    return { adjacency, indegree };
  }

  function findFlowStartNodeIds(chart, indegree) {
    const starts = [];
    if (!chart || !chart.nodesById) return starts;

    for (const node of chart.nodesById.values()) {
      if (!node || node.type !== "start") continue;
      const nodeId = getNodeId(node);
      if (!nodeId) continue;
      starts.push(nodeId);
    }
    if (starts.length > 0) return starts;

    const roots = [];
    for (const node of chart.nodesById.values()) {
      const nodeId = getNodeId(node);
      if (!nodeId) continue;
      if ((indegree.get(nodeId) || 0) === 0) {
        roots.push(nodeId);
      }
    }
    return roots;
  }

  function collectReachableNodes(adjacency, startIds, terminalIds) {
    const reachable = new Set();
    const stack = Array.from(startIds || []);
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId || reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      if (terminalIds && terminalIds.has(nodeId)) continue;
      const next = adjacency.get(nodeId);
      if (!next) continue;
      for (const targetId of next.values()) {
        if (!reachable.has(targetId)) {
          stack.push(targetId);
        }
      }
    }
    return reachable;
  }

  function getDeadPathNodeIdsForCurrentFlow(currentFlowId) {
    if (!currentFlowId) return [];
    const chart = namingState.chartCache.get(String(currentFlowId));
    if (!chart || !chart.nodesById || chart.nodesById.size === 0) return [];

    const terminalNodeIds = new Set();
    const guardedNodeIds = new Set();
    for (const node of chart.nodesById.values()) {
      const nodeId = getNodeId(node);
      if (!nodeId) continue;
      const nodeType = String(node.type || "");
      const isActiveTerminator =
        !isNodeDisabled(node) &&
        (nodeType === "goTo" ||
          nodeType === "aiAgentToolAnswer" ||
          nodeType === "stop" ||
          nodeType === "stopAndReturn");
      if (isActiveTerminator) {
        terminalNodeIds.add(nodeId);
      }
      if (nodeType === "start" || nodeType === "end") {
        guardedNodeIds.add(nodeId);
      }
    }

    const graph = buildFlowAdjacencyGraph(chart);
    const startNodeIds = findFlowStartNodeIds(chart, graph.indegree);
    if (startNodeIds.length === 0) return [];

    const baselineReachable = collectReachableNodes(graph.adjacency, startNodeIds, null);
    const effectiveReachable = collectReachableNodes(graph.adjacency, startNodeIds, terminalNodeIds);

    const deadPathNodeIds = [];
    for (const nodeId of baselineReachable.values()) {
      if (effectiveReachable.has(nodeId)) continue;
      if (guardedNodeIds.has(nodeId)) continue;
      deadPathNodeIds.push(nodeId);
    }
    deadPathNodeIds.sort();
    return deadPathNodeIds;
  }

  function validateGotoExecuteNodes() {
    const errors = [];
    const sameFlowEdges = [];
    const incomingExternalTargets = {};
    const currentFlowId = getCurrentFlowIdFromLocation();
    for (const [flowId, chart] of namingState.chartCache.entries()) {
      if (!chart || !chart.nodesById) continue;
      for (const node of chart.nodesById.values()) {
        if (!node || (node.type !== "goTo" && node.type !== "executeFlow")) continue;
        const flowNode = node.config && node.config.flowNode ? node.config.flowNode : {};
        const targetFlowRef = flowNode.flow ? String(flowNode.flow) : "";
        const targetNodeRef = flowNode.node ? String(flowNode.node) : "";
        const targetFlow = targetFlowRef ? namingState.flowsCache.byRefId.get(targetFlowRef) : null;

        if (!targetFlow) {
          const flowMeta = namingState.flowsCache.byId.get(String(flowId));
          errors.push({
            type: "gotoExecute",
            severity: 3,
            flowId: String(flowId),
            nodeId: String(node._id || node.id || ""),
            flowName: flowMeta && flowMeta.name ? String(flowMeta.name) : String(flowId),
            nodeName: String(node.label || node._id || node.id || "unknown"),
            message:
              String(node.type) +
              " node '" +
              String(node.label || node._id || "unknown") +
              "' references missing target flow.",
            url: buildNodeLink(flowId, node._id || node.id || ""),
          });
          continue;
        }

        const targetFlowId = String(targetFlow._id || targetFlow.id || "");
        const targetChart = namingState.chartCache.get(targetFlowId);
        const targetNode = targetChart && targetNodeRef ? targetChart.nodesByRefId.get(targetNodeRef) : null;
        if (!targetNode) {
          const flowMeta = namingState.flowsCache.byId.get(String(flowId));
          errors.push({
            type: "gotoExecute",
            severity: 3,
            flowId: String(flowId),
            nodeId: String(node._id || node.id || ""),
            flowName: flowMeta && flowMeta.name ? String(flowMeta.name) : String(flowId),
            nodeName: String(node.label || node._id || node.id || "unknown"),
            message:
              String(node.type) +
              " node '" +
              String(node.label || node._id || "unknown") +
              "' references missing target node in flow '" +
              String(targetFlow.name || targetFlowId) +
              "'.",
            url: buildNodeLink(flowId, node._id || node.id || ""),
          });
          continue;
        }

        const sourceNodeId = String(node._id || node.id || "");
        const targetNodeId = String(targetNode._id || targetNode.id || "");
        if (!sourceNodeId || !targetNodeId) continue;

        if (String(flowId) === String(currentFlowId) && String(targetFlowId) === String(currentFlowId)) {
          sameFlowEdges.push({
            sourceNodeId,
            targetNodeId,
            nodeType: String(node.type || ""),
          });
        } else if (
          String(flowId) !== String(currentFlowId) &&
          String(targetFlowId) === String(currentFlowId)
        ) {
          if (!incomingExternalTargets[targetNodeId]) {
            incomingExternalTargets[targetNodeId] = [];
          }
          incomingExternalTargets[targetNodeId].push({
            sourceFlowId: String(flowId),
            sourceNodeId,
            nodeType: String(node.type || ""),
            sourceLabel: String(node.label || node._id || sourceNodeId),
          });
        }
      }

      const deadPathNodeIdsForFlow = getDeadPathNodeIdsForCurrentFlow(flowId);
      if (deadPathNodeIdsForFlow.length > 0) {
        const flowMeta = namingState.flowsCache.byId.get(String(flowId));
        const focusNodeId = deadPathNodeIdsForFlow[0];
        const focusNode = chart.nodesById.get(String(focusNodeId));
        errors.push({
          type: "deadPath",
          severity: 2,
          flowId: String(flowId),
          nodeId: String(focusNodeId || ""),
          flowName: flowMeta && flowMeta.name ? String(flowMeta.name) : String(flowId),
          nodeName:
            deadPathNodeIdsForFlow.length === 1
              ? String((focusNode && (focusNode.label || focusNode._id || focusNode.id)) || focusNodeId)
              : String(deadPathNodeIdsForFlow.length) + " nodes",
          message:
            "Flow contains " +
            String(deadPathNodeIdsForFlow.length) +
            " dead path node(s) after terminating nodes.",
          url: buildNodeLink(flowId, focusNodeId || ""),
          deadPathNodeIds: deadPathNodeIdsForFlow,
        });
      }
    }
    const deadPathNodeIds = getDeadPathNodeIdsForCurrentFlow(currentFlowId);
    return { errors, sameFlowEdges, incomingExternalTargets, deadPathNodeIds };
  }

  async function runCrossFlowValidation() {
    const state = namingState.validation;
    if (state.runInFlight) {
      state.rerunRequested = true;
      return;
    }
    state.runInFlight = true;
    if (!state.analysisCompletedOnce && state.ui) {
      markInitialAnalysisPending();
      try {
        renderValidationWidget();
      } catch (_) {}
    }
    try {
      await processDirtyFlowLoadsAndDetails();
      const validationResult = validateGotoExecuteNodes();
      state.errors = validationResult.errors;
      state.sameFlowEdges = validationResult.sameFlowEdges;
      state.incomingExternalTargets = validationResult.incomingExternalTargets;
      state.deadPathNodeIds = validationResult.deadPathNodeIds;
      if (state.deadPathNodeIds.length > 0) {
        console.log(NAMING_LOG_PREFIX, "dead paths detected in current flow:", state.deadPathNodeIds.length);
      }
      console.log(NAMING_LOG_PREFIX, "validation completed, errors:", state.errors.length);
    } catch (error) {
      console.warn(NAMING_LOG_PREFIX, "validation run failed", error);
    } finally {
      state.runInFlight = false;
      if (!ensureInitialAnalysisGate().validationCompleted) {
        ensureInitialAnalysisGate().validationCompleted = true;
      }
      tryFinishInitialAnalysis();
      try {
        renderValidationWidget();
        renderChartValidationVisuals();
      } catch (e2) {
        console.warn(NAMING_LOG_PREFIX, "post-validation render failed", e2);
      }
      if (state.rerunRequested) {
        state.rerunRequested = false;
        scheduleCrossFlowValidation("rerun-requested", { immediate: true, forceDuringHydration: true });
      }
    }
  }

  function scheduleCrossFlowValidation(reason, options) {
    const state = namingState.validation;
    const opts = options || {};
    state.currentFlowId = getCurrentFlowIdFromLocation();
    state.projectId = state.projectId || getProjectIdFromLocation();
    if (!state.flowsLoaded || !state.currentFlowChartLoaded) {
      namingLogDebug("validation deferred, prerequisites missing", {
        reason,
        flowsLoaded: state.flowsLoaded,
        currentFlowChartLoaded: state.currentFlowChartLoaded,
      });
      return;
    }
    if (state.hydrationInFlight > 0 && !opts.forceDuringHydration) {
      namingLogDebug("validation deferred, hydration in flight", {
        reason,
        hydrationInFlight: state.hydrationInFlight,
      });
      state.rerunRequested = true;
      return;
    }
    if (state.runInFlight) {
      state.rerunRequested = true;
      return;
    }
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
    if (opts.immediate) {
      runCrossFlowValidation();
      return;
    }
    state.pendingTimer = setTimeout(function () {
      state.pendingTimer = null;
      runCrossFlowValidation();
    }, 220);
  }

  function updateFlowsCacheFromItems(items) {
    const previousFlowIds = new Set(namingState.flowsCache.byId.keys());
    namingState.flowsCache.byId.clear();
    namingState.flowsCache.byRefId.clear();
    for (const flow of items || []) {
      if (!flow || typeof flow !== "object") continue;
      const id = flow._id || flow.id;
      const ref = flow.referenceId || flow.reference_id;
      if (id) namingState.flowsCache.byId.set(String(id), flow);
      if (ref) namingState.flowsCache.byRefId.set(String(ref), flow);
    }
    const nextFlowIds = new Set(namingState.flowsCache.byId.keys());
    const newFlowIds = [];
    for (const flowId of nextFlowIds) {
      if (!previousFlowIds.has(flowId)) {
        newFlowIds.push(flowId);
      }
    }
    for (const oldFlowId of previousFlowIds) {
      if (!nextFlowIds.has(oldFlowId)) {
        namingState.chartCache.delete(String(oldFlowId));
      }
    }
    namingState.knownFlowIds = nextFlowIds;
    namingLogDebug("flows cache rebuilt", {
      countById: namingState.flowsCache.byId.size,
      countByRefId: namingState.flowsCache.byRefId.size,
      newFlowCount: newFlowIds.length,
    });
    namingState.validation.flowsLoaded = namingState.flowsCache.byId.size > 0;
    if (!namingState.validation.analysisCompletedOnce) {
      markInitialAnalysisPending();
      scheduleNamingConventionScan("flows-cache");
    }
    if (!namingState.validation.baselinePrepared && namingState.flowsCache.byId.size > 0) {
      namingState.validation.baselinePrepared = true;
      for (const flowId of namingState.flowsCache.byId.keys()) {
        if (!namingState.chartCache.has(String(flowId))) {
          markFlowDirtyForChartLoad(flowId);
        }
      }
    } else if (newFlowIds.length > 0) {
      for (const flowId of newFlowIds) {
        markFlowDirtyForChartLoad(flowId);
      }
    }
    scheduleCrossFlowValidation("flows-cache");
    // Mirror into the project-map so it can drive the validation UI.
    try {
      const map = ensureProjectMap();
      if (map) map.handleFlowsListResponse(items || []);
    } catch (e) {
      namingLogDebug("project-map handleFlowsListResponse failed", { error: String(e) });
    }
  }

  function buildChartEntry(chartData) {
    const entry = {
      nodes: Array.isArray(chartData?.nodes) ? chartData.nodes : [],
      relations: Array.isArray(chartData?.relations)
        ? chartData.relations
        : Array.isArray(chartData?.edges)
          ? chartData.edges
          : [],
      nodesById: new Map(),
      nodesByRefId: new Map(),
      parentByChildId: new Map(),
    };
    for (const node of entry.nodes) {
      if (!node || typeof node !== "object") continue;
      const id = node._id || node.id;
      const ref = node.referenceId || node.reference_id;
      if (id) entry.nodesById.set(String(id), node);
      if (ref) entry.nodesByRefId.set(String(ref), node);
    }
    for (const relation of entry.relations) {
      const parent = getRelationParentId(relation);
      if (!parent) continue;
      const children = getRelationChildIds(relation);
      for (const child of children) {
        if (child) entry.parentByChildId.set(String(child), parent);
      }
    }
    return entry;
  }

  function rebuildParentLinks(chart) {
    if (!chart) return;
    chart.parentByChildId = new Map();
    for (const relation of chart.relations || []) {
      const parent = getRelationParentId(relation);
      if (!parent) continue;
      const children = getRelationChildIds(relation);
      for (const child of children) {
        if (child) chart.parentByChildId.set(String(child), parent);
      }
    }
  }

  function removeNodeFromChartCache(flowId, nodeId, options) {
    if (!flowId || !nodeId) return;
    const opts = options || {};
    const flowKey = String(flowId);
    const nodeKey = String(nodeId);
    const chart = namingState.chartCache.get(flowKey);
    if (!chart) return;

    const existing = chart.nodesById.get(nodeKey) || null;
    const existingRef =
      existing && (existing.referenceId || existing.reference_id)
        ? String(existing.referenceId || existing.reference_id)
        : "";

    chart.nodesById.delete(nodeKey);
    if (existingRef) {
      chart.nodesByRefId.delete(existingRef);
    }
    chart.nodes = (chart.nodes || []).filter((n) => getNodeId(n) !== nodeKey);

    chart.relations = (chart.relations || [])
      .filter((rel) => getRelationParentId(rel) !== nodeKey)
      .map((rel) => {
        const children = getRelationChildIds(rel).filter((cid) => cid !== nodeKey);
        const nextId = getRelationNextId(rel);
        const next = nextId === nodeKey ? null : nextId;
        const updated = Object.assign({}, rel);
        if ("children" in updated || Array.isArray(updated.children)) {
          updated.children = children;
        } else if ("childNodes" in updated) {
          updated.childNodes = children;
        }
        if ("next" in updated || "nextNodeId" in updated || "next_node_id" in updated) {
          if ("next" in updated) updated.next = next;
          if ("nextNodeId" in updated) updated.nextNodeId = next;
          if ("next_node_id" in updated) updated.next_node_id = next;
        }
        return updated;
      });

    rebuildParentLinks(chart);

    for (const key of Array.from(namingState.nodeDetailsCache.keys())) {
      if (key === flowKey + ":" + nodeKey) {
        namingState.nodeDetailsCache.delete(key);
      }
    }

    namingLogDebug("node removed from chart cache", {
      flowId: flowKey,
      nodeId: nodeKey,
      hadNode: !!existing,
    });

    if (!opts.skipValidation) {
      markFlowDirtyForDetails(flowKey, true);
      scheduleCrossFlowValidation("node-delete");
    }
    // Mirror into project-map. The map's handler internally triggers a
    // forced reloadFlow so topology (next/children pointers on siblings)
    // gets resynced from the API.
    try {
      const map = ensureProjectMap();
      if (map) map.handleNodeDeletedFromIntercept(flowKey, nodeKey);
    } catch (e) {
      namingLogDebug("project-map handleNodeDeletedFromIntercept failed", { error: String(e) });
    }
  }

  function setChartCache(flowId, chartData) {
    if (!flowId) return;
    namingState.chartCache.set(String(flowId), buildChartEntry(chartData || {}));
    const entry = namingState.chartCache.get(String(flowId));
    namingLogDebug("chart cache replaced", {
      flowId: String(flowId),
      nodeCount: entry ? entry.nodesById.size : 0,
      relationCount: entry ? entry.relations.length : 0,
      parentLinks: entry ? entry.parentByChildId.size : 0,
    });
    const currentFlowId = getCurrentFlowIdFromLocation();
    if (currentFlowId && String(flowId) === String(currentFlowId)) {
      namingState.validation.currentFlowChartLoaded = true;
      tryFinishInitialAnalysis();
    }
    markFlowDirtyForDetails(flowId, true);
    scheduleCrossFlowValidation("chart-cache");
    try {
      const map = ensureProjectMap();
      if (map) map.handleChartResponse(String(flowId), chartData || {});
    } catch (e) {
      namingLogDebug("project-map handleChartResponse failed", { error: String(e) });
    }
    try {
      const tabs = CCP.flowCode && CCP.flowCode.tabs;
      const boot = CCP.flowCode && CCP.flowCode.bootstrap;
      if (
        tabs &&
        typeof tabs.getCurrentModeFromLocation === "function" &&
        tabs.getCurrentModeFromLocation() === "code" &&
        currentFlowId &&
        String(flowId) === String(currentFlowId) &&
        boot &&
        typeof boot.scheduleRetry === "function"
      ) {
        boot.scheduleRetry();
      }
    } catch (_) {}
  }

  function upsertNodeInChartCache(flowId, node, options) {
    if (!flowId || !node || typeof node !== "object") return;
    const opts = options || {};
    const key = String(flowId);
    if (!namingState.chartCache.has(key)) {
      setChartCache(key, { nodes: [], relations: [] });
    }
    const chart = namingState.chartCache.get(key);
    const id = node._id || node.id;
    const ref = node.referenceId || node.reference_id;
    if (!id) return;
    chart.nodesById.set(String(id), node);
    if (ref) chart.nodesByRefId.set(String(ref), node);
    const listIdx = chart.nodes.findIndex((n) => String(n._id || n.id) === String(id));
    if (listIdx >= 0) chart.nodes[listIdx] = node;
    else chart.nodes.push(node);
    namingLogDebug("node upserted into chart cache", {
      flowId: key,
      nodeId: String(id),
      nodeRefId: ref ? String(ref) : null,
      nodeType: node.type || null,
      nodeLabel: node.label || null,
      existed: listIdx >= 0,
    });
    if ((node.type === "goTo" || node.type === "executeFlow") && !opts.skipDetailRefreshMark) {
      markFlowDirtyForDetails(flowId, false);
    }
    if (!opts.skipValidation) {
      scheduleCrossFlowValidation("node-upsert");
    }
    // Mirror into project-map (handles both create + patch — the only
    // signal we have here is "node was created/updated by the UI", which
    // maps to `handleNodePatchedFromIntercept` semantics).
    try {
      const map = ensureProjectMap();
      if (map) map.handleNodePatchedFromIntercept(key, node);
    } catch (e) {
      namingLogDebug("project-map handleNodePatchedFromIntercept failed", { error: String(e) });
    }
  }

  async function fetchJsonWithAuth(url) {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (namingState.bearerToken) {
      headers.set("Authorization", namingState.bearerToken);
    }
    namingLogDebug("internal authenticated GET start", {
      url,
      hasBearerToken: !!namingState.bearerToken,
    });
    const fetchImpl = namingState.rawFetch || window.fetch.bind(window);
    const res = await fetchImpl(url, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      namingLogDebug("internal authenticated GET failed", { url, status: res.status });
      throw new Error("fetchJsonWithAuth failed with status " + res.status);
    }
    namingLogDebug("internal authenticated GET success", { url, status: res.status });
    return res.json();
  }

  /**
   * PATCH via the patched window.fetch (same path as Cognigy UI requests).
   * Avoids rawFetch + custom marker + credentials:include, which can fail CORS
   * on split-origin deployments (e.g. live.* → api.*).
   */
  async function patchJsonWithAuth(url, body) {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    if (namingState.bearerToken) {
      headers.set("Authorization", namingState.bearerToken);
    }
    namingLogDebug("patchJsonWithAuth start", {
      url,
      patchKeys: body && typeof body === "object" ? Object.keys(body) : [],
    });
    const res = await window.fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      namingLogDebug("patchJsonWithAuth failed", { url, status: res.status });
      throw new Error("patchJsonWithAuth failed with status " + res.status);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text || !text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  async function ensureChartForFlow(flowId) {
    if (!flowId) return null;
    const flowKey = String(flowId);
    if (namingState.chartCache.has(flowKey)) {
      namingLogDebug("ensureChartForFlow cache hit", { flowId: flowKey });
      return namingState.chartCache.get(flowKey);
    }
    if (!namingState.baseUrl) {
      namingLogDebug("ensureChartForFlow cache miss but no baseUrl yet", { flowId: flowKey });
      return null;
    }
    namingLogDebug("ensureChartForFlow cache miss, fetching chart", { flowId: flowKey });
    try {
      const chartUrl = namingState.baseUrl + API_VERSION_SEGMENT + "/flows/" + flowKey + "/chart";
      const chartData = await fetchJsonWithAuth(chartUrl);
      setChartCache(flowKey, chartData);
      return namingState.chartCache.get(flowKey);
    } catch (e) {
      console.warn(NAMING_LOG_PREFIX, "ensureChartForFlow failed", flowKey, e);
      return null;
    }
  }

  async function refreshChartForFlow(flowId, reason) {
    if (!flowId) return null;
    const flowKey = String(flowId);
    if (!namingState.baseUrl) return null;
    try {
      const chartUrl = namingState.baseUrl + API_VERSION_SEGMENT + "/flows/" + flowKey + "/chart";
      const chartData = await fetchJsonWithAuth(chartUrl);
      setChartCache(flowKey, chartData);
      namingLogDebug("chart refreshed", { flowId: flowKey, reason: reason || "unknown" });
      return namingState.chartCache.get(flowKey);
    } catch (error) {
      console.warn(NAMING_LOG_PREFIX, "chart refresh failed", flowKey, reason || "", error);
      return null;
    }
  }

  function getFlowById(flowId) {
    if (!flowId) return null;
    return namingState.flowsCache.byId.get(String(flowId)) || null;
  }

  function getFlowByRefId(flowRefId) {
    if (!flowRefId) return null;
    return namingState.flowsCache.byRefId.get(String(flowRefId)) || null;
  }

  async function getNodeDetails(flowId, nodeId, forceRefresh) {
    if (!flowId || !nodeId || !namingState.baseUrl) return null;
    const key = String(flowId) + ":" + String(nodeId);
    if (!forceRefresh && namingState.nodeDetailsCache.has(key)) {
      namingLogDebug("node details cache hit", { key });
      return namingState.nodeDetailsCache.get(key);
    }
    namingLogDebug("node details cache miss, fetching", { key });
    try {
      const url =
        namingState.baseUrl +
        API_VERSION_SEGMENT +
        "/flows/" +
        String(flowId) +
        "/chart/nodes/" +
        String(nodeId);
      const details = await fetchJsonWithAuth(url);
      namingState.nodeDetailsCache.set(key, details);
      upsertNodeInChartCache(flowId, details, { skipValidation: true, skipDetailRefreshMark: true });
      return details;
    } catch (e) {
      console.warn(NAMING_LOG_PREFIX, "getNodeDetails failed", flowId, nodeId, e);
      return null;
    }
  }

  async function resolveNodeSummaryByRefId(flowId, nodeRefId) {
    if (!flowId || !nodeRefId) return null;
    const chart = await ensureChartForFlow(flowId);
    if (!chart) return null;
    const result = chart.nodesByRefId.get(String(nodeRefId)) || null;
    namingLogDebug("resolveNodeSummaryByRefId result", {
      flowId: String(flowId),
      nodeRefId: String(nodeRefId),
      found: !!result,
      type: result ? result.type || null : null,
      label: result ? result.label || null : null,
    });
    return result;
  }

  function getAutofixApi() {
    const namingMod = CCP.naming;
    return namingMod && namingMod.issueAutofix ? namingMod.issueAutofix : null;
  }

  function getNamingIssuesApi() {
    const namingMod = CCP.naming;
    return namingMod && typeof namingMod.scanNamingConventionIssues === "function" ? namingMod : null;
  }

  function getFlowsForNamingScan() {
    const map = namingState.map;
    let flows = [];
    if (map && Array.isArray(map.flows) && map.flows.length) {
      flows = map.flows.slice();
    } else {
      for (const flow of namingState.flowsCache.byId.values()) {
        if (flow && typeof flow === "object") flows.push(flow);
      }
    }
    return flows.map(function (flow) {
      const flowId = flow && (flow.id || flow._id) ? String(flow.id || flow._id) : "";
      if (!flowId) return flow;
      if (Array.isArray(flow.nodes) && flow.nodes.length > 0) return flow;
      const chart = namingState.chartCache.get(flowId);
      if (chart && chart.nodesById && chart.nodesById.size > 0) {
        return Object.assign({}, flow, { nodes: Array.from(chart.nodesById.values()) });
      }
      return flow;
    });
  }

  function scheduleNamingConventionScan(reason) {
    const state = namingState.validation;
    if (state.namingScanTimer) {
      clearTimeout(state.namingScanTimer);
      state.namingScanTimer = null;
    }
    state.namingScanTimer = setTimeout(function () {
      state.namingScanTimer = null;
      void runNamingConventionScan(reason || "scheduled");
    }, 300);
  }

  function nodeIdFromIssueNode(node) {
    if (!node || typeof node !== "object") return "";
    return String(node.id || node._id || "");
  }

  function removeNamingConventionIssuesForNode(flowId, nodeId) {
    const fid = String(flowId || "");
    const nid = String(nodeId || "");
    if (!fid || !nid) return;
    const list = namingState.validation.namingConventionIssues || [];
    namingState.validation.namingConventionIssues = list.filter(function (issue) {
      if (!issue) return false;
      const issueNode = issue.node || null;
      if (!issueNode) return true;
      const issueFlow = issue.flow ? String(issue.flow.id || issue.flow._id || "") : "";
      const issueNodeId = nodeIdFromIssueNode(issueNode);
      return !(issueFlow === fid && issueNodeId === nid);
    });
  }

  /**
   * Refresh integrity panel + Cognigy canvas after a naming autofix without
   * map.reloadFlow() or waiting for the intercepted /chart GET.
   */
  function refreshUiAfterNamingAutofix(flowId, nodeId) {
    const fid = String(flowId || "");
    const nid = String(nodeId || "");
    if (!fid || !nid) return;

    removeNamingConventionIssuesForNode(fid, nid);
    namingState.nodeDetailsCache.delete(fid + ":" + nid);

    try {
      renderValidationWidget();
      renderChartValidationVisuals();
    } catch (_) {}

    if (String(getCurrentFlowIdFromLocation() || "") === fid) {
      void runCognigyFlowNodeVisualRefresh({ flowId: fid, nodeId: nid }).then(function (result) {
        if (result && result.ok) {
          try {
            queueChartVisualRefresh();
            renderChartValidationVisuals();
          } catch (_) {}
        }
      });
    }

    scheduleNamingConventionScan("after-autofix");
  }

  async function runNamingConventionScan(reason) {
    const state = namingState.validation;
    if (state.namingScanInFlight) return;
    const engine = ensureNamingEngine();
    const scanApi = getNamingIssuesApi();
    const gate = ensureInitialAnalysisGate();
    const isInitialScan = !gate.namingScanCompleted;

    if (!engine || !scanApi) {
      if (isInitialScan) {
        gate.namingScanCompleted = true;
        tryFinishInitialAnalysis();
      }
      return;
    }

    state.namingScanInFlight = true;
    try {
      if (isInitialScan) {
        await processDirtyFlowLoadsAndDetails();
      }
      const flows = getFlowsForNamingScan();
      for (let i = 0; i < flows.length; i++) {
        const flow = flows[i];
        const flowId = flow && (flow.id || flow._id) ? String(flow.id || flow._id) : "";
        if (flowId) {
          try {
            await hydrateGotoExecuteNodeDetailsForFlow(flowId, false);
          } catch (_) {}
        }
      }
      const issues = await scanApi.scanNamingConventionIssues({
        flows: flows,
        engine: engine,
        getNodeDetails: getNodeDetails,
      });
      state.namingConventionIssues = Array.isArray(issues) ? issues : [];
      namingLogDebug("naming convention scan completed", {
        reason: reason || "",
        count: state.namingConventionIssues.length,
      });
    } catch (e) {
      console.warn(NAMING_LOG_PREFIX, "naming convention scan failed", e);
    } finally {
      state.namingScanInFlight = false;
      if (isInitialScan) {
        gate.namingScanCompleted = true;
        if (!gate.validationCompleted) {
          scheduleCrossFlowValidation("post-initial-naming-scan", {
            immediate: true,
            forceDuringHydration: true,
          });
        }
        tryFinishInitialAnalysis();
      }
      try {
        renderValidationWidget();
      } catch (_) {}
    }
  }

  function getAutofixContext() {
    const map = namingState.map;
    const pmRoot = (window.__CCP__ && window.__CCP__.projectMap) || null;
    let apiClient = null;
    if (map && pmRoot && typeof pmRoot.createApiClient === "function") {
      apiClient = pmRoot.createApiClient({
        getAuth: function () {
          return {
            baseUrl: namingState.baseUrl || "",
            bearerToken: namingState.bearerToken || "",
          };
        },
        rawFetch: namingState.rawFetch || window.fetch.bind(window),
        log: namingLogDebug,
      });
    }
    return {
      engine: ensureNamingEngine(),
      apiClient: apiClient,
      getNodeDetails: getNodeDetails,
      upsertNodeInChartCache: upsertNodeInChartCache,
      map: map,
      scheduleNamingRescan: function () {
        scheduleNamingConventionScan("after-fix");
      },
      renderValidationWidget: renderValidationWidget,
    };
  }

  async function ensureParentIfNamingFixed(flowId, nodeId, node, flowMeta) {
    if (!node || (node.type !== "then" && node.type !== "else")) return;
    const ctx = getAutofixContext();
    if (!ctx.engine) return;

    const chart = namingState.chartCache.get(String(flowId));
    const parentId = chart && chart.parentByChildId ? chart.parentByChildId.get(String(nodeId)) || "" : "";
    if (!parentId) return;

    const parentSummary = chart && chart.nodesById ? chart.nodesById.get(String(parentId)) : null;
    if (!parentSummary || parentSummary.type !== "if") return;

    let parentNode = parentSummary;
    if (ctx.getNodeDetails) {
      try {
        const details = await ctx.getNodeDetails(flowId, parentId, false);
        if (details && typeof details === "object") {
          parentNode = Object.assign({}, parentSummary, details);
        }
      } catch (_) {}
    }

    const evaluation = await ctx.engine.evaluateNodeNaming(parentNode, flowId, flowMeta, {
      nodeId: parentId,
    });
    if (!evaluation || !evaluation.fixable) return;

    await applyNamingConventionFix({
      flow: flowMeta,
      node: parentNode,
    });
  }

  async function applyNamingConventionFix(issue) {
    const ctx = getAutofixContext();
    if (!ctx.engine || !namingState.baseUrl || !namingState.bearerToken) {
      throw new Error("Auto-fix prerequisites missing");
    }
    const flow = issue.flow || null;
    const node = issue.node || null;
    const flowId = flow ? String(flow.id || flow._id || "") : String(issue.flowId || "");
    const nodeId = node ? String(node.id || node._id || "") : String(issue.nodeId || "");
    if (!flowId || !nodeId) {
      throw new Error("Missing flow or node id");
    }

    let fullNode = node;
    if (!fullNode || !fullNode.config) {
      const chart = namingState.chartCache.get(String(flowId));
      const cached = chart && chart.nodesById ? chart.nodesById.get(String(nodeId)) : null;
      if (cached) fullNode = Object.assign({}, cached, fullNode || {});
    }
    if (ctx.getNodeDetails) {
      const details = await ctx.getNodeDetails(flowId, nodeId, false);
      if (details && typeof details === "object") {
        fullNode = Object.assign({}, fullNode || {}, details);
      }
    }
    if (!fullNode) {
      throw new Error("Node not found");
    }

    await ensureParentIfNamingFixed(flowId, nodeId, fullNode, flow);

    const patch = await ctx.engine.buildNamingFixPatch(fullNode, flowId, { nodeId: nodeId });
    if (!patch || !Object.keys(patch).length) {
      throw new Error("No fix available for this node");
    }

    const url =
      namingState.baseUrl +
      API_VERSION_SEGMENT +
      "/flows/" +
      String(flowId) +
      "/chart/nodes/" +
      String(nodeId);
    const updated = await patchJsonWithAuth(url, patch);
    const nodeForMap = updated && typeof updated === "object" ? updated : Object.assign({}, fullNode, patch);
    if (ctx.map && typeof ctx.map.handleNodePatchedFromIntercept === "function") {
      try {
        ctx.map.handleNodePatchedFromIntercept(flowId, nodeForMap);
      } catch (_) {}
    }
    if (!updated && ctx.upsertNodeInChartCache) {
      ctx.upsertNodeInChartCache(flowId, nodeForMap, {
        skipValidation: true,
        skipDetailRefreshMark: true,
      });
    }

    refreshUiAfterNamingAutofix(flowId, nodeId);
  }

  function registerNamingConventionFixHandler() {
    const autofix = getAutofixApi();
    const namingMod = CCP.naming;
    if (!autofix || !namingMod) return;
    const issueType = namingMod.ISSUE_TYPE_NAMING_CONVENTION || "naming_convention_violation";
    autofix.registerFixHandler(issueType, {
      displayLabel: "Naming Convention",
      canFix: function (issue) {
        return issue && issue.fixable === true;
      },
      partitionForBatchFix: function (issues) {
        const ifIssues = [];
        const otherIssues = [];
        const list = Array.isArray(issues) ? issues : [];
        for (let i = 0; i < list.length; i++) {
          const issue = list[i];
          const nodeType = issue && issue.node ? String(issue.node.type || "") : "";
          if (nodeType === "if") {
            ifIssues.push(issue);
          } else {
            otherIssues.push(issue);
          }
        }
        if (!ifIssues.length) return [otherIssues];
        if (!otherIssues.length) return [ifIssues];
        return [ifIssues, otherIssues];
      },
      applyFix: applyNamingConventionFix,
    });
  }

  registerNamingConventionFixHandler();

  function mergePatchWithCache(cachedNode, patchBody) {
    const merged = Object.assign({}, cachedNode || {});
    const patch = patchBody || {};
    for (const key of Object.keys(patch)) {
      if (key === "config" && patch.config && typeof patch.config === "object") {
        const mergedConfig = Object.assign({}, merged.config || {});
        const patchConfig = patch.config || {};
        for (const cfgKey of Object.keys(patchConfig)) {
          mergedConfig[cfgKey] = patchConfig[cfgKey];
        }
        merged.config = mergedConfig;
      } else {
        merged[key] = patch[key];
      }
    }
    namingLogDebug("mergePatchWithCache completed", {
      patchKeys: Object.keys(patch || {}),
      mergedKeys: Object.keys(merged || {}),
      patchConfigKeys:
        patch && patch.config && typeof patch.config === "object" ? Object.keys(patch.config) : [],
      mergedConfigKeys:
        merged && merged.config && typeof merged.config === "object" ? Object.keys(merged.config) : [],
    });
    return merged;
  }

  async function handlePostNodeRequest(request, urlObj, bodyObj) {
    const flowId = extractFlowIdFromPath(urlObj.pathname);
    const nodeType = String(bodyObj.type || "");
    const extension = bodyObj.extension || "@cognigy/basic-nodes";
    const oldLabel = bodyObj.label || "";
    const context = {
      targetNodeId: bodyObj.target ? String(bodyObj.target) : "",
    };
    namingLogDebug("handlePostNodeRequest parsed request data", {
      method: request.method || "POST",
      url: urlObj.href,
      flowId,
      nodeType,
      extension,
      oldLabel,
      context,
      bodyShape: summarizeBodyShape(bodyObj),
    });
    const computed = await computeLabel(nodeType, extension, bodyObj.config || {}, flowId, oldLabel, context);
    if (computed.label != null) {
      const prevLabel = bodyObj.label;
      const prevAnalytics = bodyObj.analyticsLabel;
      bodyObj.label = computed.label;
      bodyObj.analyticsLabel = computed.analyticsLabel;
      console.log(NAMING_LOG_PREFIX, "POST relabel", nodeType, oldLabel, "=>", computed.label);
      logLabelMutation("POST", nodeType, prevLabel, bodyObj.label, prevAnalytics, bodyObj.analyticsLabel, {
        flowId,
      });
    } else if (bodyObj.label) {
      const prevAnalytics = bodyObj.analyticsLabel;
      bodyObj.analyticsLabel = analyticsLabelForNode(nodeType, bodyObj.label);
      logLabelMutation(
        "POST analytics-only",
        nodeType,
        bodyObj.label,
        bodyObj.label,
        prevAnalytics,
        bodyObj.analyticsLabel,
        {
          flowId,
        }
      );
    }
    return bodyObj;
  }

  async function handlePatchNodeRequest(urlObj, bodyObj) {
    const flowId = extractFlowIdFromPath(urlObj.pathname);
    const nodeId = extractNodeIdFromPatchPath(urlObj.pathname);
    const chart = namingState.chartCache.get(String(flowId));
    const cachedNode = chart ? chart.nodesById.get(String(nodeId)) : null;
    namingLogDebug("handlePatchNodeRequest parsed request data", {
      url: urlObj.href,
      flowId,
      nodeId,
      bodyShape: summarizeBodyShape(bodyObj),
      hasChartCache: !!chart,
      hasNodeCache: !!cachedNode,
    });
    if (!cachedNode) {
      console.warn(NAMING_LOG_PREFIX, "PATCH without cached node; forwarding", flowId, nodeId);
      if (bodyObj.label) {
        bodyObj.analyticsLabel = analyticsLabelForNode(String(bodyObj.type || ""), bodyObj.label);
      }
      return bodyObj;
    }

    const merged = mergePatchWithCache(cachedNode, bodyObj);
    const context = {
      nodeId: String(nodeId),
      targetNodeId: bodyObj && bodyObj.target ? String(bodyObj.target) : "",
    };
    const computed = await computeLabel(
      String(merged.type || ""),
      String(merged.extension || "@cognigy/basic-nodes"),
      merged.config || {},
      String(flowId),
      String(merged.label || ""),
      context
    );
    if (computed.label != null) {
      const prevLabel = bodyObj.label;
      const prevAnalytics = bodyObj.analyticsLabel;
      bodyObj.label = computed.label;
      bodyObj.analyticsLabel = computed.analyticsLabel;
      console.log(NAMING_LOG_PREFIX, "PATCH relabel", merged.type, merged.label, "=>", computed.label);
      logLabelMutation(
        "PATCH",
        merged.type,
        prevLabel,
        bodyObj.label,
        prevAnalytics,
        bodyObj.analyticsLabel,
        {
          flowId,
          nodeId,
        }
      );
    } else if (bodyObj.label) {
      const prevAnalytics = bodyObj.analyticsLabel;
      bodyObj.analyticsLabel = analyticsLabelForNode(String(merged.type || ""), bodyObj.label);
      logLabelMutation(
        "PATCH analytics-only",
        merged.type,
        bodyObj.label,
        bodyObj.label,
        prevAnalytics,
        bodyObj.analyticsLabel,
        {
          flowId,
          nodeId,
        }
      );
    }
    return bodyObj;
  }

  function attachOwnMarker(headersInput) {
    const headers = new Headers(headersInput || {});
    headers.set(OWN_FETCH_MARKER_HEADER, OWN_FETCH_MARKER_VALUE);
    return headers;
  }

  (function installFetchNamingInterceptor() {
    if (typeof window.fetch !== "function") {
      console.warn(NAMING_LOG_PREFIX, "window.fetch missing; naming interceptor not installed");
      return;
    }
    if (window.__cognigyCopilotFetchPatched) {
      if (!namingState.rawFetch && typeof window.__cognigyCopilotRawFetch === "function") {
        namingState.rawFetch = window.__cognigyCopilotRawFetch;
      }
      return;
    }
    const originalFetch = window.fetch.bind(window);
    window.__cognigyCopilotRawFetch = originalFetch;
    namingState.rawFetch = originalFetch;
    window.fetch = async function patchedFetch(input, init) {
      namingLogDebug("intercepted fetch call (raw input)", {
        inputType: typeof input,
        hasInit: !!init,
      });
      const req = new Request(input, init);
      const urlObj = parseUrl(req);
      if (!urlObj) {
        namingLogDebug("forwarding fetch unchanged: URL parse failed");
        return originalFetch(input, init);
      }
      if (getOwnMarker(req.headers) || getOwnMarker(init && init.headers)) {
        namingLogDebug("forwarding own marked request without interception", {
          method: req.method || "GET",
          url: urlObj.href,
        });
        return originalFetch(input, init);
      }

      const authHeader = extractAuthHeader(req, init);
      rememberApiContext(urlObj, authHeader);

      const method = String(req.method || "GET").toUpperCase();
      const isApiRoute = urlObj.pathname.startsWith(API_VERSION_SEGMENT + "/");
      namingLogDebug("route classification", {
        method,
        pathname: urlObj.pathname,
        isApiRoute,
        isFlowsListRoute: isFlowsListRoute(urlObj),
        isChartRoute: isChartRoute(urlObj),
        isCreateNodeRoute: isCreateNodeRoute(urlObj),
        isPatchNodeRoute: isPatchNodeRoute(urlObj),
        isDeleteNodeRoute: isDeleteNodeRoute(urlObj),
      });
      if (!isApiRoute) {
        namingLogDebug("forwarding non Cognigy API route", { method, url: urlObj.href });
        return originalFetch(input, init);
      }

      let forwardRequest = req;
      if (
        (method === "POST" && isCreateNodeRoute(urlObj)) ||
        (method === "PATCH" && isPatchNodeRoute(urlObj))
      ) {
        const raw = await req.clone().text();
        namingLogDebug("request body captured for rewrite", {
          method,
          url: urlObj.href,
          rawLength: raw.length,
          rawPreview: clipDebugValue(raw, 300),
        });
        const bodyObj = parseJsonSafe(raw);
        if (bodyObj && typeof bodyObj === "object") {
          try {
            if (method === "POST") {
              await handlePostNodeRequest(req, urlObj, bodyObj);
            } else {
              await handlePatchNodeRequest(urlObj, bodyObj);
            }
            const headers = attachOwnMarker(req.headers);
            headers.set("Content-Type", "application/json");
            namingLogDebug("rewritten request body", {
              method,
              url: urlObj.href,
              bodyShape: summarizeBodyShape(bodyObj),
              bodyPreview: clipDebugValue(JSON.stringify(bodyObj), 320),
            });
            forwardRequest = new Request(req, {
              method,
              headers,
              body: JSON.stringify(bodyObj),
            });
          } catch (e) {
            console.error(NAMING_LOG_PREFIX, "request rewrite failed; forwarding original", e);
            forwardRequest = req;
          }
        } else {
          namingLogDebug("request body not JSON object; rewrite skipped", {
            method,
            url: urlObj.href,
          });
        }
      }

      const res = await originalFetch(forwardRequest);
      namingLogDebug("response received", {
        method,
        url: urlObj.href,
        status: res.status,
        ok: res.ok,
      });
      try {
        if (method === "GET" && isFlowsListRoute(urlObj)) {
          const cloned = res.clone();
          const data = await cloned.json();
          updateFlowsCacheFromItems(Array.isArray(data?.items) ? data.items : []);
          console.log(NAMING_LOG_PREFIX, "cached flows", namingState.flowsCache.byId.size);
        } else if (method === "GET" && isChartRoute(urlObj)) {
          const flowId = extractFlowIdFromPath(urlObj.pathname);
          try {
            const cloned = res.clone();
            const data = await cloned.json();
            setChartCache(flowId, data);
            console.log(NAMING_LOG_PREFIX, "cached chart", flowId);
          } catch (e) {
            console.warn(NAMING_LOG_PREFIX, "chart GET response handling failed", e);
          } finally {
            notifyInterceptedChartGetCompleted(flowId);
          }
        } else if (method === "POST" && isCreateNodeRoute(urlObj) && res.ok) {
          const cloned = res.clone();
          const node = await cloned.json();
          const flowId = extractFlowIdFromPath(urlObj.pathname);
          upsertNodeInChartCache(flowId, node);
        } else if (method === "PATCH" && isPatchNodeRoute(urlObj) && res.ok) {
          const cloned = res.clone();
          const text = await cloned.text();
          if (text && text.trim()) {
            const node = parseJsonSafe(text);
            if (node && typeof node === "object") {
              const flowId = extractFlowIdFromPath(urlObj.pathname);
              upsertNodeInChartCache(flowId, node);
            } else {
              namingLogDebug("PATCH response body not JSON object", {
                flowId: extractFlowIdFromPath(urlObj.pathname),
                nodeId: extractNodeIdFromPatchPath(urlObj.pathname),
              });
            }
          } else {
            namingLogDebug("PATCH response body empty; cache not updated");
          }
        } else if (method === "DELETE" && isDeleteNodeRoute(urlObj) && res.ok) {
          const flowId = extractFlowIdFromPath(urlObj.pathname);
          const nodeId = extractNodeIdFromPatchPath(urlObj.pathname);
          removeNodeFromChartCache(flowId, nodeId);
          await refreshChartForFlow(flowId, "delete-fetch");
        }
      } catch (e) {
        console.warn(NAMING_LOG_PREFIX, "response cache update failed", e);
      }
      return res;
    };
    window.__cognigyCopilotFetchPatched = true;
    console.log(NAMING_LOG_PREFIX, "fetch naming interceptor installed");
  })();

  (function installXmlHttpRequestProbe() {
    if (typeof XMLHttpRequest === "undefined" || !XMLHttpRequest.prototype) return;
    if (window.__cognigyCopilotXhrPatched) return;
    const proto = XMLHttpRequest.prototype;
    if (!proto || !proto.open || !proto.send) return;
    if (proto.__cognigyNamingProbeInstalled) return;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const originalSetRequestHeader = proto.setRequestHeader;
    proto.open = function patchedOpen(method, url) {
      this.__cognigyProbeMethod = String(method || "GET").toUpperCase();
      this.__cognigyProbeUrl = String(url || "");
      this.__cognigyReqHeaders = {};
      this.__cognigyResponseCacheHooked = false;
      return originalOpen.apply(this, arguments);
    };
    proto.setRequestHeader = function patchedSetRequestHeader(name, value) {
      try {
        if (!this.__cognigyReqHeaders) this.__cognigyReqHeaders = {};
        this.__cognigyReqHeaders[String(name || "").toLowerCase()] = String(value || "");
      } catch (_) {}
      return originalSetRequestHeader.apply(this, arguments);
    };
    proto.send = function patchedSend(body) {
      const url = String(this.__cognigyProbeUrl || "");
      const method = String(this.__cognigyProbeMethod || "GET");
      const urlObj = parseUrl(url);
      const authHeader =
        (this.__cognigyReqHeaders && this.__cognigyReqHeaders.authorization) ||
        (this.__cognigyReqHeaders && this.__cognigyReqHeaders.Authorization) ||
        "";
      if (urlObj) {
        rememberApiContext(urlObj, authHeader);
      }

      if (urlObj && !this.__cognigyResponseCacheHooked) {
        this.__cognigyResponseCacheHooked = true;
        this.addEventListener("readystatechange", async () => {
          if (this.readyState !== 4) return;
          try {
            if (method === "GET" && isFlowsListRoute(urlObj)) {
              const data = parseJsonSafe(this.responseText || "");
              if (data && typeof data === "object") {
                updateFlowsCacheFromItems(Array.isArray(data.items) ? data.items : []);
                console.log(NAMING_LOG_PREFIX, "cached flows (xhr)", namingState.flowsCache.byId.size);
              }
            } else if (method === "GET" && isChartRoute(urlObj)) {
              const flowId = extractFlowIdFromPath(urlObj.pathname);
              try {
                const data = parseJsonSafe(this.responseText || "");
                if (data && typeof data === "object") {
                  setChartCache(flowId, data);
                  console.log(NAMING_LOG_PREFIX, "cached chart (xhr)", flowId);
                }
              } catch (error) {
                console.warn(NAMING_LOG_PREFIX, "xhr chart handling failed", error);
              } finally {
                notifyInterceptedChartGetCompleted(flowId);
              }
            } else if (
              method === "POST" &&
              isCreateNodeRoute(urlObj) &&
              this.status >= 200 &&
              this.status < 300
            ) {
              const node = parseJsonSafe(this.responseText || "");
              if (node && typeof node === "object") {
                const flowId = extractFlowIdFromPath(urlObj.pathname);
                upsertNodeInChartCache(flowId, node);
              }
            } else if (
              method === "PATCH" &&
              isPatchNodeRoute(urlObj) &&
              this.status >= 200 &&
              this.status < 300
            ) {
              const node = parseJsonSafe(this.responseText || "");
              if (node && typeof node === "object") {
                const flowId = extractFlowIdFromPath(urlObj.pathname);
                upsertNodeInChartCache(flowId, node);
              }
            } else if (
              method === "DELETE" &&
              isDeleteNodeRoute(urlObj) &&
              this.status >= 200 &&
              this.status < 300
            ) {
              const flowId = extractFlowIdFromPath(urlObj.pathname);
              const nodeId = extractNodeIdFromPatchPath(urlObj.pathname);
              removeNodeFromChartCache(flowId, nodeId);
              await refreshChartForFlow(flowId, "delete-xhr");
            }
          } catch (error) {
            console.warn(NAMING_LOG_PREFIX, "xhr response cache update failed", error);
          }
        });
      }

      if (!urlObj || !urlObj.pathname.startsWith(API_VERSION_SEGMENT + "/")) {
        return originalSend.apply(this, arguments);
      }

      if (
        (method === "POST" && isCreateNodeRoute(urlObj)) ||
        (method === "PATCH" && isPatchNodeRoute(urlObj))
      ) {
        const bodyText = typeof body === "string" ? body : "";
        const bodyObj = parseJsonSafe(bodyText);
        if (bodyObj && typeof bodyObj === "object") {
          (async () => {
            try {
              if (method === "POST") {
                await handlePostNodeRequest({ method: "POST" }, urlObj, bodyObj);
              } else {
                await handlePatchNodeRequest(urlObj, bodyObj);
              }
              const rewritten = JSON.stringify(bodyObj);
              originalSend.call(this, rewritten);
            } catch (error) {
              console.error(NAMING_LOG_PREFIX, "XHR rewrite failed, forwarding original body", error);
              originalSend.call(this, body);
            }
          })();
          return;
        }
      }

      return originalSend.apply(this, arguments);
    };
    proto.__cognigyNamingProbeInstalled = true;
    window.__cognigyCopilotXhrPatched = true;
    console.log(NAMING_LOG_PREFIX, "XMLHttpRequest naming interceptor installed");
  })();

  CCP.namingApi = CCP.namingApi || {};
  CCP.namingApi.getCurrentFlowId = function () {
    return getCurrentFlowIdFromLocation();
  };
  CCP.namingApi.getProjectId = function () {
    return getProjectIdFromLocation();
  };
  CCP.namingApi.ensureChartForFlow = async function (flowId) {
    return ensureChartForFlow(flowId);
  };
  CCP.namingApi.refreshChartForFlow = async function (flowId, reason) {
    return refreshChartForFlow(flowId, reason);
  };
  /** Hard refresh: re-fetch all flows and nodes from API. */
  CCP.namingApi.runHardProjectMapRefresh = runHardProjectMapRefresh;
  /** Full Cognigy canvas reload: synthetic collaboration message → FlowRefreshButton → wait for GET …/chart. */
  CCP.namingApi.runCognigyFlowChartReload = runCognigyFlowChartReload;
  CCP.namingApi.notifyCognigyFlowNodeUpdated = notifyCognigyFlowNodeUpdated;
  CCP.namingApi.runCognigyFlowNodeVisualRefresh = runCognigyFlowNodeVisualRefresh;
  /** @deprecated use runCognigyFlowChartReload — kept for existing callers. */
  CCP.namingApi.pullChartFromApiThenCollaborationPing = async function (flowId, nodeIdOpt) {
    return runCognigyFlowChartReload({ flowId: flowId, nodeId: nodeIdOpt });
  };
  CCP.namingApi.getChartCacheEntry = function (flowId) {
    if (!flowId) return null;
    // Prefer the project-map's chart entry (it stays merged with detail
    // GETs); fall back to the legacy intercept-driven cache.
    try {
      const map = namingState.map;
      if (map) {
        const entry = map.getChartEntry(String(flowId));
        if (entry) return entry;
      }
    } catch (_) {}
    return namingState.chartCache.get(String(flowId)) || null;
  };
  CCP.namingApi.getProjectMap = function () {
    return ensureProjectMap();
  };
  CCP.namingApi.reloadProjectMap = function (opts) {
    const map = ensureProjectMap();
    if (!map) return Promise.resolve(null);
    return map.reload(opts || { force: true });
  };
  CCP.namingApi.getStructuredFlowJson = async function (flowId, options) {
    const opts = Object.assign(
      {
        silenceUnknownNodeTypeWarnings: true,
        allowUnreachableNodes: true,
      },
      options || {}
    );
    const fid = String(flowId || "");
    if (!fid) return null;

    const map = ensureProjectMap();
    if (!map) return null;

    function tryBuildFromNamingChartCache() {
      return buildStructuredJsonFromNamingChartCache(fid, opts);
    }

    function tryBuild() {
      try {
        return map.flowToStructuredJson(fid, opts);
      } catch (e) {
        console.warn(NAMING_LOG_PREFIX, "flowToStructuredJson failed", { flowId: fid, error: String(e) });
        return null;
      }
    }

    function tryBuildDirectFromLegacyCache() {
      const legacy = namingState.chartCache.get(fid);
      if (!legacy || !legacy.nodes || !legacy.nodes.length) return null;
      try {
        map.handleChartResponse(fid, {
          nodes: legacy.nodes,
          relations: legacy.relations || [],
        });
        return map.flowToStructuredJson(fid, opts);
      } catch (e) {
        console.warn(NAMING_LOG_PREFIX, "tryBuildDirectFromLegacyCache failed", {
          flowId: fid,
          error: String(e),
        });
        return null;
      }
    }

    function seedFromInterceptChartCache() {
      const legacy = namingState.chartCache.get(fid);
      if (!legacy || !legacy.nodes || !legacy.nodes.length) return false;
      try {
        map.handleChartResponse(fid, {
          nodes: legacy.nodes,
          relations: legacy.relations || [],
        });
        return true;
      } catch (e) {
        namingLogDebug("seedFromInterceptChartCache failed", { flowId: fid, error: String(e) });
        return false;
      }
    }

    // Fast path: build directly from intercept chart cache + relations.
    let json = tryBuildFromNamingChartCache();
    if (json != null) return json;

    json = tryBuildDirectFromLegacyCache();
    if (json != null) return json;

    seedFromInterceptChartCache();
    json = tryBuild();
    if (json != null) return json;

    if (map._initPromise && !map._initialized) {
      try {
        await Promise.race([
          map._initPromise,
          new Promise(function (resolve) {
            setTimeout(resolve, 2500);
          }),
        ]);
      } catch (_) {}
      json = tryBuild();
      if (json != null) return json;
    }

    try {
      await Promise.race([
        ensureChartForFlow(fid),
        new Promise(function (resolve) {
          setTimeout(resolve, 5000);
        }),
      ]);
    } catch (e) {
      namingLogDebug("ensureChartForFlow for structured JSON failed", { flowId: fid, error: String(e) });
    }

    seedFromInterceptChartCache();
    json = tryBuild();
    if (json != null) return json;

    if (typeof map.reloadFlow === "function") {
      try {
        await Promise.race([
          map.reloadFlow(fid, { force: true, chartOnly: true }),
          new Promise(function (_, reject) {
            setTimeout(function () {
              reject(new Error("reloadFlow timeout"));
            }, 15000);
          }),
        ]);
      } catch (e) {
        namingLogDebug("reloadFlow for structured JSON failed", { flowId: fid, error: String(e) });
      }
    }

    return tryBuild();
  };
  CCP.namingApi.getNodeId = function (node) {
    return getNodeId(node);
  };
  CCP.namingApi.getNodeNextId = function (node) {
    return getNodeNextId(node);
  };
  CCP.namingApi.getNodeChildIds = function (node) {
    return getNodeChildIds(node);
  };
  CCP.namingApi.getRelationParentId = function (relation) {
    return getRelationParentId(relation);
  };
  CCP.namingApi.getRelationChildIds = function (relation) {
    return getRelationChildIds(relation);
  };
  CCP.namingApi.getRelationNextId = function (relation) {
    return getRelationNextId(relation);
  };

  function getFocusedChartNodeMetaFromLocation() {
    const path = String(window.location.pathname || "");
    const m = path.match(/\/flow\/[a-z0-9]{24}\/chart\/([a-z0-9]{24})(?:\/|$)/i);
    const nodeId = m ? String(m[1]) : "";
    const flowId = getCurrentFlowIdFromLocation();
    let nodeLabel = "";
    if (flowId && nodeId) {
      const chart = namingState.chartCache.get(String(flowId));
      const node = chart && chart.nodesById ? chart.nodesById.get(String(nodeId)) : null;
      if (node && typeof node === "object") {
        const raw = node.label != null ? node.label : node.type;
        nodeLabel = String(raw != null ? raw : nodeId).trim() || nodeId;
      } else {
        nodeLabel = nodeId;
      }
    }
    return { flowId: flowId, nodeId: nodeId, nodeLabel: nodeLabel };
  }
  CCP.namingApi.getFocusedChartNodeMetaFromLocation = getFocusedChartNodeMetaFromLocation;

  CCP.namingApi.setFabPanelOpen = function (open) {
    mountValidationWidgetIfNeeded();
    const ui = namingState.validation.ui;
    if (!ui.panel) return;
    ui.panelOpen = !!open;
    if (!ui.panelOpen) closeDismissScopePicker(ui);
    if (!ui.panelOpen) closeIntegrityExportFormatMenu(ui);
    ui.panel.style.display = ui.panelOpen ? (ui.flowChatRoot ? "flex" : "block") : "none";
  };

  CCP.namingApi.getAutofixContext = getAutofixContext;
  CCP.namingApi.getVisibleProjectMapIssues = getVisibleProjectMapIssuesForUi;
  CCP.namingApi.getAllProjectMapIssues = function () {
    const map = namingState.map;
    if (!map) return [];
    try {
      return map.findFlowNodeIssues() || [];
    } catch (_) {
      return [];
    }
  };
  CCP.namingApi.runNamingConventionScanNow = function () {
    return runNamingConventionScan("release-wizard");
  };

  function onValidationFabCollaborationSocketReady() {
    try {
      mountValidationWidgetIfNeeded();
      if (!namingState.validation.analysisCompletedOnce) {
        markInitialAnalysisPending();
        bootstrapInitialAnalysisIfMapReady();
        scheduleNamingConventionScan("collaboration-ready");
        renderValidationWidget();
      }
    } catch (e) {
      console.warn(NAMING_LOG_PREFIX, "onValidationFabCollaborationSocketReady", e);
    }
  }
  CCP.notifyValidationFabCollaborationReady = onValidationFabCollaborationSocketReady;
  if (CCP._validationFabCollabReadyPending) {
    CCP._validationFabCollabReadyPending = false;
    onValidationFabCollaborationSocketReady();
  }

  console.log(LOG_PREFIX, "inject.js setup complete at", performance.now());
})();

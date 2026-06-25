/**
 * Flow Code tab — JSON renderer.
 *
 * Renders the structured, execution-ordered JSON for the current flow in
 * a read-only Monaco editor. The actual JSON is built by the project-map
 * (`CognigyProjectMap.flowToStructuredJson`), and we listen for map
 * events to keep the editor in sync with intercepted API activity.
 *
 * Monaco's built-in `json` language handles tokenization, folding and
 * formatting, so we no longer need the custom CGF Monarch grammar. The
 * MTK colour-boost hack the CGF tab needed is also gone — the standard
 * `vs-dark` theme renders correctly because the JSON language ships its
 * own colour rules without `!important` collisions.
 *
 * A textarea fallback is still wired up for the rare case where Monaco
 * fails to load; in that case we surface the same JSON text plus a
 * compact diagnostics list derived from the project-map issues.
 */
(function ccpFlowCodeEditorModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  const flowCode = (CCP.flowCode = CCP.flowCode || {});

  const FLOW_CODE_HOST_ID = "flowCodeEditorHost";
  const FLOW_CODE_MODEL_LANGUAGE = "json";
  const MARKER_OWNER = "ccp-project-map";

  const state = {
    monaco: null,
    editor: null,
    modelsByFlowId: new Map(),
    ownMonacoLoadPromise: null,
    boundFlowId: "",
    boundUnsubscribers: [],
    refreshScheduled: false,
  };

  // ---------------------------------------------------------------------
  // Monaco loader (same flow as before — only the language changes).
  // ---------------------------------------------------------------------

  function resolveMonacoFromWindow() {
    try {
      if (window.monaco && window.monaco.editor) return window.monaco;
    } catch (_) {}
    return null;
  }

  function resolveExtensionAssetUrl(relativePath) {
    try {
      const baseSrc = CCP && CCP.bootstrapScriptSrc ? String(CCP.bootstrapScriptSrc) : "";
      if (!baseSrc) return "";
      return new URL(String(relativePath || "").replace(/^\/+/, ""), baseSrc).toString();
    } catch (_) {
      return "";
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      try {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = function () {
          resolve();
        };
        script.onerror = function (error) {
          reject(error || new Error("Failed loading " + src));
        };
        (document.head || document.documentElement).appendChild(script);
      } catch (error) {
        reject(error);
      }
    });
  }

  const MONACO_LOAD_TIMEOUT_MS = 8000;

  function isAmdRequire(fn) {
    return typeof fn === "function" && typeof fn.config === "function";
  }

  function resolveMonacoFromBridge() {
    try {
      const bridge = CCP.monacoBridge;
      if (bridge && typeof bridge.getMonacoApi === "function") {
        const monaco = bridge.getMonacoApi();
        if (monaco && monaco.editor) return monaco;
      }
    } catch (_) {}
    return null;
  }

  function loadOwnMonaco() {
    if (state.ownMonacoLoadPromise) return state.ownMonacoLoadPromise;
    state.ownMonacoLoadPromise = new Promise(async function (resolve) {
      const existing = resolveMonacoFromWindow();
      if (existing && existing.editor) {
        resolve(existing);
        return;
      }
      const fromBridge = resolveMonacoFromBridge();
      if (fromBridge) {
        resolve(fromBridge);
        return;
      }

      const loaderUrl = resolveExtensionAssetUrl("inject/vendor/monaco/vs/loader.js");
      if (!loaderUrl) {
        console.warn(LOG_PREFIX, "flow-code monaco loader url unavailable");
        resolve(null);
        return;
      }

      let settled = false;
      function finish(monaco) {
        if (settled) return;
        settled = true;
        resolve(monaco && monaco.editor ? monaco : null);
      }

      const timeoutId = setTimeout(function () {
        console.warn(LOG_PREFIX, "flow-code monaco load timed out");
        finish(null);
      }, MONACO_LOAD_TIMEOUT_MS);

      try {
        // Cognigy ships its own bundler globals. Monaco's AMD loader skips
        // initialisation when define.amd already exists, leaving webpack's
        // require in place — which never resolves vs/editor/editor.main.
        const savedDefine = window.define;
        const savedRequire = window.require;
        if (savedDefine && savedDefine.amd) {
          try {
            delete window.define;
          } catch (_) {
            window.define = undefined;
          }
        }
        if (savedRequire && !isAmdRequire(savedRequire)) {
          try {
            delete window.require;
          } catch (_) {
            window.require = undefined;
          }
        }

        await loadScript(loaderUrl);

        const amdRequire = window.require;
        if (!isAmdRequire(amdRequire)) {
          console.warn(LOG_PREFIX, "flow-code AMD require unavailable after loader");
          clearTimeout(timeoutId);
          finish(null);
          return;
        }

        const baseVsUrl = resolveExtensionAssetUrl("inject/vendor/monaco/vs");
        amdRequire.config({ paths: { vs: baseVsUrl } });
        amdRequire(
          ["vs/editor/editor.main"],
          function () {
            clearTimeout(timeoutId);
            finish(resolveMonacoFromWindow());
          },
          function (err) {
            console.warn(LOG_PREFIX, "flow-code monaco require failed", err);
            clearTimeout(timeoutId);
            finish(null);
          }
        );
      } catch (error) {
        console.warn(LOG_PREFIX, "flow-code monaco load failed", error);
        clearTimeout(timeoutId);
        finish(null);
      }
    });
    return state.ownMonacoLoadPromise;
  }

  async function resolveAnyMonaco() {
    if (state.monaco && state.monaco.editor) return state.monaco;
    const fromBridge = resolveMonacoFromBridge();
    if (fromBridge) {
      state.monaco = fromBridge;
      return fromBridge;
    }
    const monaco = await loadOwnMonaco();
    if (monaco && monaco.editor) {
      state.monaco = monaco;
      return monaco;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Editor creation + per-flow model management.
  // ---------------------------------------------------------------------

  function ensureMonacoEditor() {
    if (state.editor && state.monaco) return true;
    if (!flowCode.view || typeof flowCode.view.getEditorHost !== "function") return false;
    const monaco = state.monaco;
    if (!monaco || !monaco.editor || typeof monaco.editor.create !== "function") return false;
    const host = flowCode.view.getEditorHost();
    if (!host) return false;

    state.editor = monaco.editor.create(host, {
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      language: FLOW_CODE_MODEL_LANGUAGE,
      lineNumbers: "on",
      glyphMargin: true,
      renderLineHighlight: "line",
      smoothScrolling: true,
      theme: "vs-dark",
      tabSize: 2,
      insertSpaces: true,
      formatOnPaste: false,
      formatOnType: false,
    });

    // JSON language defaults already do schema diagnostics; disable that
    // since our content is generated and trusted.
    try {
      if (monaco.languages && monaco.languages.json && monaco.languages.json.jsonDefaults) {
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
          validate: false,
          allowComments: false,
          schemas: [],
        });
      }
    } catch (_) {}

    return true;
  }

  function ensureModelForFlow(flowId) {
    const key = String(flowId || "");
    if (!key || !state.monaco) return null;
    let model = state.modelsByFlowId.get(key) || null;
    if (model && !model.isDisposed()) return model;
    const uri = state.monaco.Uri.parse("inmemory://flow-code/" + key + ".json");
    model = state.monaco.editor.createModel("", FLOW_CODE_MODEL_LANGUAGE, uri);
    state.modelsByFlowId.set(key, model);
    return model;
  }

  function setModelValueQuiet(model, text) {
    if (!model || model.isDisposed()) return;
    const next = String(text == null ? "" : text);
    if (model.getValue() === next) return;
    try {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], function () {
        return null;
      });
    } catch (_) {
      try {
        model.setValue(next);
      } catch (__) {}
    }
  }

  // ---------------------------------------------------------------------
  // Issue -> Monaco marker mapping.
  // ---------------------------------------------------------------------

  function toMarkerSeverity(monaco, severity) {
    if (!monaco || !monaco.MarkerSeverity) return 8;
    const sev = Number(severity || 1);
    if (sev >= 3) return monaco.MarkerSeverity.Error;
    if (sev === 2) return monaco.MarkerSeverity.Warning;
    return monaco.MarkerSeverity.Info;
  }

  /**
   * Try to find the line in `text` that contains the given node id. The
   * structured-JSON output stamps `"_id": "<node id>"` into every node,
   * so locating the line is a string search. We fall back to line 1 if
   * the id can't be found (e.g. for project-level issues).
   */
  function locateNodeLine(text, nodeId) {
    if (!text || !nodeId) return 1;
    const idx = text.indexOf('"' + String(nodeId) + '"');
    if (idx < 0) return 1;
    let line = 1;
    for (let i = 0; i < idx; i++) {
      if (text.charCodeAt(i) === 10) line++;
    }
    return line;
  }

  function buildMarkersForFlow(model, flowId, issues) {
    if (!model || model.isDisposed()) return [];
    const text = model.getValue();
    const out = [];
    const monaco = state.monaco;
    if (!monaco) return out;
    const fid = String(flowId || "");
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      if (!issue) continue;
      const issueFlowId = issue.flow ? String(issue.flow.id || issue.flow._id || "") : "";
      if (issueFlowId && fid && issueFlowId !== fid) continue;
      const nodeId = issue.node ? String(issue.node.id || issue.node._id || "") : "";
      const line = locateNodeLine(text, nodeId);
      const lineContent = model.getLineContent(line) || "";
      out.push({
        severity: toMarkerSeverity(monaco, issue.severity),
        message: String(issue.message || ""),
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: Math.max(2, lineContent.length + 1),
        source: String(issue.type || "ccp-project-map"),
      });
    }
    return out;
  }

  function applyMarkersForFlow(model, flowId) {
    if (!state.monaco || !model || model.isDisposed()) return;
    const namingApi = CCP.namingApi || {};
    const map = typeof namingApi.getProjectMap === "function" ? namingApi.getProjectMap() : null;
    let issues = [];
    if (map) {
      try {
        issues = map.issues || map.findFlowNodeIssues();
      } catch (e) {
        console.warn(LOG_PREFIX, "flow-code findFlowNodeIssues failed", e);
      }
    }
    const markers = buildMarkersForFlow(model, flowId, Array.isArray(issues) ? issues : []);
    try {
      state.monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
    } catch (_) {}
    if (flowCode.view && typeof flowCode.view.setDiagnostics === "function") {
      flowCode.view.setDiagnostics(
        markers.map(function (m) {
          return {
            message: m.message,
            severity: m.severity >= 8 ? "error" : "warning",
          };
        })
      );
    }
  }

  // ---------------------------------------------------------------------
  // Map event wiring.
  // ---------------------------------------------------------------------

  function unbindMapListeners() {
    while (state.boundUnsubscribers.length) {
      const off = state.boundUnsubscribers.pop();
      try {
        off();
      } catch (_) {}
    }
  }

  function bindMapListenersForFlow(flowId) {
    unbindMapListeners();
    const namingApi = CCP.namingApi || {};
    const map = typeof namingApi.getProjectMap === "function" ? namingApi.getProjectMap() : null;
    if (!map || typeof map.addEventListener !== "function") return;
    const fid = String(flowId || "");

    function on(name, handler) {
      const wrapped = function (ev) {
        handler(ev);
      };
      try {
        map.addEventListener(name, wrapped);
        state.boundUnsubscribers.push(function () {
          try {
            map.removeEventListener(name, wrapped);
          } catch (_) {}
        });
      } catch (_) {}
    }

    on("chart-changed", function (ev) {
      const detail = ev && ev.detail ? ev.detail : {};
      if (detail.flowId && String(detail.flowId) !== fid) return;
      scheduleRefresh();
    });
    on("flows-changed", function () {
      scheduleRefresh();
    });
    on("extensions-changed", function () {
      scheduleRefresh();
    });
    on("issues-changed", function () {
      refreshMarkers();
    });
    on("init-finished", function () {
      scheduleRefresh();
    });
  }

  function scheduleRefresh() {
    if (state.refreshScheduled) return;
    state.refreshScheduled = true;
    Promise.resolve().then(function () {
      state.refreshScheduled = false;
      const flowId = state.boundFlowId;
      if (!flowId) return;
      refreshModelContent(flowId);
    });
  }

  function refreshMarkers() {
    const flowId = state.boundFlowId;
    if (!flowId || !state.monaco) return;
    const model = state.modelsByFlowId.get(flowId);
    if (!model) return;
    applyMarkersForFlow(model, flowId);
  }

  async function structuredJsonForFlowAsync(flowId) {
    const namingApi = CCP.namingApi || {};
    if (typeof namingApi.getStructuredFlowJson !== "function") return null;
    try {
      return await namingApi.getStructuredFlowJson(flowId, { stripSparseConfig: true });
    } catch (e) {
      console.warn(LOG_PREFIX, "flow-code getStructuredFlowJson failed", e);
      return null;
    }
  }

  function jsonToText(value) {
    if (value == null) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      console.warn(LOG_PREFIX, "flow-code JSON stringify failed", e);
      try {
        return String(value);
      } catch (_) {
        return "";
      }
    }
  }

  async function refreshModelContent(flowId) {
    if (!flowId) return;
    const json = await structuredJsonForFlowAsync(flowId);
    const text = jsonToText(json);
    if (state.monaco) {
      const model = ensureModelForFlow(flowId);
      if (model) {
        setModelValueQuiet(model, text);
        applyMarkersForFlow(model, flowId);
      }
    }
    if (!state.monaco && flowCode.view && typeof flowCode.view.showFallbackText === "function") {
      flowCode.view.showFallbackText(text);
    }
  }

  // ---------------------------------------------------------------------
  // Public entry point used by bootstrap.js.
  // ---------------------------------------------------------------------

  async function renderFlowCode(flowId) {
    if (!flowId) return { ok: false, reason: "missing-flow-id" };

    const namingApi = CCP.namingApi || {};
    const mapReady = typeof namingApi.getProjectMap === "function" ? namingApi.getProjectMap() : null;
    if (!mapReady) return { ok: false, reason: "project-map-unavailable" };

    console.log(LOG_PREFIX, "flow-code render start", { flowId: String(flowId) });

    if (flowCode.view && typeof flowCode.view.applyMode === "function") {
      flowCode.view.applyMode("code");
    }

    let json = await structuredJsonForFlowAsync(flowId);
    if (json == null) {
      console.warn(LOG_PREFIX, "flow-code structured JSON unavailable", { flowId: String(flowId) });
      return { ok: false, reason: "flow-data-unavailable" };
    }
    const text = jsonToText(json);

    // Always paint JSON immediately — never block the Code tab on Monaco.
    if (flowCode.view && typeof flowCode.view.showFallbackText === "function") {
      flowCode.view.showFallbackText(text);
    }
    state.boundFlowId = String(flowId);
    bindMapListenersForFlow(flowId);

    const monaco = await resolveAnyMonaco();
    if (!monaco) {
      console.warn(LOG_PREFIX, "flow-code using textarea fallback (Monaco unavailable)");
      return { ok: true, fallback: true };
    }

    if (!ensureMonacoEditor()) {
      console.warn(LOG_PREFIX, "flow-code using textarea fallback (editor create failed)");
      return { ok: true, fallback: true };
    }

    if (flowCode.view && typeof flowCode.view.hideFallbackText === "function") {
      flowCode.view.hideFallbackText();
    }
    if (flowCode.view && typeof flowCode.view.bindFallbackInput === "function") {
      flowCode.view.bindFallbackInput(null);
    }

    const model = ensureModelForFlow(flowId);
    if (!model) return { ok: false, reason: "model-create-failed" };
    setModelValueQuiet(model, text);
    state.editor.setModel(model);
    applyMarkersForFlow(model, flowId);

    console.log(LOG_PREFIX, "flow-code render done (Monaco)", { flowId: String(flowId) });
    return { ok: true };
  }

  flowCode.editor = {
    renderFlowCode,
  };
})();

(function ccpMonacoDiscoveryModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  const MSG_INJECT = CCP.MSG_INJECT || "COGNIGY_COPILOT_INJECT";

  /** --- Monaco discovery state --- */
  let lastFocusedEditor = null;
  /** Editor used for the current Cmd+I stream (pinned at GET_EDITOR_SELECTION). */
  let streamTargetEditor = null;
  /** Byte offsets in model for selection to replace. */
  let streamPinnedRange = null;
  let editStreamState = null;

  function handleGetSelectionRequest(data) {
    const requestId = data.requestId;
    streamPinnedRange = null;
    streamTargetEditor = getActiveEditor();
    const ed = streamTargetEditor;
    let selection = "";
    let full_code = "";
    let lineFrom = null;
    let lineTo = null;
    let hasNonemptySelection = false;
    try {
      if (ed && ed.getModel()) {
        const model = ed.getModel();
        const full = model.getValue();
        const sel = ed.getSelection();
        if (sel && !sel.isEmpty()) {
          hasNonemptySelection = true;
          lineFrom = sel.startLineNumber;
          lineTo = sel.endLineNumber;
          const startOffset = model.getOffsetAt(sel.getStartPosition());
          const endOffset = model.getOffsetAt(sel.getEndPosition());
          selection = full.slice(startOffset, endOffset);
          full_code =
            full.slice(0, startOffset) + "<SELECTION>" + selection + "</SELECTION>" + full.slice(endOffset);
          streamPinnedRange = { startOffset: startOffset, endOffset: endOffset };
        } else {
          selection = full;
          full_code = "<SELECTION>" + full + "</SELECTION>";
          streamPinnedRange = { startOffset: 0, endOffset: full.length };
        }
      }
    } catch (e) {
      console.error(LOG_PREFIX, "get selection failed", e);
    }
    let nodeId = "";
    let nodeLabel = "";
    try {
      const metaFn =
        CCP.namingApi && typeof CCP.namingApi.getFocusedChartNodeMetaFromLocation === "function"
          ? CCP.namingApi.getFocusedChartNodeMetaFromLocation
          : null;
      if (metaFn) {
        const meta = metaFn() || {};
        nodeId = meta.nodeId != null ? String(meta.nodeId) : "";
        nodeLabel = meta.nodeLabel != null ? String(meta.nodeLabel) : "";
      }
    } catch (e2) {
      console.warn(LOG_PREFIX, "chart node meta for selection failed", e2);
    }
    if (!ed) {
      console.warn(
        LOG_PREFIX,
        "GET_EDITOR_SELECTION no Monaco editor resolved — click inside the code editor, or open the copilot in the same frame as the editor (iframe)."
      );
    }
    console.log(
      LOG_PREFIX,
      "GET_EDITOR_SELECTION_RESPONSE",
      requestId,
      "length",
      selection.length,
      "full_code len",
      full_code.length
    );
    window.postMessage(
      {
        source: MSG_INJECT,
        type: "GET_EDITOR_SELECTION_RESPONSE",
        requestId,
        payload: {
          selection: selection,
          full_code: full_code,
          nodeId: nodeId,
          nodeLabel: nodeLabel,
          lineFrom: lineFrom,
          lineTo: lineTo,
          hasNonemptySelection: hasNonemptySelection,
        },
      },
      "*"
    );
  }

  function handleEditChunk(payload) {
    const chunk = payload && typeof payload.chunk === "string" ? payload.chunk : "";
    if (!chunk) {
      return;
    }
    const preview = chunk.slice(0, 20);
    console.log(
      LOG_PREFIX,
      "EDIT_CHUNK apply first20",
      JSON.stringify(preview),
      "idx",
      editStreamState ? editStreamState.chunkIndex : -1
    );

    const ed = streamTargetEditor || lastFocusedEditor || getActiveEditor();
    if (!ed || !ed.getModel()) {
      console.warn(LOG_PREFIX, "EDIT_CHUNK no active editor");
      return;
    }
    if (!editStreamState) {
      console.warn(LOG_PREFIX, "EDIT_CHUNK but no stream state — initializing");
      beginEditStreamFromChunk(ed, chunk);
      return;
    }

    applyChunkAtOffset(ed, chunk);
  }

  function beginEditStreamFromChunk(editor, firstChunk) {
    const model = editor.getModel();
    let startOffset;
    let endOffset;
    if (streamPinnedRange && typeof streamPinnedRange.startOffset === "number") {
      startOffset = streamPinnedRange.startOffset;
      endOffset = streamPinnedRange.endOffset;
    } else {
      const sel = editor.getSelection();
      startOffset = model.getOffsetAt(sel.getStartPosition());
      endOffset = model.getOffsetAt(sel.getEndPosition());
    }
    editStreamState = {
      appendOffset: startOffset,
      endOffset: endOffset,
      replaced: false,
      chunkIndex: 0,
    };
    applyChunkAtOffset(editor, firstChunk);
  }

  function applyChunkAtOffset(editor, chunk) {
    const M = getMonacoApi();
    if (!M) {
      console.error(LOG_PREFIX, "applyChunkAtOffset: Monaco API missing");
      return;
    }
    const model = editor.getModel();
    if (!editStreamState) {
      return;
    }
    const st = editStreamState;
    const pos = model.getPositionAt(st.appendOffset);

    if (!st.replaced && st.appendOffset < st.endOffset) {
      const endPos = model.getPositionAt(st.endOffset);
      const range =
        typeof M.Range.fromPositions === "function"
          ? M.Range.fromPositions(pos, endPos)
          : new M.Range(pos.lineNumber, pos.column, endPos.lineNumber, endPos.column);
      editor.executeEdits("cognigy-copilot-stream", [{ range, text: chunk, forceMoveMarkers: true }]);
      st.replaced = true;
      st.appendOffset = st.appendOffset + chunk.length;
      console.log(LOG_PREFIX, "replaced selection; new appendOffset", st.appendOffset);
    } else {
      const range = new M.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
      editor.executeEdits("cognigy-copilot-stream", [{ range, text: chunk, forceMoveMarkers: true }]);
      st.appendOffset = st.appendOffset + chunk.length;
      console.log(LOG_PREFIX, "inserted chunk; new appendOffset", st.appendOffset, "chunkIdx", st.chunkIndex);
    }
    st.chunkIndex += 1;

    const newPos = model.getPositionAt(st.appendOffset);
    editor.setPosition(newPos);
  }

  function handleEditDone() {
    console.log(LOG_PREFIX, "EDIT_DONE; stream finished");
    finishEditStream();
  }

  function finishEditStream() {
    editStreamState = null;
    streamTargetEditor = null;
    streamPinnedRange = null;
    invalidateMonacoApiCache("stream finished");
  }
  /** --- Monaco bootstrap (Cognigy may not expose window.monaco; try parent + key scan) --- */
  let monacoReady = false;
  let cachedMonacoApi = null;
  /** @type {WeakSet<object>} */
  const hookedEditors = new WeakSet();
  let monacoResolveHint = "";
  let lastDomMonacoScanAt = 0;
  const DOM_MONACO_SCAN_INTERVAL_MS = 4000;
  let lastWebpackMonacoProbeAt = 0;
  const WEBPACK_MONACO_PROBE_INTERVAL_MS = 2000;
  let lastEditorIdentityProbeAt = 0;
  const EDITOR_IDENTITY_PROBE_INTERVAL_MS = 2500;
  let bundlerProbeLogged = false;
  let reactBroadScanWarnedOnce = false;

  /**
   * querySelectorAll does not pierce Shadow DOM — Monaco often lives inside web components.
   * Tree walk + matches only (no querySelectorAll per node — avoids O(n²) on large DOMs).
   */
  function deepQuerySelectorAll(selector, root) {
    const out = [];
    const seen = new Set();
    function walk(node) {
      if (!node) {
        return;
      }
      if (node.nodeType === 1) {
        try {
          if (node.matches && node.matches(selector) && !seen.has(node)) {
            seen.add(node);
            out.push(node);
          }
        } catch (_) {}
        if (node.shadowRoot) {
          walk(node.shadowRoot);
        }
        const children = node.children;
        if (children) {
          for (let i = 0; i < children.length; i++) {
            walk(children[i]);
          }
        }
      } else if (node.nodeType === 11) {
        const ch = node.childNodes;
        for (let i = 0; i < ch.length; i++) {
          walk(ch[i]);
        }
      }
    }
    const start = root && root.nodeType ? root : document.documentElement;
    if (start) {
      walk(start);
    }
    return out;
  }

  function countMonacoDomSignals() {
    let lightMonacoEditor = 0;
    let deepMonacoEditor = 0;
    let deepClassMonaco = 0;
    let deepViewLines = 0;
    let iframeCount = 0;
    let accessibleNestedFrames = 0;
    let crossOriginIframeSkips = 0;

    function addDocument(doc) {
      if (!doc || !doc.documentElement) {
        return;
      }
      try {
        lightMonacoEditor += doc.querySelectorAll(".monaco-editor").length;
      } catch (_) {}
      try {
        deepMonacoEditor += deepQuerySelectorAll(".monaco-editor", doc.documentElement).length;
      } catch (e) {
        console.warn(LOG_PREFIX, "deepQuerySelectorAll .monaco-editor failed", e);
      }
      try {
        deepClassMonaco += deepQuerySelectorAll("[class*='monaco']", doc.documentElement).length;
      } catch (_) {}
      try {
        deepViewLines += deepQuerySelectorAll(".view-lines", doc.documentElement).length;
      } catch (_) {}
    }

    function walkFrames(win, depth) {
      if (!win || depth > 8) {
        return;
      }
      try {
        addDocument(win.document);
      } catch (_) {}
      let iframes;
      try {
        iframes = win.document.querySelectorAll("iframe");
      } catch (_) {
        return;
      }
      iframeCount += iframes.length;
      for (let i = 0; i < iframes.length; i++) {
        try {
          const inner = iframes[i].contentWindow;
          if (!inner || inner === win) {
            continue;
          }
          if (iframes[i].contentDocument) {
            accessibleNestedFrames++;
          }
          walkFrames(inner, depth + 1);
        } catch (e) {
          crossOriginIframeSkips++;
        }
      }
    }

    try {
      walkFrames(window, 0);
    } catch (e) {
      console.warn(LOG_PREFIX, "countMonacoDomSignals walkFrames failed", e);
    }

    return {
      lightMonacoEditor,
      deepMonacoEditor,
      deepClassMonaco,
      deepViewLines,
      iframeCount,
      accessibleNestedFrames,
      crossOriginIframeSkips,
    };
  }

  /**
   * True if this looks like the monaco namespace (do not require inline completions — older builds).
   */
  function isMonacoLike(obj) {
    return !!(obj && typeof obj === "object" && obj.editor && typeof obj.editor.getEditors === "function");
  }

  /**
   * Bundled apps (Webpack/Vite) often never assign `window.monaco` — scan module cache.
   */
  function tryFindMonacoViaWebpack() {
    const wr = window.__webpack_require__;
    if (typeof wr !== "function" || !wr.m) {
      return null;
    }
    const ids = Object.keys(wr.m);
    const scored = ids
      .map(function (id) {
        const s = String(id);
        let score = 0;
        if (/monaco-editor|monaco[\\/]esm|vs[\\/]editor|editor\.(api|standalone)|standaloneEditor/i.test(s)) {
          score += 10;
        }
        if (/monaco/i.test(s)) {
          score += 3;
        }
        if (/editor/i.test(s)) {
          score += 1;
        }
        return { id: id, score: score };
      })
      .filter(function (x) {
        return x.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });

    let toTry = scored.slice(0, 200).map(function (x) {
      return x.id;
    });
    if (toTry.length === 0) {
      toTry = ids
        .filter(function (id) {
          return /monaco|vs[\\/]editor|editor\.api/i.test(String(id));
        })
        .slice(0, 120);
    }
    if (toTry.length === 0) {
      const numeric = ids
        .filter(function (id) {
          return /^\d+$/.test(String(id));
        })
        .slice(0, 100);
      if (numeric.length > 0) {
        toTry = numeric;
        console.log(
          LOG_PREFIX,
          "webpack: no monaco-like string ids; sampling numeric module ids",
          toTry.length
        );
      }
    }
    if (toTry.length === 0) {
      return null;
    }
    console.log(LOG_PREFIX, "webpack: probing", toTry.length, "candidate module ids (top scores)");

    for (let i = 0; i < toTry.length; i++) {
      const id = toTry[i];
      try {
        const exp = wr(id);
        if (isMonacoLike(exp)) {
          monacoResolveHint = "webpackRequire(" + String(id).slice(0, 120) + ")";
          console.log(LOG_PREFIX, "Monaco namespace via __webpack_require__", monacoResolveHint);
          return exp;
        }
        if (exp && exp.default && isMonacoLike(exp.default)) {
          monacoResolveHint = "webpackRequire(" + String(id).slice(0, 120) + ").default";
          console.log(LOG_PREFIX, "Monaco namespace via webpack .default", monacoResolveHint);
          return exp.default;
        }
        if (exp && typeof exp === "object") {
          const keys = Object.keys(exp);
          for (let k = 0; k < keys.length && k < 40; k++) {
            try {
              if (isMonacoLike(exp[keys[k]])) {
                monacoResolveHint = "webpackRequire(" + String(id).slice(0, 80) + ")." + keys[k];
                console.log(LOG_PREFIX, "Monaco namespace via webpack named export", monacoResolveHint);
                return exp[keys[k]];
              }
            } catch (_) {}
          }
        }
      } catch (err) {
        /* module factory may throw until deps loaded */
      }
    }
    return null;
  }

  function tryFindMonacoViaWebpackThrottled() {
    const t = Date.now();
    if (t - lastWebpackMonacoProbeAt < WEBPACK_MONACO_PROBE_INTERVAL_MS) {
      return null;
    }
    lastWebpackMonacoProbeAt = t;
    return tryFindMonacoViaWebpack();
  }

  function getReactInternalFiber(dom) {
    if (!dom || typeof dom !== "object") {
      return null;
    }
    let keys;
    try {
      keys = Object.keys(dom);
    } catch (_) {
      return null;
    }
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.indexOf("__reactFiber") === 0 || k.indexOf("__reactContainer") === 0) {
        try {
          return dom[k];
        } catch (_) {}
      }
    }
    return null;
  }

  function walkFiberForMonacoNamespace(fiber, depth, maxDepth) {
    if (!fiber || depth > maxDepth) {
      return null;
    }
    try {
      const props = fiber.memoizedProps;
      if (props && typeof props === "object") {
        const pk = Object.keys(props);
        for (let i = 0; i < pk.length; i++) {
          try {
            const val = props[pk[i]];
            if (isMonacoLike(val)) {
              return val;
            }
          } catch (_) {}
        }
      }
      const pend = fiber.pendingProps;
      if (pend && typeof pend === "object") {
        const pk = Object.keys(pend);
        for (let i = 0; i < pk.length; i++) {
          try {
            const val = pend[pk[i]];
            if (isMonacoLike(val)) {
              return val;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
    let ch = fiber.child;
    while (ch) {
      const hit = walkFiberForMonacoNamespace(ch, depth + 1, maxDepth);
      if (hit) {
        return hit;
      }
      ch = ch.sibling;
    }
    return null;
  }

  function tryFindMonacoNamespaceViaReactFiber(doc, framePath) {
    let roots = [];
    try {
      roots = deepQuerySelectorAll(".monaco-editor", doc.documentElement).slice(0, 14);
    } catch (_) {}
    for (let i = 0; i < roots.length; i++) {
      let el = roots[i];
      for (let up = 0; up < 18 && el; up++) {
        const fib = getReactInternalFiber(el);
        if (fib) {
          const m = walkFiberForMonacoNamespace(fib, 0, 80);
          if (m) {
            monacoResolveHint = framePath + " ReactFiber";
            console.log(LOG_PREFIX, "Monaco namespace via React fiber walk", monacoResolveHint);
            return m;
          }
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  /**
   * Strict IStandaloneCodeEditor shape.
   */
  function isCodeEditorLike(obj) {
    return !!(
      obj &&
      typeof obj === "object" &&
      typeof obj.getModel === "function" &&
      typeof obj.executeEdits === "function" &&
      typeof obj.getPosition === "function"
    );
  }

  /**
   * Cognigy wrappers sometimes omit getPosition on the object we see from React.
   */
  function isCodeEditorLikeLoose(obj) {
    return !!(
      obj &&
      typeof obj === "object" &&
      typeof obj.getModel === "function" &&
      typeof obj.executeEdits === "function"
    );
  }

  function isAnyEditorLike(obj) {
    return isCodeEditorLike(obj) || isCodeEditorLikeLoose(obj);
  }

  /**
   * Deep-search nested props (refs, value, options) — Vite/React often hide the editor here.
   */
  function findCodeEditorInPropsDeep(obj, depth, maxDepth, seen) {
    if (!obj || typeof obj !== "object" || depth > maxDepth) {
      return null;
    }
    if (!seen) {
      seen = new WeakSet();
    }
    if (seen.has(obj)) {
      return null;
    }
    seen.add(obj);
    if (isAnyEditorLike(obj)) {
      return obj;
    }
    let keys;
    try {
      keys = Object.keys(obj);
    } catch (_) {
      return null;
    }
    for (let i = 0; i < keys.length && i < 100; i++) {
      try {
        const v = obj[keys[i]];
        if (isAnyEditorLike(v)) {
          return v;
        }
        if (v && typeof v === "object") {
          const sub = findCodeEditorInPropsDeep(v, depth + 1, maxDepth, seen);
          if (sub) {
            return sub;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Walk parents: React metadata may live on a wrapper, not on .monaco-editor.
   */
  function tryFindCodeEditorViaBroadMonacoReactScan(doc, framePath) {
    let candidates = [];
    try {
      candidates = deepQuerySelectorAll(
        "[class*='monaco'], .view-lines, .overflow-guard, textarea.inputarea",
        doc.documentElement
      ).slice(0, 56);
    } catch (_) {}
    let sawReactKey = 0;
    for (let i = 0; i < candidates.length; i++) {
      let el = candidates[i];
      for (let up = 0; up < 32 && el; up++) {
        let keys;
        try {
          keys = Object.keys(el);
        } catch (_) {
          break;
        }
        for (let j = 0; j < keys.length; j++) {
          const k = keys[j];
          if (k.indexOf("__react") !== 0) {
            continue;
          }
          sawReactKey++;
          try {
            if (k.indexOf("__reactProps") === 0) {
              const ed = findCodeEditorInPropsDeep(el[k], 0, 16);
              if (ed) {
                console.log(
                  LOG_PREFIX,
                  "ICodeEditor via broad __reactProps",
                  k,
                  "[" + framePath + "]",
                  "ancestorUp",
                  up
                );
                return ed;
              }
            }
            if (
              k.indexOf("__reactFiber") === 0 ||
              k.indexOf("__reactContainer") === 0 ||
              k.indexOf("__reactReturn") === 0
            ) {
              const ed = walkFiberForCodeEditorInstance(el[k], 0, 180);
              if (ed) {
                console.log(
                  LOG_PREFIX,
                  "ICodeEditor via broad __reactFiber",
                  k,
                  "[" + framePath + "]",
                  "ancestorUp",
                  up
                );
                return ed;
              }
            }
          } catch (_) {}
        }
        el = el.parentElement;
      }
    }
    if (sawReactKey === 0 && candidates.length > 0 && !reactBroadScanWarnedOnce) {
      reactBroadScanWarnedOnce = true;
      console.warn(
        LOG_PREFIX,
        "broad React scan: 0 __react* keys on monaco-related nodes — not React-DOM or keys stripped in prod"
      );
    }
    return null;
  }

  /**
   * React 18+ stores latest props on the DOM node as __reactProps$…
   */
  function tryFindCodeEditorViaReactPropsOnDom(doc, framePath) {
    let roots = [];
    try {
      roots = deepQuerySelectorAll(".monaco-editor", doc.documentElement).slice(0, 16);
    } catch (_) {}
    for (let i = 0; i < roots.length; i++) {
      const el = roots[i];
      let keys;
      try {
        keys = Object.keys(el);
      } catch (_) {
        continue;
      }
      for (let j = 0; j < keys.length; j++) {
        const k = keys[j];
        if (k.indexOf("__reactProps") !== 0) {
          continue;
        }
        try {
          const props = el[k];
          const ed = findCodeEditorInPropsDeep(props, 0, 16);
          if (ed) {
            console.log(LOG_PREFIX, "ICodeEditor via DOM", k, "[" + framePath + "]");
            return ed;
          }
        } catch (_) {}
      }
    }
    return null;
  }
  function buildPartialMonacoNamespace(editor) {
    if (!editor || !isAnyEditorLike(editor)) {
      return null;
    }
    const api = {
      _partial: true,
      languages: null,
      editor: {
        getEditors: function () {
          return [editor];
        },
        onDidCreateEditor: function (cb) {
          try {
            cb(editor);
          } catch (e) {
            console.warn(LOG_PREFIX, "partial onDidCreateEditor callback", e);
          }
          return { dispose: function () {} };
        },
      },
    };
    api.Range = function Range(a, b, c, d) {
      return {
        startLineNumber: a,
        startColumn: b,
        endLineNumber: c,
        endColumn: d,
      };
    };
    api.Range.fromPositions = function fromPositions(p1, p2) {
      return api.Range(p1.lineNumber, p1.column, p2.lineNumber, p2.column);
    };
    return api;
  }

  function editorToMonacoApiOrPartial(editor) {
    if (!editor) {
      return null;
    }
    let m = findMonacoNamespaceForEditor(editor);
    if (!m) {
      m = findMonacoNamespaceForEditorDeep(editor, 3);
    }
    if (m) {
      return m;
    }
    const p = buildPartialMonacoNamespace(editor);
    if (p) {
      monacoResolveHint = "partial:ICodeEditor(ReactFiber)";
      console.info(
        LOG_PREFIX,
        "using partial Monaco API (ICodeEditor only — Vite/ESM; Tab ghost text disabled without monaco.languages)"
      );
    }
    return p;
  }

  function walkFiberForCodeEditorInstance(fiber, depth, maxDepth) {
    if (!fiber || depth > maxDepth) {
      return null;
    }
    try {
      const sn = fiber.stateNode;
      if (sn && isAnyEditorLike(sn)) {
        return sn;
      }
    } catch (_) {}
    try {
      if (fiber.memoizedProps) {
        const ed = findCodeEditorInPropsDeep(fiber.memoizedProps, 0, 14);
        if (ed) {
          return ed;
        }
      }
    } catch (_) {}
    try {
      if (fiber.pendingProps) {
        const ed = findCodeEditorInPropsDeep(fiber.pendingProps, 0, 14);
        if (ed) {
          return ed;
        }
      }
    } catch (_) {}
    let ch = fiber.child;
    while (ch) {
      const hit = walkFiberForCodeEditorInstance(ch, depth + 1, maxDepth);
      if (hit) {
        return hit;
      }
      ch = ch.sibling;
    }
    return null;
  }

  function findMonacoNamespaceForEditor(editor) {
    if (!editor) {
      return null;
    }
    let keys;
    try {
      keys = Object.keys(window);
    } catch (_) {
      return null;
    }
    for (let i = 0; i < keys.length && i < 900; i++) {
      try {
        const cand = window[keys[i]];
        if (!isMonacoLike(cand)) {
          continue;
        }
        const eds = cand.editor.getEditors();
        for (let j = 0; j < eds.length; j++) {
          if (eds[j] === editor) {
            monacoResolveHint =
              "editorIdentity→window[" + JSON.stringify(keys[i]) + "].getEditors()[" + j + "]";
            console.log(
              LOG_PREFIX,
              "Monaco namespace matched by editor reference equality",
              monacoResolveHint
            );
            return cand;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  function findMonacoNamespaceForEditorDeep(editor, maxDepth) {
    if (!editor || maxDepth < 1) {
      return null;
    }
    const visited = new WeakSet();
    function walk(o, depth, path) {
      if (!o || typeof o !== "object" || depth > maxDepth) {
        return null;
      }
      if (visited.has(o)) {
        return null;
      }
      visited.add(o);
      try {
        if (isMonacoLike(o)) {
          const eds = o.editor.getEditors();
          for (let i = 0; i < eds.length; i++) {
            if (eds[i] === editor) {
              monacoResolveHint = "editorIdentityDeep→" + path;
              console.log(LOG_PREFIX, "Monaco namespace matched (deep scan)", monacoResolveHint);
              return o;
            }
          }
        }
      } catch (_) {}
      let klist = [];
      try {
        klist = Object.keys(o);
      } catch (_) {
        return null;
      }
      for (let i = 0; i < klist.length && i < 50; i++) {
        try {
          const sub = walk(o[klist[i]], depth + 1, path + "." + klist[i]);
          if (sub) {
            return sub;
          }
        } catch (_) {}
      }
      return null;
    }
    const wk = Object.keys(window).slice(0, 80);
    for (let i = 0; i < wk.length; i++) {
      try {
        const sub = walk(window[wk[i]], 0, wk[i]);
        if (sub) {
          return sub;
        }
      } catch (_) {}
    }
    return null;
  }

  function tryFindMonacoViaEditorIdentity(doc, framePath) {
    const fromBroad = tryFindCodeEditorViaBroadMonacoReactScan(doc, framePath);
    if (fromBroad) {
      return editorToMonacoApiOrPartial(fromBroad);
    }

    const fromDom = tryFindCodeEditorViaReactPropsOnDom(doc, framePath);
    if (fromDom) {
      return editorToMonacoApiOrPartial(fromDom);
    }

    let roots = [];
    try {
      roots = deepQuerySelectorAll(".monaco-editor", doc.documentElement).slice(0, 10);
    } catch (_) {}
    for (let i = 0; i < roots.length; i++) {
      let el = roots[i];
      for (let up = 0; up < 22 && el; up++) {
        const fib = getReactInternalFiber(el);
        if (fib) {
          const ed = walkFiberForCodeEditorInstance(fib, 0, 120);
          if (ed) {
            console.log(
              LOG_PREFIX,
              "React fiber: ICodeEditor in [" + framePath + "] — resolving namespace or partial …"
            );
            return editorToMonacoApiOrPartial(ed);
          }
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  function tryGetMonacoFromChildFrames(win) {
    try {
      const len = win.frames.length;
      for (let i = 0; i < len; i++) {
        try {
          const sub = win.frames[i];
          if (!sub || sub === win) {
            continue;
          }
          if (sub.monaco && isMonacoLike(sub.monaco)) {
            monacoResolveHint = "frames[" + i + "].monaco";
            console.log(LOG_PREFIX, "Monaco API on same-origin iframe", monacoResolveHint);
            return sub.monaco;
          }
        } catch (e) {
          /* cross-origin iframe — expected */
        }
      }
    } catch (e) {
      console.warn(LOG_PREFIX, "tryGetMonacoFromChildFrames failed", e);
    }
    return null;
  }

  /**
   * Walk monaco-related DOM nodes and own properties — some apps hide the namespace on a container.
   * @param {Document} doc
   * @param {string} framePath — for logs (e.g. top/iframe[0]/iframe[1])
   */
  function tryFindMonacoApiOnDomTreeForDocument(doc, framePath) {
    if (!doc || !doc.documentElement) {
      return null;
    }
    const selectors = [
      ".monaco-editor",
      ".monaco-scrollable-element",
      "[class*='monaco-editor']",
      "[class*='Monaco']",
      ".view-lines",
      ".overflow-guard",
      "textarea.inputarea",
    ];
    const nodes = [];
    let s = 0;
    for (; s < selectors.length; s++) {
      try {
        const found = deepQuerySelectorAll(selectors[s], doc.documentElement);
        for (let i = 0; i < found.length; i++) {
          if (nodes.indexOf(found[i]) === -1) {
            nodes.push(found[i]);
          }
        }
      } catch (_) {}
    }
    if (nodes.length > 0) {
      console.log(LOG_PREFIX, "DOM deep scan [" + framePath + "]: monaco-related nodes", nodes.length);
    }
    const maxNodes = 25;
    const maxDepth = 18;
    for (let n = 0; n < Math.min(nodes.length, maxNodes); n++) {
      let cur = nodes[n];
      for (let d = 0; d < maxDepth && cur; d++) {
        let keys = [];
        try {
          keys = Object.getOwnPropertyNames(cur);
        } catch (_) {
          break;
        }
        for (let k = 0; k < keys.length; k++) {
          const name = keys[k];
          if (name.length > 96) {
            continue;
          }
          try {
            const v = cur[name];
            if (isMonacoLike(v)) {
              monacoResolveHint = framePath + " DOMNode." + name + "(nodeDepth" + d + ")";
              console.log(LOG_PREFIX, "Monaco API discovered on DOM property", monacoResolveHint);
              return v;
            }
          } catch (_) {}
        }
        cur = cur.parentElement;
      }
    }
    const fromReact = tryFindMonacoNamespaceViaReactFiber(doc, framePath);
    if (fromReact) {
      return fromReact;
    }
    const fromEditorId = tryFindMonacoViaEditorIdentity(doc, framePath);
    if (fromEditorId) {
      return fromEditorId;
    }
    return null;
  }

  /**
   * Cheap: only window.monaco on top + every same-origin nested iframe (editor often lives in iframe).
   */
  function tryMonacoGlobalInNestedFrames(win, depth, framePath) {
    if (!win || depth > 14) {
      return null;
    }
    try {
      if (isMonacoLike(win.monaco)) {
        monacoResolveHint = framePath + ".monaco";
        console.log(LOG_PREFIX, "Monaco API (window.monaco) at", monacoResolveHint);
        return win.monaco;
      }
    } catch (_) {}
    let iframes;
    try {
      iframes = win.document.querySelectorAll("iframe");
    } catch (_) {
      return null;
    }
    for (let i = 0; i < iframes.length; i++) {
      try {
        const inner = iframes[i].contentWindow;
        if (!inner || inner === win) {
          continue;
        }
        const sub = tryMonacoGlobalInNestedFrames(inner, depth + 1, framePath + "/iframe[" + i + "]");
        if (sub) {
          return sub;
        }
      } catch (e) {
        /* cross-origin */
      }
    }
    return null;
  }

  /**
   * Expensive DOM scan in top document + every reachable same-origin iframe document.
   */
  function tryMonacoDomScanInNestedFrames(win, depth, framePath) {
    if (!win || depth > 14) {
      return null;
    }
    let doc = null;
    try {
      doc = win.document;
    } catch (_) {
      return null;
    }
    const fromDom = tryFindMonacoApiOnDomTreeForDocument(doc, framePath);
    if (fromDom) {
      return fromDom;
    }
    let iframes;
    try {
      iframes = doc.querySelectorAll("iframe");
    } catch (_) {
      return null;
    }
    for (let i = 0; i < iframes.length; i++) {
      try {
        const inner = iframes[i].contentWindow;
        if (!inner || inner === win) {
          continue;
        }
        const sub = tryMonacoDomScanInNestedFrames(inner, depth + 1, framePath + "/iframe[" + i + "]");
        if (sub) {
          return sub;
        }
      } catch (_) {}
    }
    return null;
  }

  function resolveMonacoFromWindow(win) {
    if (!win) {
      return null;
    }
    if (!bundlerProbeLogged) {
      bundlerProbeLogged = true;
      try {
        const wr = window.__webpack_require__;
        const n = wr && wr.m ? Object.keys(wr.m).length : 0;
        console.log(LOG_PREFIX, "bundler probe (once)", {
          hasWebpackRequire: typeof wr === "function",
          webpackModuleCount: n,
        });
        if (typeof wr !== "function") {
          console.log(
            LOG_PREFIX,
            "no window.__webpack_require__ — bundle is likely Vite/Rollup ESM; rely on React editor-identity + fiber"
          );
        }
      } catch (e) {
        console.warn(LOG_PREFIX, "bundler probe failed", e);
      }
    }
    try {
      if (isMonacoLike(win.monaco)) {
        monacoResolveHint = "window.monaco";
        return win.monaco;
      }
    } catch (e) {
      console.warn(LOG_PREFIX, "resolveMonacoFromWindow: access window.monaco failed", e);
    }

    const framesToTry = [];
    try {
      if (win.parent && win.parent !== win) {
        framesToTry.push({ w: win.parent, name: "parent" });
      }
    } catch (e) {
      console.warn(LOG_PREFIX, "cannot access parent frame (cross-origin?)", e.message);
    }
    try {
      if (win.top && win.top !== win) {
        framesToTry.push({ w: win.top, name: "top" });
      }
    } catch (e) {
      console.warn(LOG_PREFIX, "cannot access top frame", e.message);
    }

    for (let i = 0; i < framesToTry.length; i++) {
      const entry = framesToTry[i];
      try {
        if (isMonacoLike(entry.w.monaco)) {
          monacoResolveHint = "window." + entry.name + ".monaco";
          console.log(LOG_PREFIX, "Monaco API found on", monacoResolveHint);
          return entry.w.monaco;
        }
      } catch (e) {
        console.warn(LOG_PREFIX, "cannot read monaco from " + entry.name, e.message);
      }
    }

    const fromFrames = tryGetMonacoFromChildFrames(win);
    if (fromFrames) {
      return fromFrames;
    }

    const fromNestedGlobal = tryMonacoGlobalInNestedFrames(win, 0, "top");
    if (fromNestedGlobal) {
      return fromNestedGlobal;
    }

    let checked = 0;
    const maxKeys = 400;
    try {
      const keys = Object.keys(win);
      for (let k = 0; k < keys.length && checked < maxKeys; k++) {
        const name = keys[k];
        if (name.length > 64) {
          continue;
        }
        checked++;
        try {
          const v = win[name];
          if (isMonacoLike(v)) {
            monacoResolveHint = "window[" + JSON.stringify(name) + "]";
            console.log(LOG_PREFIX, "Monaco-like global discovered:", monacoResolveHint);
            return v;
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn(LOG_PREFIX, "Object.keys(window) scan failed", e);
    }

    const fromWebpack = tryFindMonacoViaWebpackThrottled();
    if (fromWebpack) {
      return fromWebpack;
    }

    const nowEditor = Date.now();
    if (nowEditor - lastEditorIdentityProbeAt >= EDITOR_IDENTITY_PROBE_INTERVAL_MS) {
      lastEditorIdentityProbeAt = nowEditor;
      try {
        const fromIdTop = tryFindMonacoViaEditorIdentity(win.document, "top");
        if (fromIdTop) {
          return fromIdTop;
        }
      } catch (e) {
        console.warn(LOG_PREFIX, "tryFindMonacoViaEditorIdentity(top) failed", e);
      }
    }

    const nowMs = Date.now();
    if (nowMs - lastDomMonacoScanAt >= DOM_MONACO_SCAN_INTERVAL_MS) {
      lastDomMonacoScanAt = nowMs;
      const fromDomNested = tryMonacoDomScanInNestedFrames(win, 0, "top");
      if (fromDomNested) {
        return fromDomNested;
      }
    }

    return null;
  }

  /**
   * Partial Monaco cache holds a stale ICodeEditor after React tears down a code node.
   * DOM/identity probes are throttled; reset timers so the next resolve can find the new editor.
   */
  function invalidateMonacoApiCache(reason) {
    if (!cachedMonacoApi) {
      lastDomMonacoScanAt = 0;
      lastEditorIdentityProbeAt = 0;
      return;
    }
    console.log(LOG_PREFIX, "invalidateMonacoApiCache", reason || "");
    cachedMonacoApi = null;
    lastDomMonacoScanAt = 0;
    lastEditorIdentityProbeAt = 0;
    try {
      if (lastFocusedEditor && typeof lastFocusedEditor.getModel === "function") {
        const m = lastFocusedEditor.getModel();
        if (!m || (typeof m.isDisposed === "function" && m.isDisposed())) {
          lastFocusedEditor = null;
        }
      }
    } catch (_) {
      lastFocusedEditor = null;
    }
  }

  /** Prefer focused editor, else longest model text (avoids picking an empty placeholder over the real tab). */
  function pickBestEditorFromMonacoApi(M) {
    if (!M || !M.editor) {
      return null;
    }
    try {
      const editors = typeof M.editor.getEditors === "function" ? M.editor.getEditors() : [];
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < editors.length; i++) {
        const ed = editors[i];
        try {
          const m = ed && ed.getModel ? ed.getModel() : null;
          if (!m) {
            continue;
          }
          if (typeof m.isDisposed === "function" && m.isDisposed()) {
            continue;
          }
          const len = m.getValue().length;
          let sc = len;
          if (typeof ed.hasTextFocus === "function" && ed.hasTextFocus()) {
            sc += 1000000000;
          }
          if (sc > bestScore) {
            bestScore = sc;
            best = ed;
          }
        } catch (_) {}
      }
      return best;
    } catch (e) {
      console.warn(LOG_PREFIX, "pickBestEditorFromMonacoApi failed", e);
      return null;
    }
  }

  function getMonacoApi() {
    if (cachedMonacoApi && cachedMonacoApi.editor) {
      if (!pickBestEditorFromMonacoApi(cachedMonacoApi)) {
        invalidateMonacoApiCache("cached API has no usable editor");
      }
    }
    if (cachedMonacoApi && cachedMonacoApi.editor) {
      return cachedMonacoApi;
    }
    const resolved = resolveMonacoFromWindow(window);
    if (resolved) {
      cachedMonacoApi = resolved;
    }
    return cachedMonacoApi;
  }

  /**
   * Monaco embeds often never fire onDidFocusEditorWidget; overlay textarea steals focus before Apply.
   * Same-origin iframes: compare all candidates and pick best score (focus + content length).
   */
  function getActiveEditor() {
    try {
      if (lastFocusedEditor && typeof lastFocusedEditor.getModel === "function") {
        const m = lastFocusedEditor.getModel();
        if (m && !(typeof m.isDisposed === "function" && m.isDisposed())) {
          return lastFocusedEditor;
        }
      }
    } catch (_) {}

    let bestEd = null;
    let bestApi = null;
    let bestScore = -1;
    let bestIframeIdx = -1;

    function consider(api, iframeIdx) {
      if (!api || !api.editor) {
        return;
      }
      const ed = pickBestEditorFromMonacoApi(api);
      if (!ed) {
        return;
      }
      let m;
      try {
        m = ed.getModel();
        if (!m || (typeof m.isDisposed === "function" && m.isDisposed())) {
          return;
        }
      } catch (_) {
        return;
      }
      const len = m.getValue().length;
      let sc = len;
      try {
        if (typeof ed.hasTextFocus === "function" && ed.hasTextFocus()) {
          sc += 1000000000;
        }
      } catch (_) {}
      if (sc > bestScore) {
        bestScore = sc;
        bestEd = ed;
        bestApi = api;
        bestIframeIdx = typeof iframeIdx === "number" ? iframeIdx : -1;
      }
    }

    consider(getMonacoApi(), null);

    let iframes;
    try {
      iframes = document.querySelectorAll("iframe");
    } catch (_) {
      iframes = [];
    }
    for (let i = 0; i < iframes.length; i++) {
      let cw = null;
      try {
        cw = iframes[i].contentWindow;
      } catch (e) {
        continue;
      }
      if (!cw || cw === window) {
        continue;
      }
      try {
        consider(resolveMonacoFromWindow(cw), i);
      } catch (e) {
        console.warn(LOG_PREFIX, "iframe monaco probe failed", e);
      }
    }

    if (bestEd && bestApi) {
      cachedMonacoApi = bestApi;
      if (bestIframeIdx >= 0) {
        console.log(
          LOG_PREFIX,
          "getActiveEditor: best editor from iframe",
          bestIframeIdx,
          "score",
          bestScore
        );
      } else {
        console.log(LOG_PREFIX, "getActiveEditor: best editor from top score", bestScore);
      }
      return bestEd;
    }
    return null;
  }

  function logMonacoDiagnostics(reason) {
    const domSig = countMonacoDomSignals();
    console.warn(LOG_PREFIX, "Monaco API not available — diagnostic (" + reason + ")", {
      href: window.location.href,
      isTop: window === window.top,
      hasWindowMonaco: !!window.monaco,
      monacoEditorInLightDom: domSig.lightMonacoEditor,
      monacoEditorIncludingShadowRoots: domSig.deepMonacoEditor,
      viewLinesDeep: domSig.deepViewLines,
      elementsWithClassContainingMonacoDeep: domSig.deepClassMonaco,
      iframeCount: domSig.iframeCount,
      sameOriginIframeDocsReached: domSig.accessibleNestedFrames,
      crossOriginIframeSkips: domSig.crossOriginIframeSkips,
      hint: (function hint() {
        if (domSig.deepMonacoEditor > 0 && domSig.lightMonacoEditor === 0) {
          return "Monaco DOM in Shadow DOM in this frame (light count 0 but deep > 0)";
        }
        if (domSig.deepViewLines > 0 && domSig.deepMonacoEditor === 0) {
          return "Found .view-lines but not .monaco-editor — possible non-Monaco editor or different markup";
        }
        if (domSig.iframeCount > 0 && domSig.crossOriginIframeSkips > 0 && domSig.deepMonacoEditor === 0) {
          return "If editor is in a cross-origin iframe, this page cannot access it; extension must match that URL or use native messaging";
        }
        if (domSig.iframeCount > 0 && domSig.deepMonacoEditor === 0) {
          return "Monaco may be inside a nested same-origin iframe — extension now scans iframe documents; reload and check logs for top/iframe[…].monaco";
        }
        return "";
      })(),
      cachedResolveHint: monacoResolveHint || "(none yet)",
    });
    try {
      if (window.parent && window.parent !== window) {
        console.warn(LOG_PREFIX, "parent frame has window.monaco:", !!window.parent.monaco);
      }
    } catch (e) {
      console.warn(LOG_PREFIX, "parent frame inaccessible", e.message);
    }
  }

  function trySetupMonaco() {
    const monaco = getMonacoApi();
    if (!monaco || !monaco.editor) {
      return false;
    }
    if (!monacoReady) {
      monacoReady = true;
      console.log(
        LOG_PREFIX,
        "Monaco API found at",
        performance.now(),
        "via",
        monacoResolveHint || (monaco._partial ? "partial:ICodeEditor" : "unknown"),
        monaco._partial ? "[partial: Cmd+I + backend OK; ghost Tab needs full monaco.languages]" : ""
      );
      wireOnDidCreateEditor(monaco);
      try {
        const editors = monaco.editor.getEditors();
        console.log(LOG_PREFIX, "initial getEditors() count", editors.length);
        editors.forEach(function (ed) {
          hookEditor(monaco, ed);
        });
      } catch (e) {
        console.warn(LOG_PREFIX, "getEditors initial pass failed", e);
      }
    }
    return true;
  }

  function wireOnDidCreateEditor(monaco) {
    if (typeof monaco.editor.onDidCreateEditor !== "function") {
      console.warn(LOG_PREFIX, "onDidCreateEditor missing — falling back to polling editors only");
      return;
    }
    monaco.editor.onDidCreateEditor(function (editor) {
      console.log(LOG_PREFIX, "onDidCreateEditor new editor instance at", performance.now());
      hookEditor(monaco, editor);
    });
  }

  function hookEditor(monaco, editor) {
    if (!editor || !editor.getModel) {
      return;
    }
    if (hookedEditors.has(editor)) {
      return;
    }
    hookedEditors.add(editor);
    console.log(LOG_PREFIX, "hookEditor", editor.getId ? editor.getId() : "unknown-id");

    editor.onDidFocusEditorWidget(function () {
      lastFocusedEditor = editor;
      console.log(LOG_PREFIX, "editor focused", editor.getModel()?.uri?.toString());
    });

    const model = editor.getModel();
    if (model) {
      /* model attached */
    }

    editor.onDidChangeModel(function () {
      /* model changed */
    });
  }

  /**
   * If the app assigns `window.monaco` after our script runs, hook the setter once.
   */
  function installWindowMonacoSetterTrap() {
    try {
      const desc = Object.getOwnPropertyDescriptor(window, "monaco");
      if (desc && desc.configurable === false) {
        console.log(LOG_PREFIX, "window.monaco non-configurable — skip setter trap");
        return;
      }
      let internal = window.monaco;
      Object.defineProperty(window, "monaco", {
        configurable: true,
        enumerable: true,
        get: function () {
          return internal;
        },
        set: function (v) {
          internal = v;
          console.log(LOG_PREFIX, "window.monaco assigned (lazy)");
          if (isMonacoLike(v)) {
            cachedMonacoApi = v;
            monacoResolveHint = "window.monaco(lazy)";
            if (!monacoReady) {
              trySetupMonaco();
            }
          }
        },
      });
    } catch (e) {
      console.warn(LOG_PREFIX, "installWindowMonacoSetterTrap failed", e);
    }
  }

  installWindowMonacoSetterTrap();

  /** Poll until monaco exists --- */
  const pollStart = performance.now();
  const poll = setInterval(function () {
    if (trySetupMonaco()) {
      clearInterval(poll);
      console.log(LOG_PREFIX, "Monaco poll ended after ms", Math.round(performance.now() - pollStart));
    } else if (performance.now() - pollStart > 120000) {
      clearInterval(poll);
      console.warn(LOG_PREFIX, "Monaco poll timed out (120s)");
      logMonacoDiagnostics("poll timeout");
    }
  }, 100);

  window.addEventListener("load", function onWinLoad() {
    console.log(LOG_PREFIX, "window load — retry trySetupMonaco");
    trySetupMonaco();
  });

  if (document.body) {
    try {
      const obs = new MutationObserver(function () {
        trySetupMonaco();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      console.warn(LOG_PREFIX, "MutationObserver not available", e);
    }
  }

  CCP.handlers = CCP.handlers || {};
  if (typeof handleGetSelectionRequest === "function")
    CCP.handlers.handleGetSelectionRequest = handleGetSelectionRequest;
  if (typeof handleEditChunk === "function") CCP.handlers.handleEditChunk = handleEditChunk;
  if (typeof handleEditDone === "function") CCP.handlers.handleEditDone = handleEditDone;
  if (typeof finishEditStream === "function") CCP.handlers.finishEditStream = finishEditStream;
  CCP.handlers.resetEditStreamState = function () {
    if (typeof editStreamState !== "undefined") editStreamState = null;
    if (typeof streamTargetEditor !== "undefined") streamTargetEditor = null;
    if (typeof streamPinnedRange !== "undefined") streamPinnedRange = null;
    console.log(LOG_PREFIX, "GET_EDITOR_SELECTION_REQUEST — edit stream state cleared");
  };
  CCP.monacoBridge = CCP.monacoBridge || {};
  CCP.monacoBridge.getMonacoApi = function () {
    return getMonacoApi();
  };
  CCP.monacoBridge.getActiveEditor = function () {
    return getActiveEditor();
  };
})();

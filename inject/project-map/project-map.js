/**
 * Cognigy Project-Map — main class.
 *
 * Self-contained `EventTarget` subclass that owns all per-project state
 * (flows + nodes, extension specs, LLMs incl. connection-test blobs,
 * project connections, issue list). Mirrors the Python `CognigyProjectMap`
 * in `cognigy_copilot_code/cognigy_project_map.py` in behaviour and in
 * persistence shape, adapted to the browser:
 *
 *   - API access goes through `apiClient` (built by `api-client.js`); the
 *     bearer token + base URL come from `setApiContext(...)`.
 *   - Persistence lives in IndexedDB via `storage` (built by `storage.js`).
 *   - Issue detection uses the pure-function helpers in `issues.js`.
 *   - Structured execution-order JSON is built by `structured-json.js`.
 *
 * The class never touches the DOM and knows nothing about the
 * fetch / XHR / monaco wiring — `naming/state.js` calls into the
 * `handle*FromIntercept` hooks, and `flow-code/editor.js` consumes events
 * from the map.
 *
 * Lifecycle:
 *   - Constructor is cheap, sets up empty caches.
 *   - `setApiContext({ bearerToken, baseUrl })` is called as soon as the
 *     UI hands us credentials; the first such call auto-fires `init()`.
 *   - `init()` hydrates from IndexedDB, then does a `_syncFromApi` and
 *     `_loadExtensions` / `_loadLlms` / `_loadConnections` in parallel.
 *
 * Events (all `CustomEvent`):
 *   - `init-started`, `init-finished` (detail: { fromStorage, durationMs })
 *   - `flows-changed`, `chart-changed` (detail: { flowId })
 *   - `extensions-changed`, `llms-changed`, `connections-changed`
 *   - `issues-changed` (detail: { issues, currentFlowId })
 *   - `load-progress` (detail: { stage, done, total })
 *   - `error` (detail: { stage, error })
 */
(function ccpProjectMapClassModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const pm = (CCP.projectMap = CCP.projectMap || {});

  if (pm.CognigyProjectMap) {
    return;
  }

  const constants = pm.constants;
  const issuesMod = pm.issues;
  const StructuredJsonCtor = pm.CognigyFlowNodesInExecutionOrder;
  if (!constants || !issuesMod || !StructuredJsonCtor) {
    console.warn(
      "[CCP project-map] dependencies missing (constants/issues/structured-json) — module will be a no-op"
    );
    return;
  }

  const LOG_PREFIX = "[CCP project-map]";

  const FLOW_FETCH_CONCURRENCY = 16;
  const NODE_FETCH_CONCURRENCY = 16;
  const EXTENSION_FETCH_CONCURRENCY = 16;
  const LLM_TEST_CONCURRENCY = 16;
  const CONNECTION_FETCH_CONCURRENCY = 16;
  const RECOMPUTE_DEBOUNCE_MS = 220;

  // ---------------------------------------------------------------------
  // Tiny utilities
  // ---------------------------------------------------------------------

  function isPlainObject(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  function idOf(obj) {
    if (!isPlainObject(obj)) return "";
    return String(obj.id || obj._id || "");
  }

  function referenceIdOf(obj) {
    if (!isPlainObject(obj)) return "";
    return String(obj.reference_id || obj.referenceId || "");
  }

  function lastChangedOf(obj) {
    if (!isPlainObject(obj)) return -1;
    const v = obj.last_changed !== undefined ? obj.last_changed : obj.lastChanged;
    if (v === null || v === undefined) return -1;
    const n = Number(v);
    return Number.isFinite(n) ? n : -1;
  }

  function nextNodeIdOf(n) {
    if (!isPlainObject(n)) return null;
    return n.next_node_id !== undefined ? n.next_node_id : n.nextNodeId;
  }

  function childNodeIdsOf(n) {
    if (!isPlainObject(n)) return [];
    const v = n.child_node_ids !== undefined ? n.child_node_ids : n.childNodeIds;
    return Array.isArray(v) ? v : [];
  }

  // Run `fn(item)` for each entry in `items` with at most `concurrency` calls
  // in flight at once. Returns a Promise resolving to the per-item result
  // array (same order as `items`). Errors are returned as the rejection
  // reason of the corresponding entry rather than aborting the batch.
  function parallelMap(items, fn, concurrency, onEachDone) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const results = new Array(total);
    let inflight = 0;
    let nextIndex = 0;
    let done = 0;
    return new Promise(function (resolve) {
      if (!total) {
        resolve(results);
        return;
      }
      const limit = Math.max(1, Math.min(concurrency || 1, total));

      function dispatch() {
        while (inflight < limit && nextIndex < total) {
          const i = nextIndex++;
          inflight++;
          Promise.resolve()
            .then(function () {
              return fn(list[i], i);
            })
            .then(
              function (res) {
                results[i] = { ok: true, value: res };
              },
              function (err) {
                results[i] = { ok: false, error: err };
              }
            )
            .then(function () {
              inflight--;
              done++;
              if (typeof onEachDone === "function") {
                try {
                  onEachDone(done, total);
                } catch (_) {}
              }
              if (done >= total) {
                resolve(results);
              } else {
                dispatch();
              }
            });
        }
      }
      dispatch();
    });
  }

  // ---------------------------------------------------------------------
  // Chart / node helpers
  // ---------------------------------------------------------------------

  function relationsMapFromChart(chartData) {
    const relations = Array.isArray(chartData && chartData.relations)
      ? chartData.relations
      : Array.isArray(chartData && chartData.edges)
        ? chartData.edges
        : [];
    const map = new Map();
    for (let i = 0; i < relations.length; i++) {
      const rel = relations[i];
      if (!isPlainObject(rel)) continue;
      const parent = String(
        rel.node ||
          rel.parent ||
          rel.parentId ||
          rel.parentNodeId ||
          rel.source ||
          rel.from ||
          rel.nodeId ||
          ""
      );
      if (!parent) continue;
      const nextRaw =
        rel.next !== undefined
          ? rel.next
          : rel.nextNodeId !== undefined
            ? rel.nextNodeId
            : rel.next_node_id !== undefined
              ? rel.next_node_id
              : null;
      let children = Array.isArray(rel.children)
        ? rel.children
        : Array.isArray(rel.childNodes)
          ? rel.childNodes
          : Array.isArray(rel.childNodeIds)
            ? rel.childNodeIds
            : Array.isArray(rel.child_node_ids)
              ? rel.child_node_ids
              : Array.isArray(rel.targets)
                ? rel.targets
                : Array.isArray(rel.to)
                  ? rel.to
                  : [];
      if (!children.length) {
        const single = rel.child || rel.target;
        if (single) children = [single];
      }
      map.set(parent, {
        next: nextRaw ? String(nextRaw) : null,
        children: children.map(String).filter(Boolean),
      });
    }
    return map;
  }

  function mergeTopologyIntoNode(node, relationMap) {
    if (!isPlainObject(node)) return node;
    const nid = idOf(node);
    const top = nid ? relationMap.get(nid) : null;
    if (top) {
      node.next_node_id = top.next || null;
      node.nextNodeId = top.next || null;
      node.child_node_ids = (top.children || []).slice();
      node.childNodeIds = (top.children || []).slice();
    } else {
      node.next_node_id = null;
      node.nextNodeId = null;
      node.child_node_ids = [];
      node.childNodeIds = [];
    }
    return node;
  }

  function mergeNodeDetail(summary, detail) {
    const out = Object.assign({}, isPlainObject(summary) ? summary : {});
    if (isPlainObject(detail)) {
      Object.keys(detail).forEach(function (k) {
        out[k] = detail[k];
      });
    }
    return out;
  }

  function buildChartEntryFromMergedNodes(nodes, relations) {
    const out = {
      nodes: Array.isArray(nodes) ? nodes : [],
      relations: relations || [],
      nodesById: new Map(),
      nodesByRefId: new Map(),
      parentByChildId: new Map(),
    };
    for (let i = 0; i < out.nodes.length; i++) {
      const n = out.nodes[i];
      if (!isPlainObject(n)) continue;
      const id = idOf(n);
      const ref = referenceIdOf(n);
      if (id) out.nodesById.set(id, n);
      if (ref) out.nodesByRefId.set(ref, n);
      const children = childNodeIdsOf(n);
      for (let j = 0; j < children.length; j++) {
        if (children[j]) out.parentByChildId.set(String(children[j]), id);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // CognigyProjectMap class
  // ---------------------------------------------------------------------

  class CognigyProjectMap extends EventTarget {
    constructor(options) {
      super();
      const opts = options || {};
      this._projectId = String(opts.projectId || "");
      this._apiClient = opts.apiClient || null;
      this._storage = opts.storage || null;
      this._log = opts.log || function () {};
      this._silenceUnknownNodeTypeWarnings = Boolean(opts.silenceUnknownNodeTypeWarnings);

      this._flows = [];
      this._chartEntries = new Map(); // flowId → chart entry { nodes, nodesById, ... }
      this._extensionSpecs = new Map(); // "ext\x00type" → spec
      this._extensionConnectionDefs = new Map(); // ext → [connection-defs]
      this._llms = [];
      this._connections = [];
      this._connectionsByRef = new Map();

      this._chartFlowRefToId = new Map();
      this._chartFlowIdToRef = new Map();
      this._chartNodeRefToId = new Map();
      this._chartNodeIdToRef = new Map();

      this._issues = [];
      this._currentFlowId = "";
      this._initialized = false;
      this._initPromise = null;
      this._loadedFromStorage = false;

      this._recomputeTimer = null;
      this._suppressRecompute = 0;

      this._apiContext = { bearerToken: "", baseUrl: "" };
    }

    // ----- getters ----------------------------------------------------

    get projectId() {
      return this._projectId;
    }

    get flows() {
      return this._flows.slice();
    }

    get llms() {
      return this._llms.slice();
    }

    get connections() {
      return this._connections.slice();
    }

    get connectionsByReferenceId() {
      return new Map(this._connectionsByRef);
    }

    get extensionSpecs() {
      return new Map(this._extensionSpecs);
    }

    get extensionConnectionDefs() {
      return new Map(this._extensionConnectionDefs);
    }

    get chartFlowReferenceToId() {
      return new Map(this._chartFlowRefToId);
    }

    get chartFlowIdToReference() {
      return new Map(this._chartFlowIdToRef);
    }

    get chartNodeReferenceToId() {
      return new Map(this._chartNodeRefToId);
    }

    get chartNodeIdToReference() {
      return new Map(this._chartNodeIdToRef);
    }

    get issues() {
      return this._issues.slice();
    }

    getFlow(flowId) {
      if (!flowId) return null;
      const sid = String(flowId);
      for (let i = 0; i < this._flows.length; i++) {
        if (idOf(this._flows[i]) === sid) return this._flows[i];
      }
      return null;
    }

    getFlowByRefId(flowRefId) {
      if (!flowRefId) return null;
      const sref = String(flowRefId);
      for (let i = 0; i < this._flows.length; i++) {
        if (referenceIdOf(this._flows[i]) === sref) return this._flows[i];
      }
      return null;
    }

    getChartEntry(flowId) {
      if (!flowId) return null;
      return this._chartEntries.get(String(flowId)) || null;
    }

    setCurrentFlowId(flowId) {
      const sid = flowId ? String(flowId) : "";
      if (this._currentFlowId === sid) return;
      this._currentFlowId = sid;
      this._emit("current-flow-changed", { flowId: sid });
      this._scheduleRecompute();
    }

    getCurrentFlowId() {
      return this._currentFlowId;
    }

    setApiContext(ctx) {
      const next = {
        bearerToken: String((ctx && ctx.bearerToken) || ""),
        baseUrl: String((ctx && ctx.baseUrl) || ""),
      };
      const changed =
        next.bearerToken !== this._apiContext.bearerToken || next.baseUrl !== this._apiContext.baseUrl;
      this._apiContext = next;
      if (changed && next.bearerToken && next.baseUrl && this._projectId) {
        if (!this._initialized && !this._initPromise) {
          // Auto-init on first credentials.
          this.init().catch(function () {});
        }
      }
    }

    getApiContext() {
      return Object.assign({}, this._apiContext);
    }

    setProjectId(projectId) {
      const next = String(projectId || "");
      if (next === this._projectId) return;
      this._projectId = next;
      this._initialized = false;
      this._initPromise = null;
      this._flows = [];
      this._chartEntries.clear();
      this._extensionSpecs.clear();
      this._extensionConnectionDefs.clear();
      this._llms = [];
      this._connections = [];
      this._connectionsByRef.clear();
      this._chartFlowRefToId.clear();
      this._chartFlowIdToRef.clear();
      this._chartNodeRefToId.clear();
      this._chartNodeIdToRef.clear();
      this._issues = [];
      if (next && this._apiContext.bearerToken && this._apiContext.baseUrl) {
        this.init().catch(function () {});
      }
    }

    // ----- emit helper ------------------------------------------------

    _emit(eventName, detail) {
      try {
        this.dispatchEvent(new CustomEvent(eventName, { detail: detail || {} }));
      } catch (e) {
        // EventTarget swallows handler errors; we still warn so they
        // don't disappear silently.
        console.warn(LOG_PREFIX, "dispatch failed", eventName, e);
      }
    }

    _emitProgress(stage, done, total) {
      this._emit("load-progress", { stage, done, total });
    }

    // ----- init / reload ---------------------------------------------

    init() {
      if (this._initPromise) return this._initPromise;
      const map = this;
      const t0 = performance.now();
      map._emit("init-started", { projectId: map._projectId });
      this._initPromise = (async function () {
        let fromStorage = false;
        try {
          fromStorage = await map._loadFromStorage();
        } catch (e) {
          console.warn(LOG_PREFIX, "loadFromStorage failed", e);
        }
        map._loadedFromStorage = fromStorage;
        if (fromStorage) {
          map._suppressRecompute++;
          try {
            map._scheduleRecompute();
            map._emit("flows-changed", {});
            map._emit("extensions-changed", {});
            map._emit("llms-changed", {});
            map._emit("connections-changed", {});
          } finally {
            map._suppressRecompute--;
          }
        }

        // Always sync the flow list (last_changed-based) and re-load
        // extensions / LLMs / connections from the API so the in-memory
        // snapshot is current. We run them sequentially with concurrent
        // inner fan-out — much like the Python `__init__`.
        try {
          await map._syncFromApi({ force: !fromStorage });
        } catch (e) {
          map._emit("error", { stage: "sync", error: e });
          console.warn(LOG_PREFIX, "syncFromApi failed", e);
        }
        try {
          await map._loadExtensions();
        } catch (e) {
          map._emit("error", { stage: "extensions", error: e });
          console.warn(LOG_PREFIX, "loadExtensions failed", e);
        }
        try {
          await map._loadLlms();
        } catch (e) {
          map._emit("error", { stage: "llms", error: e });
          console.warn(LOG_PREFIX, "loadLlms failed", e);
        }
        try {
          await map._loadConnections();
        } catch (e) {
          map._emit("error", { stage: "connections", error: e });
          console.warn(LOG_PREFIX, "loadConnections failed", e);
        }
        map._initialized = true;
        map._scheduleSave();
        map._scheduleRecompute(0);
        map._emitProgress("done", 1, 1);
        const durationMs = performance.now() - t0;
        map._emit("init-finished", { fromStorage, durationMs });
      })();
      return this._initPromise;
    }

    async reload(opts) {
      const o = opts || {};
      this._emit("init-started", { projectId: this._projectId, isReload: true });
      const t0 = performance.now();
      try {
        await this._syncFromApi({ force: !!o.force });
      } catch (e) {
        this._emit("error", { stage: "sync", error: e });
      }
      try {
        await this._loadExtensions();
      } catch (e) {
        this._emit("error", { stage: "extensions", error: e });
      }
      try {
        await this._loadLlms();
      } catch (e) {
        this._emit("error", { stage: "llms", error: e });
      }
      try {
        await this._loadConnections();
      } catch (e) {
        this._emit("error", { stage: "connections", error: e });
      }
      this._scheduleSave();
      this._scheduleRecompute(0);
      const durationMs = performance.now() - t0;
      this._emit("init-finished", {
        fromStorage: false,
        isReload: true,
        durationMs,
      });
    }

    async reloadFlow(flowId, opts) {
      if (!flowId || !this._apiClient) return null;
      const o = opts || {};
      const sid = String(flowId);
      try {
        const flowObj = await this._apiClient.getFlow(sid);
        if (!flowObj) return null;
        const idx = this._flows.findIndex(function (f) {
          return idOf(f) === sid;
        });
        const cached = idx >= 0 ? this._flows[idx] : null;
        const apiLc = lastChangedOf(flowObj);
        const cachedLc = lastChangedOf(cached);
        const record = Object.assign({}, flowObj);
        if (o.force || cached === null || apiLc > cachedLc) {
          record.nodes = o.chartOnly
            ? await this._loadChartNodesForFlowId(sid)
            : await this._loadNodesForFlowId(sid);
        } else {
          record.nodes = (cached && cached.nodes && cached.nodes.slice()) || [];
        }
        if (idx < 0) this._flows.push(record);
        else this._flows[idx] = record;
        this._sortFlows();
        this._rebuildChartReferenceMaps();
        const chart = buildChartEntryFromMergedNodes(record.nodes, []);
        this._chartEntries.set(sid, chart);
        this._scheduleSave();
        this._emit("chart-changed", { flowId: sid });
        this._emit("flows-changed", {});
        this._scheduleRecompute();
        return record;
      } catch (e) {
        this._emit("error", { stage: "reloadFlow", error: e, flowId: sid });
        console.warn(LOG_PREFIX, "reloadFlow failed", flowId, e);
        return null;
      }
    }

    async reloadNode(flowId, nodeId) {
      if (!flowId || !nodeId || !this._apiClient) return null;
      const sid = String(flowId);
      const nidStr = String(nodeId);
      try {
        const chart = await this._apiClient.getChart(sid);
        const relMap = relationsMapFromChart(chart);
        const detailed = await this._apiClient.getNode(sid, nidStr);
        if (!detailed) return null;
        mergeTopologyIntoNode(detailed, relMap);
        const rec = this.getFlow(sid);
        if (rec) {
          const nodes = rec.nodes || [];
          let found = false;
          for (let i = 0; i < nodes.length; i++) {
            if (idOf(nodes[i]) === nidStr) {
              nodes[i] = detailed;
              found = true;
              break;
            }
          }
          if (!found) nodes.push(detailed);
          rec.nodes = nodes;
          const chartEntry = buildChartEntryFromMergedNodes(nodes, []);
          this._chartEntries.set(sid, chartEntry);
        }
        try {
          const flowFresh = await this._apiClient.getFlow(sid);
          if (flowFresh && rec) {
            Object.keys(flowFresh).forEach(function (k) {
              if (k !== "nodes") rec[k] = flowFresh[k];
            });
          }
        } catch (_) {}
        this._sortFlows();
        this._rebuildChartReferenceMaps();
        this._scheduleSave();
        this._emit("chart-changed", { flowId: sid });
        this._scheduleRecompute();
        return detailed;
      } catch (e) {
        this._emit("error", { stage: "reloadNode", error: e, flowId: sid, nodeId: nidStr });
        return null;
      }
    }

    async reloadExtensions() {
      try {
        await this._loadExtensions();
        this._scheduleSave();
      } catch (e) {
        this._emit("error", { stage: "extensions", error: e });
      }
    }

    async reloadLlms() {
      try {
        await this._loadLlms();
        this._scheduleSave();
      } catch (e) {
        this._emit("error", { stage: "llms", error: e });
      }
    }

    async reloadConnections() {
      try {
        await this._loadConnections();
        this._scheduleSave();
      } catch (e) {
        this._emit("error", { stage: "connections", error: e });
      }
    }

    // ----- storage ----------------------------------------------------

    async _loadFromStorage() {
      if (!this._storage || !this._projectId) return false;
      const payload = await this._storage.loadProjectMap(this._projectId);
      if (!payload || typeof payload !== "object") return false;
      if (payload.project_id && String(payload.project_id) !== this._projectId) {
        return false;
      }
      this._flows = Array.isArray(payload.flows) ? payload.flows : [];
      this._sortFlows();
      this._rebuildChartReferenceMaps();
      this._chartEntries.clear();
      for (let i = 0; i < this._flows.length; i++) {
        const f = this._flows[i];
        const id = idOf(f);
        if (!id) continue;
        const nodes = Array.isArray(f.nodes) ? f.nodes : [];
        this._chartEntries.set(id, buildChartEntryFromMergedNodes(nodes, []));
      }
      this._extensionSpecs.clear();
      const cachedExts = Array.isArray(payload.extensions) ? payload.extensions : [];
      for (let i = 0; i < cachedExts.length; i++) {
        const spec = cachedExts[i];
        if (!spec || typeof spec !== "object") continue;
        const key = String(spec.extension || "") + "\x00" + String(spec.type || "");
        this._extensionSpecs.set(key, spec);
      }
      this._llms = Array.isArray(payload.llms) ? payload.llms : [];
      this._connections = Array.isArray(payload.connections) ? payload.connections : [];
      this._connectionsByRef.clear();
      for (let i = 0; i < this._connections.length; i++) {
        const r = referenceIdOf(this._connections[i]);
        if (r) this._connectionsByRef.set(r, this._connections[i]);
      }
      return true;
    }

    _serializeForStorage() {
      const exts = [];
      this._extensionSpecs.forEach(function (v) {
        exts.push(v);
      });
      return {
        project_id: this._projectId,
        flows: this._flows,
        extensions: exts,
        llms: this._llms,
        connections: this._connections,
      };
    }

    _scheduleSave() {
      if (!this._storage || !this._projectId) return;
      try {
        this._storage.scheduleSave(this._serializeForStorage());
      } catch (e) {
        console.warn(LOG_PREFIX, "scheduleSave failed", e);
      }
    }

    // ----- sync / load helpers ---------------------------------------

    _sortFlows() {
      const big = Math.pow(2, 31);
      this._flows.sort(function (a, b) {
        const av = lastChangedOf(a);
        const bv = lastChangedOf(b);
        const aKey = av < 0 ? big : av;
        const bKey = bv < 0 ? big : bv;
        return aKey - bKey;
      });
    }

    _rebuildChartReferenceMaps() {
      const fr2i = new Map();
      const fi2r = new Map();
      const nr2i = new Map();
      const ni2r = new Map();
      for (let i = 0; i < this._flows.length; i++) {
        const fd = this._flows[i];
        const fid = idOf(fd);
        const fr = referenceIdOf(fd);
        if (fid && fr) {
          fr2i.set(fr, fid);
          fi2r.set(fid, fr);
        }
        const nodes = Array.isArray(fd.nodes) ? fd.nodes : [];
        for (let j = 0; j < nodes.length; j++) {
          const n = nodes[j];
          const nid = idOf(n);
          const nr = referenceIdOf(n);
          if (nid && nr) {
            nr2i.set(nr, nid);
            ni2r.set(nid, nr);
          }
        }
      }
      this._chartFlowRefToId = fr2i;
      this._chartFlowIdToRef = fi2r;
      this._chartNodeRefToId = nr2i;
      this._chartNodeIdToRef = ni2r;
    }

    async _loadChartNodesForFlowId(flowId) {
      if (!this._apiClient || !flowId) return [];
      const sid = String(flowId);
      const chart = await this._apiClient.getChart(sid);
      if (!chart) return [];
      const summaries = Array.isArray(chart.nodes) ? chart.nodes : [];
      if (!summaries.length) return [];
      const relMap = relationsMapFromChart(chart);
      const out = [];
      for (let i = 0; i < summaries.length; i++) {
        const summary = summaries[i];
        if (!summary) continue;
        const merged = mergeNodeDetail(summary, null);
        mergeTopologyIntoNode(merged, relMap);
        out.push(merged);
      }
      return out;
    }

    async _loadNodesForFlowId(flowId) {
      if (!this._apiClient || !flowId) return [];
      const sid = String(flowId);
      const chart = await this._apiClient.getChart(sid);
      if (!chart) return [];
      const summaries = Array.isArray(chart.nodes) ? chart.nodes : [];
      if (!summaries.length) return [];
      const relMap = relationsMapFromChart(chart);
      const map = this;
      const results = await parallelMap(
        summaries,
        async function (summary) {
          const nid = idOf(summary);
          if (!nid) return null;
          let detail = null;
          try {
            detail = await map._apiClient.getNode(sid, nid);
          } catch (e) {
            // Use summary alone if detail fetch fails.
            map._log("getNode failed", sid, nid, e);
          }
          const merged = mergeNodeDetail(summary, detail);
          mergeTopologyIntoNode(merged, relMap);
          return merged;
        },
        NODE_FETCH_CONCURRENCY,
        function (done, total) {
          map._emitProgress("flow-nodes:" + sid, done, total);
        }
      );
      const out = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && r.ok && r.value) out.push(r.value);
      }
      return out;
    }

    async _syncFromApi(opts) {
      if (!this._apiClient || !this._projectId) return;
      const force = !!(opts && opts.force);
      this._emitProgress("flows-list", 0, 1);
      const flowList = await this._apiClient.listFlows(this._projectId);
      this._emitProgress("flows-list", 1, 1);
      if (!Array.isArray(flowList)) return;
      this._emit("load-progress", {
        stage: "flows-enumerated",
        done: 0,
        total: flowList.length,
        flows: flowList.map(function (f) {
          return { id: idOf(f), name: String(f.name || idOf(f) || "") };
        }),
      });

      const cachedById = new Map();
      for (let i = 0; i < this._flows.length; i++) {
        const id = idOf(this._flows[i]);
        if (id) cachedById.set(id, this._flows[i]);
      }
      const apiIds = new Set();
      for (let i = 0; i < flowList.length; i++) {
        const id = idOf(flowList[i]);
        if (id) apiIds.add(id);
      }
      // Drop removed flows.
      const kept = [];
      for (let i = 0; i < this._flows.length; i++) {
        if (apiIds.has(idOf(this._flows[i]))) kept.push(this._flows[i]);
      }
      this._flows = kept;

      const toReload = [];
      const merged = [];
      for (let i = 0; i < flowList.length; i++) {
        const fo = flowList[i];
        const fid = idOf(fo);
        if (!fid) continue;
        const cached = cachedById.get(fid);
        const apiLc = lastChangedOf(fo);
        const cachedLc = lastChangedOf(cached);
        const record = Object.assign({}, fo);
        if (force || !cached || apiLc > cachedLc) {
          toReload.push({ flow: record, id: fid });
          record.nodes = []; // placeholder, filled below
        } else {
          record.nodes = Array.isArray(cached.nodes) ? cached.nodes.slice() : [];
        }
        merged.push(record);
      }

      // Fetch nodes for the flows that need reload (concurrent, capped).
      const map = this;
      if (toReload.length) {
        const concurrency = Math.min(FLOW_FETCH_CONCURRENCY, toReload.length);
        const results = await parallelMap(
          toReload,
          async function (entry) {
            return map._loadNodesForFlowId(entry.id);
          },
          concurrency,
          function (done, total) {
            map._emitProgress("flows-load", done, total);
          }
        );
        for (let i = 0; i < toReload.length; i++) {
          const r = results[i];
          if (r && r.ok) {
            toReload[i].flow.nodes = r.value || [];
          } else {
            toReload[i].flow.nodes = [];
            if (r && !r.ok) {
              this._log("loadNodesForFlowId failed", toReload[i].id, r.error);
            }
          }
        }
      }

      this._flows = merged;
      this._sortFlows();
      this._rebuildChartReferenceMaps();
      // Refresh chart-entry caches from merged nodes.
      this._chartEntries.clear();
      for (let i = 0; i < this._flows.length; i++) {
        const f = this._flows[i];
        const id = idOf(f);
        if (!id) continue;
        this._chartEntries.set(id, buildChartEntryFromMergedNodes(f.nodes || [], []));
      }
      this._emit("flows-changed", {});
    }

    async _loadExtensions() {
      if (!this._apiClient || !this._projectId) return;
      this._emitProgress("extensions-list", 0, 1);
      const items = await this._apiClient.listExtensions(this._projectId);
      this._emitProgress("extensions-list", 1, 1);
      if (!Array.isArray(items) || !items.length) {
        this._extensionSpecs.clear();
        this._extensionConnectionDefs.clear();
        this._emit("extensions-changed", {});
        return;
      }
      const map = this;
      const results = await parallelMap(
        items,
        async function (item) {
          const id = idOf(item);
          if (!id) return null;
          try {
            return await map._apiClient.getExtension(id);
          } catch (e) {
            map._log("getExtension failed", id, e);
            return null;
          }
        },
        EXTENSION_FETCH_CONCURRENCY,
        function (done, total) {
          map._emitProgress("extensions", done, total);
        }
      );

      const specs = new Map();
      const connDefs = new Map();
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r || !r.ok || !r.value) continue;
        const ext = r.value;
        const extName = String(ext.name || "").trim();
        if (!extName) continue;
        const rawNodes = Array.isArray(ext.nodes) ? ext.nodes : [];
        const rawConnections = Array.isArray(ext.connections) ? ext.connections : [];
        if (rawConnections.length) {
          connDefs.set(
            extName,
            rawConnections.map(function (c) {
              return Object.assign({}, c);
            })
          );
        }
        for (let j = 0; j < rawNodes.length; j++) {
          const raw = rawNodes[j];
          if (!raw || typeof raw !== "object") continue;
          /* Python port (ExtensionNodeSpec.from_api): child types come from
             `dependencies.children` first, falling back to
             `constraints.placement.children.whitelist`. The legacy
             `childTypes` / `child_types` fields the API never emits, so they
             are kept only as a last-resort safety net. */
          const deps = raw.dependencies && typeof raw.dependencies === "object" ? raw.dependencies : {};
          const depChildren = Array.isArray(deps.children) ? deps.children : [];
          const constraints = raw.constraints && typeof raw.constraints === "object" ? raw.constraints : {};
          const placement =
            constraints.placement && typeof constraints.placement === "object" ? constraints.placement : {};
          const placementChildren =
            placement.children && typeof placement.children === "object" ? placement.children : {};
          const whitelist = Array.isArray(placementChildren.whitelist) ? placementChildren.whitelist : [];
          let childTypes = depChildren.length ? depChildren.slice() : whitelist.slice();
          if (!childTypes.length) {
            if (Array.isArray(raw.childTypes)) childTypes = raw.childTypes.slice();
            else if (Array.isArray(raw.child_types)) childTypes = raw.child_types.slice();
          }
          childTypes = childTypes.map(function (t) {
            return String(t);
          });
          const spec = {
            extension: extName,
            type: String(raw.type || ""),
            parent_type:
              raw.parentType !== undefined
                ? raw.parentType
                : raw.parent_type !== undefined
                  ? raw.parent_type
                  : null,
            child_types: childTypes,
            fields: Array.isArray(raw.fields) ? raw.fields : [],
            summary: raw.summary || "",
            default_label: raw.defaultLabel || raw.default_label || "",
          };
          if (!spec.type) continue;
          const key = extName + "\x00" + spec.type;
          specs.set(key, spec);
        }
      }
      this._extensionSpecs = specs;
      this._extensionConnectionDefs = connDefs;
      this._emit("extensions-changed", {});
    }

    async _loadLlms() {
      if (!this._apiClient || !this._projectId) return;
      this._emitProgress("llms-list", 0, 1);
      const items = await this._apiClient.listLlms(this._projectId);
      this._emitProgress("llms-list", 1, 1);
      if (!Array.isArray(items) || !items.length) {
        this._llms = [];
        this._emit("llms-changed", {});
        return;
      }
      const llmDicts = items.map(function (it) {
        return Object.assign({}, it);
      });
      const byId = new Map();
      for (let i = 0; i < llmDicts.length; i++) {
        const id = idOf(llmDicts[i]);
        if (id) byId.set(id, llmDicts[i]);
      }
      const map = this;
      const ids = [];
      for (let i = 0; i < items.length; i++) {
        const id = idOf(items[i]);
        if (id) ids.push(id);
      }
      const tests = await parallelMap(
        ids,
        async function (llmId) {
          try {
            const res = await map._apiClient.testLlm(llmId);
            return {
              is_credentials_valid:
                res && res.isCredentialsValid !== undefined
                  ? res.isCredentialsValid
                  : res && res.is_credentials_valid !== undefined
                    ? res.is_credentials_valid
                    : null,
              msg: res && (res.msg !== undefined ? res.msg : null),
              msg_err: res && (res.msgErr !== undefined ? res.msgErr : res.msg_err),
              error: null,
            };
          } catch (e) {
            return {
              is_credentials_valid: null,
              msg: null,
              msg_err: null,
              error: String((e && e.message) || e),
            };
          }
        },
        LLM_TEST_CONCURRENCY,
        function (done, total) {
          map._emitProgress("llm-tests", done, total);
        }
      );
      for (let i = 0; i < ids.length; i++) {
        const r = tests[i];
        const target = byId.get(ids[i]);
        if (target) {
          target.connection_test =
            r && r.ok
              ? r.value
              : {
                  is_credentials_valid: null,
                  msg: null,
                  msg_err: null,
                  error: r && r.error ? String((r.error && r.error.message) || r.error) : null,
                };
        }
      }
      this._llms = llmDicts;
      this._emit("llms-changed", {});
    }

    async _loadConnections() {
      if (!this._apiClient || !this._projectId) return;
      this._emitProgress("connections-list", 0, 1);
      const items = await this._apiClient.listConnections(this._projectId);
      this._emitProgress("connections-list", 1, 1);
      if (!Array.isArray(items) || !items.length) {
        this._connections = [];
        this._connectionsByRef.clear();
        this._emit("connections-changed", {});
        return;
      }
      const map = this;
      const results = await parallelMap(
        items,
        async function (it) {
          const id = idOf(it);
          if (!id) return it;
          try {
            const detail = await map._apiClient.getConnection(id);
            return Object.assign({}, it, detail);
          } catch (e) {
            map._log("getConnection failed", id, e);
            return it;
          }
        },
        CONNECTION_FETCH_CONCURRENCY,
        function (done, total) {
          map._emitProgress("connections", done, total);
        }
      );
      const fetched = [];
      const byRef = new Map();
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && r.ok && r.value) {
          fetched.push(r.value);
          const ref = referenceIdOf(r.value);
          if (ref) byRef.set(ref, r.value);
        }
      }
      this._connections = fetched;
      this._connectionsByRef = byRef;
      this._emit("connections-changed", {});
    }

    // ----- intercept hooks -------------------------------------------

    handleFlowsListResponse(items) {
      if (!Array.isArray(items)) return;
      // Keep a fresh flow list (last-changed-aware diff against cache).
      let changed = false;
      const known = new Map();
      for (let i = 0; i < this._flows.length; i++) {
        const id = idOf(this._flows[i]);
        if (id) known.set(id, this._flows[i]);
      }
      const apiIds = new Set();
      const merged = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const id = idOf(it);
        if (!id) continue;
        apiIds.add(id);
        const cached = known.get(id);
        const apiLc = lastChangedOf(it);
        const cachedLc = lastChangedOf(cached);
        if (!cached) {
          changed = true;
          merged.push(Object.assign({}, it, { nodes: [] }));
        } else {
          const updated = Object.assign({}, cached, it);
          if (!Array.isArray(updated.nodes)) updated.nodes = Array.isArray(cached.nodes) ? cached.nodes : [];
          if (apiLc > cachedLc) changed = true;
          merged.push(updated);
        }
      }
      // Detect removals.
      for (let i = 0; i < this._flows.length; i++) {
        const id = idOf(this._flows[i]);
        if (id && !apiIds.has(id)) changed = true;
      }
      this._flows = merged;
      this._sortFlows();
      this._rebuildChartReferenceMaps();
      if (changed) this._emit("flows-changed", {});
      this._scheduleRecompute();
      this._scheduleSave();
      // If this is our first time seeing flows and we never initialized,
      // kick off a background init for the heavier per-flow data.
      if (!this._initialized && !this._initPromise && this._apiContext.bearerToken) {
        this.init().catch(function () {});
      }
    }

    handleChartResponse(flowId, chartData) {
      if (!flowId || !chartData || typeof chartData !== "object") return;
      const sid = String(flowId);
      const summaries = Array.isArray(chartData.nodes) ? chartData.nodes : [];
      const relMap = relationsMapFromChart(chartData);
      // Carry over detailed nodes from the existing flow if present.
      const existing = this.getFlow(sid);
      const existingById = new Map();
      if (existing && Array.isArray(existing.nodes)) {
        for (let i = 0; i < existing.nodes.length; i++) {
          const n = existing.nodes[i];
          const id = idOf(n);
          if (id) existingById.set(id, n);
        }
      }
      const merged = [];
      const needsDetail = [];
      for (let i = 0; i < summaries.length; i++) {
        const s = summaries[i];
        const id = idOf(s);
        if (!id) continue;
        const prior = existingById.get(id);
        const mergedNode = mergeNodeDetail(prior || {}, s);
        mergeTopologyIntoNode(mergedNode, relMap);
        merged.push(mergedNode);
        // Heuristic: chart summaries lack `config`; if so we still want
        // a detail fetch in the background to feed issue detection.
        if (!prior || prior.config === undefined) {
          needsDetail.push({ nodeId: id, index: merged.length - 1 });
        }
      }

      if (existing) {
        existing.nodes = merged;
      } else {
        const flowRecord = { _id: sid, id: sid, nodes: merged };
        this._flows.push(flowRecord);
        this._sortFlows();
      }
      this._rebuildChartReferenceMaps();
      this._chartEntries.set(sid, buildChartEntryFromMergedNodes(merged, chartData.relations || []));
      this._emit("chart-changed", { flowId: sid });
      this._scheduleRecompute();
      this._scheduleSave();

      // Kick off background detail fetches if we have an API client.
      if (needsDetail.length && this._apiClient) {
        this._fetchMissingNodeDetails(sid, needsDetail);
      }
    }

    _fetchMissingNodeDetails(flowId, list) {
      const map = this;
      const sid = String(flowId);
      // Don't block; fire-and-forget.
      parallelMap(
        list,
        async function (entry) {
          try {
            const detail = await map._apiClient.getNode(sid, entry.nodeId);
            if (!detail) return null;
            const flow = map.getFlow(sid);
            if (!flow || !Array.isArray(flow.nodes)) return null;
            for (let i = 0; i < flow.nodes.length; i++) {
              if (idOf(flow.nodes[i]) === entry.nodeId) {
                const cur = flow.nodes[i];
                const updated = Object.assign({}, cur);
                Object.keys(detail).forEach(function (k) {
                  if (k === "next_node_id" || k === "child_node_ids") return;
                  if (k === "nextNodeId" || k === "childNodeIds") return;
                  updated[k] = detail[k];
                });
                flow.nodes[i] = updated;
                break;
              }
            }
            return detail;
          } catch (e) {
            return null;
          }
        },
        NODE_FETCH_CONCURRENCY,
        function (done, total) {
          map._emitProgress("flow-nodes:" + sid, done, total);
        }
      ).then(function () {
        const chart = map.getFlow(sid);
        if (chart && Array.isArray(chart.nodes)) {
          map._chartEntries.set(sid, buildChartEntryFromMergedNodes(chart.nodes, []));
        }
        map._scheduleRecompute();
        map._scheduleSave();
      });
    }

    handleNodeCreatedFromIntercept(flowId, node) {
      this._upsertNode(flowId, node, { source: "create" });
    }

    handleNodePatchedFromIntercept(flowId, node) {
      this._upsertNode(flowId, node, { source: "patch" });
    }

    handleNodeDeletedFromIntercept(flowId, nodeId) {
      if (!flowId || !nodeId) return;
      const sid = String(flowId);
      const nidStr = String(nodeId);
      const flow = this.getFlow(sid);
      if (flow && Array.isArray(flow.nodes)) {
        flow.nodes = flow.nodes.filter(function (n) {
          return idOf(n) !== nidStr;
        });
        this._chartEntries.set(sid, buildChartEntryFromMergedNodes(flow.nodes, []));
      }
      this._rebuildChartReferenceMaps();
      this._emit("chart-changed", { flowId: sid });
      this._scheduleRecompute();
      this._scheduleSave();
      // Force-reload for topology updates after a delete (next/children
      // pointers on sibling nodes will have shifted).
      if (this._apiClient) {
        this.reloadFlow(sid, { force: true }).catch(function () {});
      }
    }

    _upsertNode(flowId, node, opts) {
      if (!flowId || !isPlainObject(node)) return;
      const sid = String(flowId);
      const nid = idOf(node);
      if (!nid) return;
      let flow = this.getFlow(sid);
      if (!flow) {
        flow = { _id: sid, id: sid, nodes: [] };
        this._flows.push(flow);
      }
      const nodes = Array.isArray(flow.nodes) ? flow.nodes : (flow.nodes = []);
      let found = false;
      for (let i = 0; i < nodes.length; i++) {
        if (idOf(nodes[i]) === nid) {
          const updated = Object.assign({}, nodes[i]);
          Object.keys(node).forEach(function (k) {
            updated[k] = node[k];
          });
          nodes[i] = updated;
          found = true;
          break;
        }
      }
      if (!found) {
        const fresh = Object.assign({}, node);
        if (!Array.isArray(fresh.child_node_ids)) fresh.child_node_ids = [];
        if (fresh.next_node_id === undefined) fresh.next_node_id = null;
        nodes.push(fresh);
      }
      this._chartEntries.set(sid, buildChartEntryFromMergedNodes(nodes, []));
      this._rebuildChartReferenceMaps();
      this._emit("chart-changed", { flowId: sid });
      this._scheduleRecompute();
      this._scheduleSave();
    }

    // ----- issue detection / structured JSON -------------------------

    findFlowNodeIssues() {
      return issuesMod.scanProject({
        flows: this._flows,
        llms: this._llms,
        connections: this._connections,
        connectionsByRef: this._connectionsByRef,
        extensionSpecs: this._extensionSpecs,
      });
    }

    flowToStructuredJson(flowIdOrFlow, options) {
      const opts = options || {};
      let flow = null;
      if (typeof flowIdOrFlow === "string") {
        flow = this.getFlow(flowIdOrFlow);
        if (!flow) {
          const chart = this.getChartEntry(flowIdOrFlow);
          if (chart && Array.isArray(chart.nodes) && chart.nodes.length) {
            flow = {
              _id: String(flowIdOrFlow),
              id: String(flowIdOrFlow),
              nodes: chart.nodes,
            };
          }
        }
      } else if (isPlainObject(flowIdOrFlow)) {
        flow = flowIdOrFlow;
      }
      if (!flow) {
        throw new Error("Unknown flow: " + String(flowIdOrFlow));
      }
      const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
      const fid = idOf(flow);
      const fname = String(flow.name || "").trim();
      const flowCtx = fname ? "'" + fname + "' (id=" + fid + ")" : fid;
      const silence =
        opts.silenceUnknownNodeTypeWarnings === undefined
          ? this._silenceUnknownNodeTypeWarnings
          : Boolean(opts.silenceUnknownNodeTypeWarnings);
      const allowUnreachable =
        opts.allowUnreachableNodes === undefined ? true : Boolean(opts.allowUnreachableNodes);
      const builder = new StructuredJsonCtor({
        nodes,
        extensionSpecs: this._extensionSpecs,
        flowReferenceToId: this._chartFlowRefToId,
        nodeReferenceToId: this._chartNodeRefToId,
        flowContext: flowCtx,
        silenceUnknownNodeTypeWarnings: silence,
        allowUnreachableNodes: allowUnreachable,
      });
      return builder.build();
    }

    // ----- debounced recompute ---------------------------------------

    _scheduleRecompute(debounceMs) {
      if (this._suppressRecompute > 0) return;
      const ms = debounceMs === undefined ? RECOMPUTE_DEBOUNCE_MS : Number(debounceMs);
      if (this._recomputeTimer) clearTimeout(this._recomputeTimer);
      const self = this;
      this._recomputeTimer = setTimeout(function () {
        self._recomputeTimer = null;
        try {
          const issues = self.findFlowNodeIssues();
          self._issues = issues;
          self._emit("issues-changed", {
            issues,
            currentFlowId: self._currentFlowId,
          });
        } catch (e) {
          self._emit("error", { stage: "issues", error: e });
        }
      }, ms);
    }
  }

  pm.parallelMap = parallelMap;
  pm.CognigyProjectMap = CognigyProjectMap;
})();

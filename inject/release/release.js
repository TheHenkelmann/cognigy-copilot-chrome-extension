/**
 * Cognigy Copilot — Release storage, diffing, and payload building.
 */
(function ccpReleaseModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  if (CCP.release && CCP.release.__bootstrapped) return;

  const rel = (CCP.release = CCP.release || {});
  rel.__bootstrapped = true;

  const LOG_PREFIX = "[CCP release]";

  let storageInstance = null;

  function getStorage() {
    if (storageInstance) return storageInstance;
    const pm = CCP.projectMap;
    if (!pm || typeof pm.createStorage !== "function") return null;
    storageInstance = pm.createStorage();
    return storageInstance;
  }

  function flowKey(flow) {
    if (!flow) return "";
    const ref = flow.reference_id || flow.referenceId;
    if (ref) return "ref:" + String(ref);
    const id = flow.id || flow._id;
    if (id) return "id:" + String(id);
    return "name:" + String(flow.name || "");
  }

  function flowName(flow) {
    if (!flow) return "";
    return String(flow.name || flow.id || flow._id || "unknown");
  }

  const DIFF_JSON_KEY_ORDER = ["_id", "id", "type", "label", "preview", "config", "children"];
  const DIFF_JSON_KEY_ORDER_SET = new Set(DIFF_JSON_KEY_ORDER);

  function canonicalizeForDiff(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map(canonicalizeForDiff);
    }
    if (typeof value !== "object") return value;
    const keys = Object.keys(value);
    const ordered = [];
    DIFF_JSON_KEY_ORDER.forEach(function (k) {
      if (keys.indexOf(k) >= 0) ordered.push(k);
    });
    keys
      .filter(function (k) {
        return !DIFF_JSON_KEY_ORDER_SET.has(k);
      })
      .sort(function (a, b) {
        return a.localeCompare(b);
      })
      .forEach(function (k) {
        ordered.push(k);
      });
    const out = {};
    ordered.forEach(function (k) {
      out[k] = canonicalizeForDiff(value[k]);
    });
    return out;
  }

  function prettyJson(value) {
    try {
      return JSON.stringify(canonicalizeForDiff(value), null, 2);
    } catch (_) {
      return String(value);
    }
  }

  rel.prettyJsonForDiff = prettyJson;
  rel.canonicalizeForDiff = canonicalizeForDiff;

  function lcsDiffLines(oldText, newText) {
    const a = String(oldText || "").split("\n");
    const b = String(newText || "").split("\n");
    const m = a.length;
    const n = b.length;
    const dp = Array(m + 1)
      .fill(null)
      .map(function () {
        return Array(n + 1).fill(0);
      });
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
        else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) {
        out.push(" " + a[i]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push("-" + a[i]);
        i++;
      } else {
        out.push("+" + b[j]);
        j++;
      }
    }
    while (i < m) {
      out.push("-" + a[i]);
      i++;
    }
    while (j < n) {
      out.push("+" + b[j]);
      j++;
    }
    return out.join("\n");
  }

  rel.diffFlows = function diffFlows(oldFlows, newFlows) {
    const oldList = Array.isArray(oldFlows) ? oldFlows : [];
    const newList = Array.isArray(newFlows) ? newFlows : [];
    const oldMap = new Map();
    const newMap = new Map();
    oldList.forEach(function (f) {
      oldMap.set(flowKey(f), f);
    });
    newList.forEach(function (f) {
      newMap.set(flowKey(f), f);
    });
    const keys = new Set([].concat(Array.from(oldMap.keys()), Array.from(newMap.keys())));
    const results = [];
    keys.forEach(function (key) {
      const oldF = oldMap.get(key) || null;
      const newF = newMap.get(key) || null;
      const name = flowName(newF || oldF);
      if (oldF && !newF) {
        results.push({
          name: name,
          status: "removed",
          oldJson: prettyJson(oldF.nodes != null ? oldF.nodes : oldF),
          newJson: "",
        });
        return;
      }
      if (!oldF && newF) {
        results.push({
          name: name,
          status: "added",
          oldJson: "",
          newJson: prettyJson(newF.nodes != null ? newF.nodes : newF),
        });
        return;
      }
      const oldJson = prettyJson(oldF.nodes != null ? oldF.nodes : oldF);
      const newJson = prettyJson(newF.nodes != null ? newF.nodes : newF);
      results.push({
        name: name,
        status: oldJson === newJson ? "unchanged" : "changed",
        oldJson: oldJson,
        newJson: newJson,
      });
    });
    results.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return results;
  };

  rel.diffText = function diffText(oldFlows, newFlows, opts) {
    const o = opts || {};
    const diffs = rel.diffFlows(oldFlows, newFlows);
    const filtered = o.flowName
      ? diffs.filter(function (d) {
          return d.name === o.flowName;
        })
      : diffs.filter(function (d) {
          return d.status !== "unchanged";
        });
    const parts = [];
    filtered.forEach(function (d) {
      parts.push("=== Flow: " + d.name + " (" + d.status + ") ===");
      parts.push(lcsDiffLines(d.oldJson, d.newJson));
      parts.push("");
    });
    return parts.join("\n").trim();
  };

  rel.buildCurrentReleasePayload = async function buildCurrentReleasePayload(meta) {
    const m = meta || {};
    const map =
      CCP.namingApi && typeof CCP.namingApi.getProjectMap === "function"
        ? CCP.namingApi.getProjectMap()
        : null;
    if (!map) throw new Error("Project map not available");
    const flows = map.flows || [];
    const outFlows = [];
    for (let i = 0; i < flows.length; i++) {
      const flow = flows[i];
      const flowId = flow.id || flow._id;
      let nodes = null;
      try {
        nodes = map.flowToStructuredJson(flowId, {
          allowUnreachableNodes: true,
          silenceUnknownNodeTypeWarnings: true,
        });
      } catch (e) {
        console.warn(LOG_PREFIX, "flowToStructuredJson failed", flowId, e);
        nodes = [];
      }
      outFlows.push({
        id: flowId,
        reference_id: flow.reference_id || flow.referenceId || "",
        name: flow.name || "",
        last_changed: flow.last_changed || flow.lastChanged || null,
        nodes: nodes,
      });
    }
    return {
      release_name: m.release_name || "",
      snapshot_id: m.snapshot_id || null,
      created_at: m.created_at || Date.now(),
      release_message: m.release_message || "",
      commit_message: m.commit_message || "",
      download_link: m.download_link || "",
      project_id:
        m.project_id || (CCP.namingApi && CCP.namingApi.getProjectId ? CCP.namingApi.getProjectId() : ""),
      flows: outFlows,
    };
  };

  rel.save = async function save(payload) {
    const storage = getStorage();
    if (!storage) throw new Error("Release storage unavailable");
    if (!payload || !payload.release_name) throw new Error("release_name required");
    await storage.saveRelease(payload);
    return payload;
  };

  rel.loadByName = async function loadByName(releaseName) {
    const storage = getStorage();
    if (!storage) return null;
    return storage.loadRelease(releaseName);
  };

  rel.listReleaseNames = async function listReleaseNames() {
    const storage = getStorage();
    if (!storage) return [];
    return storage.listReleaseKeys();
  };

  rel.loadAllReleases = async function loadAllReleases() {
    const storage = getStorage();
    if (!storage) return [];
    return storage.loadAllReleases();
  };

  rel.getLatestStoredRelease = async function getLatestStoredRelease() {
    const all = await rel.loadAllReleases();
    if (!all.length) return null;
    all.sort(function (a, b) {
      return (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
    });
    return all[0] || null;
  };

  rel.defaultReleaseName = function defaultReleaseName() {
    const d = new Date();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return y + "-" + mo + "-" + da + "-release";
  };

  rel.resolveDefaultReleaseName = async function resolveDefaultReleaseName() {
    const base = rel.defaultReleaseName();
    let names = [];
    try {
      names = await rel.listReleaseNames();
    } catch (_) {
      names = [];
    }
    const set = new Set(names.map(String));
    if (!set.has(base)) return base;
    let n = 2;
    while (set.has(base + "-v" + n)) n++;
    return base + "-v" + n;
  };

  rel.isReleaseNameStored = async function isReleaseNameStored(releaseName) {
    const name = String(releaseName || "").trim();
    if (!name) return false;
    const stored = await rel.loadByName(name);
    return !!stored;
  };
})();

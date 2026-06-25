/**
 * Cognigy Copilot — Release API client (snapshots, playbooks, tasks).
 */
(function ccpReleaseApiModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const rel = (CCP.release = CCP.release || {});
  if (rel.api && rel.api.__bootstrapped) return;

  const api = (rel.api = rel.api || {});
  api.__bootstrapped = true;

  const LOG_PREFIX = "[CCP release-api]";
  const API_BASE = "/new/v2.0";
  const MARKER_HEADER = "x-cognigy-copilot-naming";
  const MARKER_VALUE = "1";
  const TASK_POLL_MS = 1500;
  const PLAYBOOK_TASK_POLL_MS = 2000;
  const PLAYBOOK_BATCH_SIZE = 100;
  const TASK_TIMEOUT_MS = 30 * 60 * 1000;

  function getAuth() {
    const ns = window.__cognigyCopilotNamingState;
    if (ns) {
      return {
        baseUrl: String(ns.baseUrl || "").replace(/\/+$/, ""),
        bearerToken: ns.bearerToken || "",
        rawFetch: ns.rawFetch || window.fetch.bind(window),
      };
    }
    return { baseUrl: "", bearerToken: "", rawFetch: window.fetch.bind(window) };
  }

  function buildUrl(path, query) {
    const auth = getAuth();
    let url = auth.baseUrl + path;
    if (query && typeof query === "object") {
      const usp = new URLSearchParams();
      Object.keys(query).forEach(function (k) {
        const v = query[k];
        if (v === undefined || v === null || v === "") return;
        usp.append(k, String(v));
      });
      const qs = usp.toString();
      if (qs) url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
    }
    return url;
  }

  async function fetchJson(method, path, body, query) {
    const auth = getAuth();
    if (!auth.baseUrl || !auth.bearerToken) {
      throw new Error("Cognigy API credentials not available");
    }
    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set(MARKER_HEADER, MARKER_VALUE);
    headers.set("Authorization", auth.bearerToken);
    const opts = { method: method, headers: headers };
    if (body != null && method !== "GET" && method !== "DELETE") {
      opts.body = JSON.stringify(body);
    }
    const res = await auth.rawFetch(buildUrl(path, query), opts);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = { raw: text };
    }
    if (!res.ok) {
      const detail = (json && (json.detail || json.title)) || text || res.statusText;
      throw new Error("API " + res.status + ": " + detail);
    }
    return json;
  }

  async function listAll(path, query) {
    const items = [];
    let skip = 0;
    const limit = 100;
    for (;;) {
      const q = Object.assign({}, query || {}, { limit: limit, skip: skip });
      const page = await fetchJson("GET", path, null, q);
      const batch = Array.isArray(page.items)
        ? page.items
        : page._embedded
          ? page._embedded[Object.keys(page._embedded)[0]] || []
          : [];
      if (!batch.length) break;
      items.push.apply(items, batch);
      if (batch.length < limit) break;
      skip += limit;
    }
    return items;
  }

  function taskIdFromResponse(resp) {
    if (!resp) return "";
    return String(resp._id || resp.id || "");
  }

  function playbookRunIdFromObj(obj) {
    if (!obj || typeof obj !== "object") return "";
    const direct = obj.playbookRunId || obj.playbook_run_id || obj.runId || obj.run_id;
    if (typeof direct === "string" && direct) return direct;
    const nested = obj.playbookRun || obj.playbook_run;
    if (nested && typeof nested === "object") return String(nested._id || nested.id || "");
    return "";
  }

  function playbookRunIdFromResponse(resp, task) {
    let id = playbookRunIdFromObj(resp && resp.parameters);
    if (id) return id;
    id = playbookRunIdFromObj(resp && resp.data);
    if (id) return id;
    id = playbookRunIdFromObj(task && task.data);
    if (id) return id;
    return playbookRunIdFromObj(task && task.parameters);
  }

  function taskStatusTerminal(status) {
    const st = String(status || "").toLowerCase();
    return st === "done" || st === "error" || st === "cancelled" || st === "cancelling";
  }

  function parseTaskListPage(page) {
    if (!page) return [];
    if (Array.isArray(page.items)) return page.items;
    if (page._embedded) {
      const key = Object.keys(page._embedded)[0];
      return key ? page._embedded[key] || [] : [];
    }
    return [];
  }

  async function fetchTasksByIdsDirect(taskIds) {
    const ids = (taskIds || []).filter(Boolean).map(String);
    if (!ids.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += PLAYBOOK_BATCH_SIZE) {
      const chunk = ids.slice(i, i + PLAYBOOK_BATCH_SIZE);
      const batch = await Promise.all(
        chunk.map(function (id) {
          return api.getTask(id).catch(function (e) {
            console.warn(LOG_PREFIX, "getTask failed", id, e);
            return null;
          });
        })
      );
      for (let j = 0; j < batch.length; j++) {
        if (batch[j]) out.push(batch[j]);
      }
    }
    return out;
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  api.listSnapshots = async function listSnapshots(projectId) {
    const items = await listAll(API_BASE + "/snapshots", {
      projectId: projectId,
      sort: "createdAt:desc",
    });
    return items.sort(function (a, b) {
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
  };

  api.deleteSnapshot = async function deleteSnapshot(snapshotId) {
    return fetchJson("DELETE", API_BASE + "/snapshots/" + String(snapshotId));
  };

  api.createSnapshot = async function createSnapshot(payload) {
    return fetchJson("POST", API_BASE + "/snapshots", payload || {});
  };

  api.packageSnapshot = async function packageSnapshot(snapshotId) {
    return fetchJson("POST", API_BASE + "/snapshots/" + String(snapshotId) + "/package");
  };

  api.createDownloadLink = async function createDownloadLink(snapshotId, projectId) {
    return fetchJson("POST", API_BASE + "/snapshots/" + String(snapshotId) + "/downloadlink", {
      projectId: projectId,
    });
  };

  api.getTask = async function getTask(taskId) {
    return fetchJson("GET", API_BASE + "/tasks/" + String(taskId));
  };

  api.listTasksByIds = async function listTasksByIds(projectId, taskIds) {
    const wanted = new Set((taskIds || []).filter(Boolean).map(String));
    if (!wanted.size) return [];
    const foundById = {};

    // GET /v2.0/tasks `filter` is the task TYPE (e.g. runPlaybook), not _id — see API docs.
    try {
      const page = await fetchJson("GET", API_BASE + "/tasks", null, {
        projectId: projectId,
        filter: "runPlaybook",
        sort: "createdAt:desc",
        limit: PLAYBOOK_BATCH_SIZE,
      });
      parseTaskListPage(page).forEach(function (task) {
        const tid = String(task._id || task.id || "");
        if (wanted.has(tid)) foundById[tid] = task;
      });
    } catch (e) {
      console.warn(LOG_PREFIX, "listTasks runPlaybook failed", e);
    }

    const missing = Array.from(wanted).filter(function (id) {
      return !foundById[id];
    });
    if (missing.length) {
      const direct = await fetchTasksByIdsDirect(missing);
      direct.forEach(function (task) {
        const tid = String(task._id || task.id || "");
        if (tid) foundById[tid] = task;
      });
    }

    return Array.from(wanted)
      .map(function (id) {
        return foundById[id] || null;
      })
      .filter(Boolean);
  };

  api.pollTasksByIds = async function pollTasksByIds(projectId, taskIds, onProgress, pollMs) {
    const interval = pollMs || PLAYBOOK_TASK_POLL_MS;
    const wanted = Array.from(new Set((taskIds || []).filter(Boolean).map(String)));
    if (!wanted.length) return [];
    const t0 = Date.now();
    const resultMap = {};
    for (;;) {
      const tasks = await api.listTasksByIds(projectId, wanted);
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const tid = String(task._id || task.id || "");
        if (!tid) continue;
        resultMap[tid] = task;
        if (typeof onProgress === "function") {
          try {
            onProgress(task);
          } catch (_) {}
        }
      }
      const allDone = wanted.every(function (id) {
        const task = resultMap[id];
        return task && taskStatusTerminal(task.status);
      });
      if (
        allDone &&
        wanted.every(function (id) {
          return !!resultMap[id];
        })
      ) {
        return wanted.map(function (id) {
          return resultMap[id] || null;
        });
      }
      if (Date.now() - t0 > TASK_TIMEOUT_MS) {
        throw new Error("Task polling timed out");
      }
      await sleep(interval);
    }
  };

  api.pollTask = async function pollTask(taskId, onProgress, pollMs) {
    const tid = String(taskId || "");
    if (!tid) throw new Error("taskId required");
    const interval = pollMs || TASK_POLL_MS;
    const t0 = Date.now();
    for (;;) {
      const task = await api.getTask(tid);
      if (typeof onProgress === "function") {
        try {
          onProgress(task);
        } catch (_) {}
      }
      const status = String(task.status || "").toLowerCase();
      if (status === "done") return task;
      if (status === "error" || status === "cancelled" || status === "cancelling") {
        throw new Error("Task " + status + (task.failReason ? ": " + task.failReason : ""));
      }
      if (Date.now() - t0 > TASK_TIMEOUT_MS) {
        throw new Error("Task polling timed out");
      }
      await new Promise(function (r) {
        setTimeout(r, interval);
      });
    }
  };

  function playbookDisplayName(pb) {
    return String((pb && (pb.name || pb._id || pb.id)) || "");
  }

  function sortPlaybooksByName(playbooks) {
    return (playbooks || []).slice().sort(function (a, b) {
      return playbookDisplayName(a).localeCompare(playbookDisplayName(b), undefined, { sensitivity: "base" });
    });
  }

  api.listPlaybooks = async function listPlaybooks(projectId) {
    const playbooks = await listAll(API_BASE + "/playbooks", { projectId: projectId });
    return sortPlaybooksByName(playbooks);
  };

  function localeReferenceIdOf(locale) {
    if (!locale) return "";
    return String(locale.reference_id || locale.referenceId || locale._id || locale.id || "");
  }

  api.listLocales = async function listLocales(projectId) {
    return listAll(API_BASE + "/locales", { projectId: projectId });
  };

  api.getPrimaryLocale = async function getPrimaryLocale(projectId) {
    const locales = await api.listLocales(projectId);
    if (!locales.length) return null;
    let locale = null;
    for (let i = 0; i < locales.length; i++) {
      if (locales[i] && locales[i].primary === true) {
        locale = locales[i];
        break;
      }
    }
    if (!locale) locale = locales[0];
    const referenceId = localeReferenceIdOf(locale);
    return {
      id: locale._id || locale.id || "",
      reference_id: referenceId,
      name: locale.name || locale.nluLanguage || locale.nlu_language || "",
      primary: locale.primary === true,
    };
  };

  api.runPlaybook = async function runPlaybook(playbookId, body) {
    return fetchJson("POST", API_BASE + "/playbooks/" + String(playbookId) + "/schedule", body || {});
  };

  api.runAllPlaybooks = async function runAllPlaybooks(projectId, opts) {
    const o = opts || {};
    const playbooks = await api.listPlaybooks(projectId);
    if (!playbooks.length) return { playbooks: [], runs: [] };

    function notifyProgress(payload) {
      if (typeof o.onProgress !== "function") return;
      try {
        o.onProgress(payload);
      } catch (_) {}
    }

    function applyTaskToEntry(entry, task) {
      if (!task) return;
      entry.task = task;
      const st = String(task.status || "").toLowerCase();
      entry.status = st || entry.status;
      entry.playbookRunId = entry.playbookRunId || playbookRunIdFromResponse(null, task);
      if (st === "error" || st === "cancelled" || st === "cancelling") {
        entry.error = task.failReason || task.fail_reason || "Task " + st;
      } else if (st === "done") {
        entry.error = null;
      }
    }

    const runs = new Array(playbooks.length);
    const scheduleBody = { entrypoint: projectId };
    if (o.flowReferenceId) scheduleBody.flowId = o.flowReferenceId;
    if (o.localeReferenceId) scheduleBody.localeId = o.localeReferenceId;

    for (let batchStart = 0; batchStart < playbooks.length; batchStart += PLAYBOOK_BATCH_SIZE) {
      const batch = playbooks.slice(batchStart, batchStart + PLAYBOOK_BATCH_SIZE);
      const batchEntries = batch.map(function (pb, batchIdx) {
        const index = batchStart + batchIdx;
        return {
          index: index,
          playbook: pb,
          playbookId: pb._id || pb.id,
          taskId: "",
          playbookRunId: "",
          status: "pending",
          error: null,
          task: null,
        };
      });

      batchEntries.forEach(function (entry) {
        notifyProgress({ phase: "start", index: entry.index, playbook: entry.playbook, run: entry });
      });

      await Promise.all(
        batchEntries.map(async function (entry) {
          try {
            const resp = await api.runPlaybook(entry.playbookId, scheduleBody);
            entry.taskId = taskIdFromResponse(resp);
            entry.playbookRunId = playbookRunIdFromResponse(resp, null);
            if (!entry.taskId) {
              entry.status = "error";
              entry.error = "Keine Task-ID in der Antwort";
            } else {
              entry.status = "queued";
            }
          } catch (e) {
            entry.status = "error";
            entry.error = String(e.message || e);
          }
          notifyProgress({ phase: "scheduled", index: entry.index, playbook: entry.playbook, run: entry });
        })
      );

      const pollIds = batchEntries
        .filter(function (entry) {
          return entry.taskId && !entry.error;
        })
        .map(function (entry) {
          return entry.taskId;
        });

      if (pollIds.length) {
        await api.pollTasksByIds(
          projectId,
          pollIds,
          function (task) {
            const tid = String(task._id || task.id || "");
            for (let i = 0; i < batchEntries.length; i++) {
              const entry = batchEntries[i];
              if (entry.taskId !== tid) continue;
              applyTaskToEntry(entry, task);
              notifyProgress({ phase: "update", index: entry.index, playbook: entry.playbook, run: entry });
              break;
            }
          },
          PLAYBOOK_TASK_POLL_MS
        );

        for (let i = 0; i < batchEntries.length; i++) {
          const entry = batchEntries[i];
          if (!entry.taskId || entry.error) continue;
          if (!entry.task) {
            try {
              entry.task = await api.getTask(entry.taskId);
              applyTaskToEntry(entry, entry.task);
            } catch (e) {
              entry.status = "error";
              entry.error = String(e.message || e);
            }
          }
        }
      }

      batchEntries.forEach(function (entry) {
        runs[entry.index] = {
          playbook: entry.playbook,
          taskId: entry.taskId,
          playbookRunId: entry.playbookRunId,
          status: entry.status,
          error: entry.error,
          task: entry.task,
        };
        notifyProgress({
          phase: "done",
          index: entry.index,
          playbook: entry.playbook,
          run: runs[entry.index],
        });
      });
    }

    return { playbooks: playbooks, runs: runs };
  };

  api.waitForDeleteSnapshot = async function waitForDeleteSnapshot(snapshotId, onProgress) {
    const resp = await api.deleteSnapshot(snapshotId);
    const tid = taskIdFromResponse(resp);
    if (tid) return api.pollTask(tid, onProgress);
    return resp;
  };

  api.logPrefix = LOG_PREFIX;
})();

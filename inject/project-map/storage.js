/**
 * Cognigy Project-Map — IndexedDB persistence.
 *
 * One DB (`cognigyCopilot`) with one object store (`projectMaps`) keyed by
 * `project_id`. Payload shape mirrors the Python persistence format:
 *
 *   {
 *     project_id: string,
 *     flows: Array<{ ...flow, last_changed?: number, nodes?: [...] }>,
 *     extensions: Array<{ ...spec }>,
 *     llms: Array<{ ...llm, connection_test?: {...} }>,
 *     connections: Array<{ ...connection }>,
 *     saved_at: number, // ms since epoch
 *   }
 *
 * IndexedDB has hundreds of MB of quota — plenty for our project-map snapshots
 * which are on the order of ~200 KB. Writes are debounced (default 500 ms)
 * so bulk patches don't trigger one `put` per mutation.
 */
(function ccpProjectMapStorageModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const pm = (CCP.projectMap = CCP.projectMap || {});

  if (pm.createStorage) {
    return;
  }

  const DB_NAME = "cognigyCopilot";
  const DB_VERSION = 2;
  const STORE_PROJECT_MAPS = "projectMaps";
  const STORE_RELEASES = "releases";
  const DEFAULT_DEBOUNCE_MS = 500;
  const LOG_PREFIX = "[CCP project-map storage]";

  let openPromise = null;

  function openDb() {
    if (openPromise) return openPromise;
    openPromise = new Promise(function (resolve, reject) {
      let req;
      try {
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PROJECT_MAPS)) {
          db.createObjectStore(STORE_PROJECT_MAPS, { keyPath: "project_id" });
        }
        if (!db.objectStoreNames.contains(STORE_RELEASES)) {
          db.createObjectStore(STORE_RELEASES, { keyPath: "release_name" });
        }
      };
      req.onsuccess = function () {
        const db = req.result;
        db.onversionchange = function () {
          try {
            db.close();
          } catch (_) {}
          openPromise = null;
        };
        resolve(db);
      };
      req.onerror = function () {
        openPromise = null;
        reject(req.error || new Error("indexedDB open failed"));
      };
      req.onblocked = function () {
        openPromise = null;
        reject(new Error("indexedDB open blocked"));
      };
    });
    return openPromise;
  }

  function txAsync(storeName, mode, runner) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        let tx;
        try {
          tx = db.transaction(storeName, mode);
        } catch (e) {
          reject(e);
          return;
        }
        let result;
        const store = tx.objectStore(storeName);
        try {
          result = runner(store);
        } catch (e) {
          reject(e);
          return;
        }
        tx.oncomplete = function () {
          if (result && typeof result.then === "function") {
            result.then(resolve, reject);
          } else {
            resolve(result);
          }
        };
        tx.onerror = function () {
          reject(tx.error || new Error("indexedDB tx error"));
        };
        tx.onabort = function () {
          reject(tx.error || new Error("indexedDB tx aborted"));
        };
      });
    });
  }

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("indexedDB request failed"));
      };
    });
  }

  function loadProjectMap(projectId) {
    if (!projectId) return Promise.resolve(null);
    return txAsync(STORE_PROJECT_MAPS, "readonly", function (store) {
      return requestToPromise(store.get(String(projectId))).then(function (val) {
        return val || null;
      });
    }).catch(function (e) {
      console.warn(LOG_PREFIX, "loadProjectMap failed", projectId, e);
      return null;
    });
  }

  function saveProjectMap(payload) {
    if (!payload || !payload.project_id) {
      return Promise.reject(new Error("saveProjectMap: missing project_id"));
    }
    const toStore = Object.assign({}, payload, { saved_at: Date.now() });
    return txAsync(STORE_PROJECT_MAPS, "readwrite", function (store) {
      return requestToPromise(store.put(toStore));
    });
  }

  function deleteProjectMap(projectId) {
    if (!projectId) return Promise.resolve(false);
    return txAsync(STORE_PROJECT_MAPS, "readwrite", function (store) {
      return requestToPromise(store.delete(String(projectId))).then(function () {
        return true;
      });
    }).catch(function (e) {
      console.warn(LOG_PREFIX, "deleteProjectMap failed", projectId, e);
      return false;
    });
  }

  function listProjectMapKeys() {
    return txAsync(STORE_PROJECT_MAPS, "readonly", function (store) {
      return requestToPromise(store.getAllKeys()).then(function (keys) {
        return (keys || []).map(String);
      });
    }).catch(function (e) {
      console.warn(LOG_PREFIX, "listProjectMapKeys failed", e);
      return [];
    });
  }

  /**
   * Returns a debounced "save now" function plus an explicit `flush()` that
   * forces an immediate write of the pending payload.
   * The caller passes the latest snapshot on every `schedule(payload)`.
   */
  function createDebouncedSaver(options) {
    const opts = options || {};
    const debounceMs = Number(opts.debounceMs) > 0 ? Number(opts.debounceMs) : DEFAULT_DEBOUNCE_MS;
    let pendingPayload = null;
    let timer = null;
    let inflight = null;

    function doWrite() {
      timer = null;
      const payload = pendingPayload;
      pendingPayload = null;
      if (!payload) return;
      inflight = saveProjectMap(payload)
        .catch(function (e) {
          console.warn(LOG_PREFIX, "debounced save failed", e);
        })
        .then(function () {
          inflight = null;
        });
    }

    function schedule(payload) {
      pendingPayload = payload;
      if (timer) clearTimeout(timer);
      timer = setTimeout(doWrite, debounceMs);
    }

    function flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      doWrite();
      return inflight || Promise.resolve();
    }

    return { schedule, flush };
  }

  function saveRelease(payload) {
    if (!payload || !payload.release_name) {
      return Promise.reject(new Error("saveRelease: missing release_name"));
    }
    const toStore = Object.assign({}, payload, { saved_at: Date.now() });
    return txAsync(STORE_RELEASES, "readwrite", function (store) {
      return requestToPromise(store.put(toStore));
    });
  }

  function loadRelease(releaseName) {
    if (!releaseName) return Promise.resolve(null);
    return txAsync(STORE_RELEASES, "readonly", function (store) {
      return requestToPromise(store.get(String(releaseName))).then(function (val) {
        return val || null;
      });
    }).catch(function (e) {
      console.warn(LOG_PREFIX, "loadRelease failed", releaseName, e);
      return null;
    });
  }

  function deleteRelease(releaseName) {
    if (!releaseName) return Promise.resolve(false);
    return txAsync(STORE_RELEASES, "readwrite", function (store) {
      return requestToPromise(store.delete(String(releaseName))).then(function () {
        return true;
      });
    }).catch(function (e) {
      console.warn(LOG_PREFIX, "deleteRelease failed", releaseName, e);
      return false;
    });
  }

  function listReleaseKeys() {
    return txAsync(STORE_RELEASES, "readonly", function (store) {
      return requestToPromise(store.getAllKeys()).then(function (keys) {
        return (keys || []).map(String);
      });
    }).catch(function (e) {
      console.warn(LOG_PREFIX, "listReleaseKeys failed", e);
      return [];
    });
  }

  function loadAllReleases() {
    return txAsync(STORE_RELEASES, "readonly", function (store) {
      return requestToPromise(store.getAll()).then(function (rows) {
        return Array.isArray(rows) ? rows : [];
      });
    }).catch(function (e) {
      console.warn(LOG_PREFIX, "loadAllReleases failed", e);
      return [];
    });
  }

  pm.storageConstants = {
    DB_NAME,
    DB_VERSION,
    STORE_PROJECT_MAPS,
    STORE_RELEASES,
    DEFAULT_DEBOUNCE_MS,
  };

  pm.createStorage = function createStorage(options) {
    const opts = options || {};
    const saver = createDebouncedSaver({ debounceMs: opts.debounceMs });
    return {
      loadProjectMap,
      saveProjectMap,
      deleteProjectMap,
      listProjectMapKeys,
      scheduleSave: saver.schedule,
      flushSave: saver.flush,
      saveRelease,
      loadRelease,
      deleteRelease,
      listReleaseKeys,
      loadAllReleases,
    };
  };
})();

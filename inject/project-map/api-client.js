/**
 * Cognigy Project-Map — API client.
 *
 * Thin wrapper around `fetch` that
 *   1. uses the bearer token + base URL captured by `naming/state.js` from
 *      Cognigy UI requests,
 *   2. tags outgoing requests with `OWN_FETCH_MARKER_HEADER` so the
 *      `state.js` fetch/XHR patches don't re-intercept them, and
 *   3. handles Cognigy's standard `_embedded.<key>` paginated list response
 *      shape with `limit`/`skip` pagination.
 *
 * The client is intentionally stateless — base URL and bearer token are
 * passed in via a `getAuth()` getter at construction time so the project-map
 * can hand the latest credentials in on every call.
 */
(function ccpProjectMapApiClientModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const pm = (CCP.projectMap = CCP.projectMap || {});

  if (pm.createApiClient) {
    return;
  }

  const API_BASE = "/new/v2.0";
  const LLM_RESOURCE = "/largelanguagemodels";
  // Aligned with the `state.js` fetch intercept so its existing
  // "own-fetch" guard short-circuits even if the api-client ends up
  // calling the patched `window.fetch` instead of the captured raw one.
  const OWN_FETCH_MARKER_HEADER = "x-cognigy-copilot-naming";
  const OWN_FETCH_MARKER_VALUE = "1";
  const DEFAULT_PAGE_SIZE = 100;
  const LOG_PREFIX = "[CCP project-map api]";

  function trimTrailingSlash(s) {
    return String(s || "").replace(/\/+$/, "");
  }

  function buildUrl(baseUrl, path, query) {
    const trimmed = trimTrailingSlash(baseUrl);
    const cleaned = "/" + String(path || "").replace(/^\/+/, "");
    let url = trimmed + cleaned;
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

  function lastPathSegment(path) {
    const p = String(path || "")
      .split("?", 1)[0]
      .replace(/\/+$/, "");
    if (!p) return "";
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(idx + 1) : p;
  }

  function idFromSelfLink(item) {
    const links = item && item._links;
    if (!links) return null;
    let href = links.self;
    if (href && typeof href === "object") href = href.href;
    if (!href || typeof href !== "string") return null;
    const clean = href.split("?", 1)[0].replace(/\/+$/, "");
    if (!clean) return null;
    const idx = clean.lastIndexOf("/");
    return idx >= 0 ? clean.slice(idx + 1) : clean;
  }

  function normalizeItem(item) {
    if (!item || typeof item !== "object") return item;
    const out = {};
    Object.keys(item).forEach(function (k) {
      if (k === "_links" || k === "properties") return;
      out[k] = item[k];
    });
    const props = item.properties;
    if (props && typeof props === "object") {
      Object.keys(props).forEach(function (k) {
        if (!(k in out)) out[k] = props[k];
      });
    }
    if (!("_id" in out)) {
      const id = idFromSelfLink(item);
      if (id) out._id = id;
    }
    return out;
  }

  function extractPageItems(payload, embeddedKey) {
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload.items)) return payload.items;
    const emb = payload._embedded || {};
    if (embeddedKey && Array.isArray(emb[embeddedKey])) return emb[embeddedKey];
    const keys = Object.keys(emb);
    if (keys.length === 1 && Array.isArray(emb[keys[0]])) return emb[keys[0]];
    return [];
  }

  function buildHeaders(bearerToken) {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set(OWN_FETCH_MARKER_HEADER, OWN_FETCH_MARKER_VALUE);
    if (bearerToken) headers.set("Authorization", bearerToken);
    return headers;
  }

  function createApiClient(opts) {
    const options = opts || {};
    const getAuth =
      typeof options.getAuth === "function"
        ? options.getAuth
        : function () {
            return { baseUrl: "", bearerToken: "" };
          };
    const rawFetch = typeof options.rawFetch === "function" ? options.rawFetch : window.fetch.bind(window);
    const log = options.log || function () {};

    function currentAuth() {
      const a = getAuth() || {};
      return {
        baseUrl: trimTrailingSlash(a.baseUrl || ""),
        bearerToken: a.bearerToken || "",
      };
    }

    async function fetchJson(method, url, body) {
      const { bearerToken } = currentAuth();
      const headers = buildHeaders(bearerToken);
      if (body !== undefined) headers.set("Content-Type", "application/json");
      log("fetch", method, url);
      const init = {
        method,
        headers,
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await rawFetch(url, init);
      if (!res.ok) {
        const err = new Error(LOG_PREFIX + " " + method + " " + url + " failed: " + res.status);
        err.status = res.status;
        err.url = url;
        throw err;
      }
      // 204 No Content
      if (res.status === 204) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch (e) {
        return text;
      }
    }

    async function listAll(path, query) {
      const { baseUrl } = currentAuth();
      const embeddedKey = lastPathSegment(path);
      const merged = Object.assign({}, query || {});
      const pageSize =
        merged.limit && Number(merged.limit) > 0
          ? Math.min(Number(merged.limit), DEFAULT_PAGE_SIZE)
          : DEFAULT_PAGE_SIZE;
      const targetLimit =
        merged.limit && Number(merged.limit) > 0 ? Number(merged.limit) : Number.MAX_SAFE_INTEGER;
      const out = [];
      let skip = 0;
      while (out.length < targetLimit) {
        const remaining = targetLimit - out.length;
        const callLimit = Math.min(pageSize, remaining);
        const url = buildUrl(baseUrl, path, Object.assign({}, merged, { limit: callLimit, skip }));
        const payload = await fetchJson("GET", url);
        const pageItems = extractPageItems(payload, embeddedKey);
        for (let i = 0; i < pageItems.length; i++) {
          const it = pageItems[i];
          if (it && typeof it === "object") out.push(normalizeItem(it));
        }
        const total =
          payload && typeof payload === "object" && Number(payload.total) > 0 ? Number(payload.total) : 0;
        if (pageItems.length < callLimit || (total && out.length >= total)) {
          break;
        }
        skip += pageItems.length || callLimit;
        if (pageItems.length === 0) break;
      }
      return out;
    }

    async function getSingle(path, query) {
      const { baseUrl } = currentAuth();
      const url = buildUrl(baseUrl, path, query);
      const data = await fetchJson("GET", url);
      return normalizeItem(data);
    }

    async function postSingle(path, body, query) {
      const { baseUrl } = currentAuth();
      const url = buildUrl(baseUrl, path, query);
      const data = await fetchJson("POST", url, body || {});
      return normalizeItem(data);
    }

    async function patchSingle(path, body, query) {
      const { baseUrl } = currentAuth();
      const url = buildUrl(baseUrl, path, query);
      const data = await fetchJson("PATCH", url, body || {});
      return normalizeItem(data);
    }

    return {
      // Flows
      listFlows(projectId) {
        if (!projectId) return Promise.resolve([]);
        return listAll(API_BASE + "/flows", { projectId });
      },
      getFlow(flowId) {
        return getSingle(API_BASE + "/flows/" + String(flowId));
      },
      getChart(flowId) {
        return getSingle(API_BASE + "/flows/" + String(flowId) + "/chart");
      },
      getNode(flowId, nodeId) {
        return getSingle(API_BASE + "/flows/" + String(flowId) + "/chart/nodes/" + String(nodeId));
      },
      patchNode(flowId, nodeId, body) {
        return patchSingle(
          API_BASE + "/flows/" + String(flowId) + "/chart/nodes/" + String(nodeId),
          body || {}
        );
      },
      listChartNodes(flowId) {
        return listAll(API_BASE + "/flows/" + String(flowId) + "/chart/nodes", {});
      },

      // Extensions
      listExtensions(projectId) {
        if (!projectId) return Promise.resolve([]);
        return listAll(API_BASE + "/extensions", { projectId });
      },
      getExtension(extensionId) {
        return getSingle(API_BASE + "/extensions/" + String(extensionId));
      },

      // LLMs (Cognigy v2.0 resource name is largelanguagemodels, not llms)
      listLlms(projectId) {
        if (!projectId) return Promise.resolve([]);
        return listAll(API_BASE + LLM_RESOURCE, { projectId });
      },
      getLlm(llmId) {
        return getSingle(API_BASE + LLM_RESOURCE + "/" + String(llmId));
      },
      testLlm(llmId) {
        return postSingle(API_BASE + LLM_RESOURCE + "/" + String(llmId) + "/test");
      },

      // Connections
      listConnections(projectId) {
        if (!projectId) return Promise.resolve([]);
        return listAll(API_BASE + "/connections", { projectId });
      },
      getConnection(connectionId) {
        return getSingle(API_BASE + "/connections/" + String(connectionId));
      },
    };
  }

  pm.apiConstants = {
    API_BASE,
    OWN_FETCH_MARKER_HEADER,
    OWN_FETCH_MARKER_VALUE,
    DEFAULT_PAGE_SIZE,
  };
  pm.normalizeApiItem = normalizeItem;
  pm.createApiClient = createApiClient;
})();

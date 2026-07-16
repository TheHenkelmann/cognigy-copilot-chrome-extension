/**
 * Cognigy Copilot — Snapshot ↔ Endpoint mapping (lazy fetch, chip + tooltip UI).
 */
(function ccpSnapshotEndpointsModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const rel = (CCP.release = CCP.release || {});
  if (rel.snapshotEndpoints && rel.snapshotEndpoints.__bootstrapped) return;

  const se = (rel.snapshotEndpoints = rel.snapshotEndpoints || {});
  se.__bootstrapped = true;

  const LOG_PREFIX = "[CCP snapshot-endpoints]";
  const ENDPOINT_FETCH_CONCURRENCY = 10;
  const inFlightByProject = Object.create(null);

  let sharedTooltip = null;
  let tooltipAnchor = null;

  function ensureStyles() {
    if (document.getElementById("ccp-snap-endpoint-styles")) return;
    const st = document.createElement("style");
    st.id = "ccp-snap-endpoint-styles";
    st.textContent = [
      ".ccp-snap-endpoint-chip{display:inline-flex;align-items:center;padding:2px 8px;margin-left:6px;border-radius:999px;font-size:11px;font-weight:600;line-height:1.3;white-space:nowrap;flex-shrink:0;cursor:default;",
      "background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.45);color:#1d4ed8;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}",
      ".ccp-snap-endpoint-chip:hover{background:rgba(37,99,235,0.2);}",
      ".ccp-rel-cleanup-item-name-row .ccp-snap-endpoint-chip{background:rgba(59,130,246,0.18);border-color:rgba(59,130,246,0.45);color:#bfdbfe;}",
      ".ccp-rel-cleanup-item-name-row .ccp-snap-endpoint-chip:hover{background:rgba(59,130,246,0.28);}",
      ".ccp-snap-name-wrap{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;vertical-align:middle;}",
      ".ccp-snap-name-wrap .MuiTypography-root{min-width:0;}",
      ".ccp-rel-cleanup-item-name-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;}",
      ".ccp-rel-cleanup-item-name-row .ccp-rel-cleanup-item-name{flex:0 1 auto;min-width:0;}",
      ".ccp-snap-endpoint-tooltip{position:fixed;z-index:2147483647;max-width:280px;padding:8px 10px;border-radius:8px;",
      "background:rgba(24,24,27,0.96);color:#f4f4f5;border:1px solid rgba(244,244,245,0.18);box-shadow:0 12px 28px rgba(0,0,0,0.36);",
      "font-size:12px;line-height:1.45;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;pointer-events:none;display:none;}",
      ".ccp-snap-endpoint-tooltip-line{display:block;padding:2px 0;}",
    ].join("");
    document.head.appendChild(st);
  }

  function hasEntrypoint(ep) {
    return !!(ep && ep.entrypoint !== undefined && ep.entrypoint !== null && String(ep.entrypoint));
  }

  async function enrichEndpointEntrypoint(ep) {
    if (hasEntrypoint(ep)) return ep;
    const id = ep && (ep._id || ep.id);
    if (!id || !CCP.release.api || typeof CCP.release.api.getEndpoint !== "function") return ep;
    try {
      const full = await CCP.release.api.getEndpoint(id);
      return Object.assign({}, ep, { entrypoint: full && full.entrypoint });
    } catch (e) {
      console.warn(LOG_PREFIX, "getEndpoint failed", id, e);
      return ep;
    }
  }

  async function mapConcurrent(items, limit, fn) {
    const list = items || [];
    const results = new Array(list.length);
    let next = 0;
    async function worker() {
      for (;;) {
        const idx = next++;
        if (idx >= list.length) return;
        results[idx] = await fn(list[idx], idx);
      }
    }
    const n = Math.min(limit, list.length) || 0;
    const workers = [];
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  async function buildSnapshotEndpointIndex(projectId) {
    const projectIdStr = String(projectId || "");
    if (!projectIdStr || !CCP.release.api) {
      return { bySnapshotId: {}, bySnapshotName: {}, projectId: projectIdStr };
    }

    const endpointsRaw = await CCP.release.api.listEndpoints(projectIdStr);
    const snapshots = await CCP.release.api.listSnapshots(projectIdStr);

    const snapshotIds = new Set();
    const bySnapshotName = {};
    (snapshots || []).forEach(function (s) {
      const id = String((s && (s._id || s.id)) || "");
      if (id) snapshotIds.add(id);
      const name = String((s && s.name) || "");
      if (name && id) bySnapshotName[name] = id;
    });

    const endpoints = await mapConcurrent(
      endpointsRaw || [],
      ENDPOINT_FETCH_CONCURRENCY,
      enrichEndpointEntrypoint
    );

    const bySnapshotId = {};
    endpoints.forEach(function (ep) {
      const entry = String((ep && ep.entrypoint) || "");
      if (!entry || entry === projectIdStr) return;
      if (!snapshotIds.has(entry)) return;
      if (!bySnapshotId[entry]) bySnapshotId[entry] = [];
      bySnapshotId[entry].push({
        _id: String((ep && (ep._id || ep.id)) || ""),
        name: String((ep && ep.name) || ep._id || "?"),
        channel: ep && ep.channel ? String(ep.channel) : "",
      });
    });

    Object.keys(bySnapshotId).forEach(function (sid) {
      bySnapshotId[sid].sort(function (a, b) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    });

    const mappedCount = Object.keys(bySnapshotId).length;
    console.log(LOG_PREFIX, "index built", {
      projectId: projectIdStr,
      endpoints: (endpoints || []).length,
      snapshotsWithEndpoints: mappedCount,
    });

    return { bySnapshotId: bySnapshotId, bySnapshotName: bySnapshotName, projectId: projectIdStr };
  }

  se.fetchSnapshotEndpointIndex = async function fetchSnapshotEndpointIndex(projectId) {
    const pid = String(projectId || "");
    if (!pid) return { bySnapshotId: {}, bySnapshotName: {}, projectId: "" };
    if (inFlightByProject[pid]) return inFlightByProject[pid];
    const promise = buildSnapshotEndpointIndex(pid).finally(function () {
      delete inFlightByProject[pid];
    });
    inFlightByProject[pid] = promise;
    return promise;
  };

  se.getEndpointNamesForSnapshot = function getEndpointNamesForSnapshot(index, snapshotId) {
    if (!index || !snapshotId) return [];
    const list = index.bySnapshotId[String(snapshotId)] || [];
    return list.map(function (ep) {
      return ep.name;
    });
  };

  function ensureTooltipElement() {
    ensureStyles();
    if (sharedTooltip && sharedTooltip.isConnected) return sharedTooltip;
    sharedTooltip = document.createElement("div");
    sharedTooltip.className = "ccp-snap-endpoint-tooltip";
    sharedTooltip.setAttribute("data-ccp-snap-endpoint-tooltip", "1");
    document.documentElement.appendChild(sharedTooltip);
    return sharedTooltip;
  }

  function hideTooltip() {
    if (!sharedTooltip) return;
    sharedTooltip.style.display = "none";
    sharedTooltip.innerHTML = "";
    tooltipAnchor = null;
  }

  function positionTooltip(anchor, tooltip) {
    const rect = anchor.getBoundingClientRect();
    tooltip.style.display = "block";
    tooltip.style.visibility = "hidden";
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";

    const tooltipHeight = Math.max(1, tooltip.offsetHeight);
    const tooltipWidth = Math.max(1, tooltip.offsetWidth);
    const margin = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const showBelow = spaceBelow >= tooltipHeight + margin || rect.top < tooltipHeight + margin;
    const left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, rect.left));
    const top = showBelow ? rect.bottom + margin : rect.top - tooltipHeight - margin;
    tooltip.style.left = left + "px";
    tooltip.style.top = Math.max(8, Math.min(window.innerHeight - tooltipHeight - 8, top)) + "px";
    tooltip.style.visibility = "visible";
  }

  function showTooltipForChip(chip, names) {
    if (!names || !names.length) {
      hideTooltip();
      return;
    }
    const tooltip = ensureTooltipElement();
    tooltip.innerHTML = "";
    names.forEach(function (name) {
      const line = document.createElement("span");
      line.className = "ccp-snap-endpoint-tooltip-line";
      line.textContent = name;
      tooltip.appendChild(line);
    });
    tooltipAnchor = chip;
    positionTooltip(chip, tooltip);
  }

  se.attachEndpointTooltip = function attachEndpointTooltip(chip, names) {
    if (!chip) return;
    ensureStyles();
    const list = names || [];
    chip.addEventListener("mouseenter", function () {
      showTooltipForChip(chip, list);
    });
    chip.addEventListener("mouseleave", function () {
      hideTooltip();
    });
    chip.addEventListener("focus", function () {
      showTooltipForChip(chip, list);
    });
    chip.addEventListener("blur", function () {
      hideTooltip();
    });
  };

  se.createEndpointChip = function createEndpointChip(endpointNames) {
    const names = (endpointNames || []).filter(Boolean);
    if (!names.length) return null;
    ensureStyles();
    const chip = document.createElement("span");
    chip.className = "ccp-snap-endpoint-chip";
    chip.setAttribute("data-ccp-endpoint-chip", "1");
    chip.setAttribute("tabindex", "0");
    chip.textContent = names.length === 1 ? "1 Endpoint" : names.length + " Endpoints";
    chip.title = "";
    se.attachEndpointTooltip(chip, names);
    return chip;
  };

  se.hideTooltip = hideTooltip;

  window.addEventListener(
    "scroll",
    function () {
      if (tooltipAnchor && sharedTooltip && sharedTooltip.style.display !== "none") {
        positionTooltip(tooltipAnchor, sharedTooltip);
      }
    },
    true
  );
  window.addEventListener("resize", hideTooltip, { passive: true });
})();

/**
 * Cognigy Copilot — Patch Cognigy snapshot list with endpoint usage chips.
 */
(function ccpSnapshotListPatchModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  if (CCP.release && CCP.release.snapshotListPatch && CCP.release.snapshotListPatch.__bootstrapped) return;

  const LOG_PREFIX = "[CCP snapshot-list-patch]";
  const ROW_ID_RE = /^row([a-f0-9]{24})Name$/;
  const BOOTSTRAP_MAX_ATTEMPTS = 300;

  let pageActive = false;
  let fetchGeneration = 0;
  let lastIndex = null;
  let scanScheduled = false;
  let observer = null;
  let bootstrapAttempts = 0;

  function rootCcp() {
    try {
      if (window.top && window.top !== window && window.top.__CCP__) return window.top.__CCP__;
    } catch (_) {}
    return CCP;
  }

  function getSnapshotEndpointsApi() {
    const root = rootCcp();
    return root.release && root.release.snapshotEndpoints ? root.release.snapshotEndpoints : null;
  }

  function getProjectId() {
    const root = rootCcp();
    if (root.namingApi && typeof root.namingApi.getProjectId === "function") {
      const pid = root.namingApi.getProjectId();
      if (pid) return pid;
    }
    const match = String(window.location.pathname || "").match(/\/project\/([a-f0-9]{24})(?:\/|$)/i);
    return match ? String(match[1]) : "";
  }

  function findSnapshotNameCells() {
    return Array.prototype.slice.call(document.querySelectorAll('[id^="row"][id$="Name"]'));
  }

  function extractSnapshotId(cell) {
    const m = String((cell && cell.id) || "").match(ROW_ID_RE);
    return m ? m[1] : "";
  }

  function removeInjectedChips() {
    const se = getSnapshotEndpointsApi();
    document.querySelectorAll("[data-ccp-endpoint-chip]").forEach(function (node) {
      node.remove();
    });
    document.querySelectorAll(".ccp-snap-name-wrap").forEach(function (wrap) {
      const parent = wrap.parentElement;
      if (!parent) return;
      while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
    });
    document.querySelectorAll("[data-ccp-endpoint-chip-host]").forEach(function (host) {
      delete host.dataset.ccpEndpointChipHost;
    });
    if (se && se.hideTooltip) se.hideTooltip();
  }

  function deactivatePage() {
    if (!pageActive) return;
    pageActive = false;
    lastIndex = null;
    fetchGeneration++;
    removeInjectedChips();
  }

  function insertChipBesideName(cell, chip) {
    const nameEl =
      cell.querySelector(".MuiListItemText-primary") || cell.querySelector(".MuiTypography-root") || cell;
    if (!nameEl || !nameEl.parentElement) return false;
    if (nameEl.closest(".ccp-snap-name-wrap")) return true;

    const wrap = document.createElement("span");
    wrap.className = "ccp-snap-name-wrap";
    const parent = nameEl.parentElement;
    parent.insertBefore(wrap, nameEl);
    wrap.appendChild(nameEl);
    wrap.appendChild(chip);
    cell.dataset.ccpEndpointChipHost = "1";
    return true;
  }

  function applyChips(cells, index) {
    const se = getSnapshotEndpointsApi();
    if (!se || !index || !cells.length) return;
    cells.forEach(function (cell) {
      const snapId = extractSnapshotId(cell);
      if (!snapId) return;
      if (cell.querySelector("[data-ccp-endpoint-chip]")) return;
      const names = se.getEndpointNamesForSnapshot(index, snapId);
      const chip = se.createEndpointChip(names);
      if (!chip) return;
      insertChipBesideName(cell, chip);
    });
  }

  async function activatePage(cells) {
    const se = getSnapshotEndpointsApi();
    if (!se) return;
    pageActive = true;
    fetchGeneration++;
    const gen = fetchGeneration;
    const projectId = getProjectId();
    let index = { bySnapshotId: {}, bySnapshotName: {} };
    if (projectId) {
      try {
        index = await se.fetchSnapshotEndpointIndex(projectId);
      } catch (e) {
        console.warn(LOG_PREFIX, "fetchSnapshotEndpointIndex failed", e);
      }
    } else {
      console.warn(LOG_PREFIX, "no projectId on snapshot page", window.location.pathname);
    }
    if (!pageActive || gen !== fetchGeneration) return;
    lastIndex = index;
    applyChips(cells, index);
  }

  function scan() {
    scanScheduled = false;
    if (!getSnapshotEndpointsApi()) return;
    const cells = findSnapshotNameCells();
    if (!cells.length) {
      deactivatePage();
      return;
    }
    if (!pageActive) {
      void activatePage(cells);
      return;
    }
    if (lastIndex) applyChips(cells, lastIndex);
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scan);
  }

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", scheduleScan);
    window.addEventListener("hashchange", scheduleScan);
    scheduleScan();
  }

  function bootstrap() {
    bootstrapAttempts++;
    const se = getSnapshotEndpointsApi();
    if (!se) {
      if (bootstrapAttempts >= BOOTSTRAP_MAX_ATTEMPTS) {
        console.warn(LOG_PREFIX, "snapshotEndpoints module unavailable");
        return;
      }
      requestAnimationFrame(bootstrap);
      return;
    }

    CCP.release = CCP.release || {};
    CCP.release.snapshotListPatch = CCP.release.snapshotListPatch || {};
    if (CCP.release.snapshotListPatch.__bootstrapped) return;
    CCP.release.snapshotListPatch.__bootstrapped = true;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ensureObserver);
    } else {
      ensureObserver();
    }
  }

  bootstrap();
})();

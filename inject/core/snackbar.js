(function ccpSnackbarModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});

  const DEFAULT_TTL = 5000;
  const COUNTDOWN_RADIUS = 7;
  const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * COUNTDOWN_RADIUS;

  const TYPE_ACCENT = {
    error: "#ef4444",
    success: "#22c55e",
    warning: "#f59e0b",
    info: "#60a5fa",
  };

  const OVERLAY_HOST_SELECTORS = [
    "[data-ccp-release-manage]",
    "[data-ccp-release-overlay]",
    "[data-ccp-typed-confirm]",
    ".ccp-rel-diff-overlay",
  ];

  let nextId = 0;
  let items = [];
  let paused = false;
  let pausedRef = false;
  let itemsRef = items;
  let portalEl = null;
  let containerEl = null;
  let frameId = null;
  let lastTick = 0;
  let stylesInjected = false;

  function makeMergeKey(type, title, body) {
    return type + "::" + title + "::" + body;
  }

  function findMountHost() {
    for (let s = 0; s < OVERLAY_HOST_SELECTORS.length; s++) {
      const nodes = document.querySelectorAll(OVERLAY_HOST_SELECTORS[s]);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (node && node.isConnected) return node;
      }
    }
    return document.body || document.documentElement;
  }

  function ensureStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement("style");
    style.setAttribute("data-ccp-snackbar", "1");
    style.textContent = [
      ".ccp-snackbar-portal{position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block!important;}",
      ".ccp-snackbar-container{position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;width:min(384px,calc(100vw - 32px));flex-direction:column;gap:8px;pointer-events:auto;}",
      ".ccp-snackbar-item{overflow:hidden;border-radius:12px;border:1px solid rgba(255,255,255,0.1);border-left-width:3px;box-shadow:0 8px 24px rgba(0,0,0,0.35);background:#262626;}",
      ".ccp-snackbar-item-expandable{cursor:pointer;}",
      ".ccp-snackbar-header{display:flex;align-items:center;gap:8px;padding:10px 12px;}",
      ".ccp-snackbar-title{min-width:0;flex:1;font-size:14px;font-weight:500;color:#ececec;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ccp-snackbar-count{font-weight:400;color:#9ca3af;}",
      ".ccp-snackbar-dismiss{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex-shrink:0;border:none;border-radius:6px;background:transparent;color:#9ca3af;font-size:18px;line-height:1;cursor:pointer;}",
      ".ccp-snackbar-dismiss:hover{color:#ececec;background:rgba(255,255,255,0.08);}",
      ".ccp-snackbar-body{border-top:1px solid rgba(255,255,255,0.1);padding:8px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;color:#9ca3af;word-break:break-all;white-space:pre-wrap;max-height:12rem;overflow:auto;}",
      ".ccp-snackbar-countdown{flex-shrink:0;}",
      ".ccp-snackbar-countdown-track{stroke:rgba(255,255,255,0.1);}",
      ".ccp-snackbar-expand-hint{display:flex;align-items:center;justify-content:center;padding-bottom:4px;margin-top:-4px;color:#6b7280;}",
      ".ccp-snackbar-item-expandable:hover .ccp-snackbar-expand-hint{color:#9ca3af;}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureContainer() {
    ensureStyles();
    if (!portalEl) {
      portalEl = document.createElement("div");
      portalEl.className = "ccp-snackbar-portal";
      portalEl.setAttribute("data-ccp-snackbar-portal", "1");
    }
    if (!containerEl) {
      containerEl = document.createElement("div");
      containerEl.className = "ccp-snackbar-container";
      containerEl.setAttribute("aria-live", "polite");
      containerEl.setAttribute("data-ccp-snackbar-container", "1");
      containerEl.addEventListener("mouseenter", function () {
        setPaused(true);
      });
      containerEl.addEventListener("mouseleave", function () {
        setPaused(false);
      });
    }

    const host = findMountHost();
    if (portalEl.parentNode !== host) {
      host.appendChild(portalEl);
    } else {
      host.appendChild(portalEl);
    }
    if (containerEl.parentNode !== portalEl) {
      portalEl.appendChild(containerEl);
    }
  }

  function detachPortal() {
    if (portalEl && portalEl.parentNode) {
      portalEl.parentNode.removeChild(portalEl);
    }
  }

  function setPaused(value) {
    paused = value;
    pausedRef = value;
    render();
  }

  function syncItemsRef() {
    itemsRef = items;
  }

  function renderCountdownRing(item) {
    const progress = item.ttl > 0 ? Math.max(0, Math.min(1, item.remaining / item.ttl)) : 0;
    const offset = COUNTDOWN_CIRCUMFERENCE * (1 - progress);
    const accent = TYPE_ACCENT[item.type] || TYPE_ACCENT.error;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ccp-snackbar-countdown");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 18 18");
    svg.setAttribute("aria-hidden", "true");

    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("class", "ccp-snackbar-countdown-track");
    track.setAttribute("cx", "9");
    track.setAttribute("cy", "9");
    track.setAttribute("r", String(COUNTDOWN_RADIUS));
    track.setAttribute("fill", "none");
    track.setAttribute("stroke-width", "2");

    const progressCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    progressCircle.setAttribute("class", "ccp-snackbar-countdown-progress");
    progressCircle.setAttribute("cx", "9");
    progressCircle.setAttribute("cy", "9");
    progressCircle.setAttribute("r", String(COUNTDOWN_RADIUS));
    progressCircle.setAttribute("fill", "none");
    progressCircle.setAttribute("stroke", accent);
    progressCircle.setAttribute("stroke-width", "2");
    progressCircle.setAttribute("stroke-dasharray", String(COUNTDOWN_CIRCUMFERENCE));
    progressCircle.setAttribute("stroke-dashoffset", String(offset));
    progressCircle.setAttribute("transform", "rotate(-90 9 9)");
    if (!paused) {
      progressCircle.style.transition = "stroke-dashoffset 0.05s linear";
    } else {
      progressCircle.style.transition = "none";
    }

    svg.appendChild(track);
    svg.appendChild(progressCircle);
    return svg;
  }

  function renderSnackbarItem(item) {
    const accent = TYPE_ACCENT[item.type] || TYPE_ACCENT.error;
    const canExpand = Boolean(item.body);
    const titleSuffix = item.count > 1 ? " ×" + item.count : "";

    const root = document.createElement("div");
    root.className = "ccp-snackbar-item" + (canExpand ? " ccp-snackbar-item-expandable" : "");
    root.style.borderLeftColor = accent;
    root.setAttribute("data-type", item.type);
    if (canExpand) {
      root.setAttribute("role", "button");
      root.tabIndex = 0;
    }

    const header = document.createElement("div");
    header.className = "ccp-snackbar-header";

    header.appendChild(renderCountdownRing(item));

    const title = document.createElement("span");
    title.className = "ccp-snackbar-title";
    title.textContent = item.title;
    if (titleSuffix) {
      const countSpan = document.createElement("span");
      countSpan.className = "ccp-snackbar-count";
      countSpan.textContent = titleSuffix;
      title.appendChild(countSpan);
    }
    header.appendChild(title);

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "ccp-snackbar-dismiss";
    dismissBtn.setAttribute("aria-label", "Dismiss");
    dismissBtn.textContent = "×";
    dismissBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      dismiss(item.id);
    });
    header.appendChild(dismissBtn);

    root.appendChild(header);

    if (item.expanded && item.body) {
      const body = document.createElement("div");
      body.className = "ccp-snackbar-body";
      body.textContent = item.body;
      root.appendChild(body);
    } else if (!item.expanded && item.body) {
      const hint = document.createElement("div");
      hint.className = "ccp-snackbar-expand-hint";
      hint.setAttribute("aria-hidden", "true");
      hint.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      root.appendChild(hint);
    }

    if (canExpand) {
      function handleToggle() {
        toggleExpanded(item.id);
      }
      root.addEventListener("click", handleToggle);
      root.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleToggle();
        }
      });
    }

    return root;
  }

  function render() {
    if (!containerEl) return;
    containerEl.innerHTML = "";
    if (items.length === 0) {
      detachPortal();
      return;
    }
    ensureContainer();
    for (let i = 0; i < items.length; i++) {
      containerEl.appendChild(renderSnackbarItem(items[i]));
    }
  }

  function push(opts) {
    const type = opts.type || "error";
    const ttl = opts.ttl != null ? opts.ttl : DEFAULT_TTL;
    const body = opts.body != null ? opts.body : "";
    const mergeKey = makeMergeKey(type, opts.title, body);

    const existing = items.find(function (item) {
      return item.mergeKey === mergeKey;
    });

    if (existing) {
      items = items.map(function (item) {
        if (item.id !== existing.id) return item;
        return {
          id: item.id,
          mergeKey: item.mergeKey,
          title: item.title,
          body: item.body,
          type: item.type,
          ttl: ttl,
          remaining: ttl,
          count: item.count + 1,
          expanded: item.expanded,
        };
      });
    } else {
      items = items.concat([
        {
          id: "snackbar-" + ++nextId,
          mergeKey: mergeKey,
          title: opts.title,
          body: body,
          type: type,
          ttl: ttl,
          remaining: ttl,
          count: 1,
          expanded: false,
        },
      ]);
    }

    syncItemsRef();
    ensureContainer();
    startTickLoop();
    render();
  }

  function dismiss(id) {
    items = items.filter(function (item) {
      return item.id !== id;
    });
    syncItemsRef();
    render();
  }

  function toggleExpanded(id) {
    items = items.map(function (item) {
      if (item.id !== id) return item;
      return {
        id: item.id,
        mergeKey: item.mergeKey,
        title: item.title,
        body: item.body,
        type: item.type,
        ttl: item.ttl,
        remaining: item.remaining,
        count: item.count,
        expanded: !item.expanded,
      };
    });
    syncItemsRef();
    render();
  }

  function error(title, body, ttl) {
    push({ title: title, body: body, type: "error", ttl: ttl });
  }

  function success(title, body, ttl) {
    push({ title: title, body: body, type: "success", ttl: ttl });
  }

  function warning(title, body, ttl) {
    push({ title: title, body: body, type: "warning", ttl: ttl });
  }

  function info(title, body, ttl) {
    push({ title: title, body: body, type: "info", ttl: ttl });
  }

  function tick(now) {
    const delta = now - lastTick;
    lastTick = now;

    if (!pausedRef && itemsRef.length > 0) {
      const next = itemsRef
        .map(function (item) {
          return {
            id: item.id,
            mergeKey: item.mergeKey,
            title: item.title,
            body: item.body,
            type: item.type,
            ttl: item.ttl,
            remaining: item.remaining - delta,
            count: item.count,
            expanded: item.expanded,
          };
        })
        .filter(function (item) {
          return item.remaining > 0;
        });

      const unchanged =
        next.length === itemsRef.length &&
        next.every(function (item, i) {
          return item.remaining === itemsRef[i].remaining;
        });

      if (!unchanged) {
        items = next;
        syncItemsRef();
        render();
      }
    }

    if (itemsRef.length === 0) {
      frameId = null;
      return;
    }

    frameId = requestAnimationFrame(tick);
  }

  function startTickLoop() {
    if (frameId != null || items.length === 0) return;
    lastTick = performance.now();
    frameId = requestAnimationFrame(tick);
  }

  function stopTickLoop() {
    if (frameId != null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  function reset() {
    stopTickLoop();
    items = [];
    paused = false;
    pausedRef = false;
    syncItemsRef();
    detachPortal();
    containerEl = null;
    portalEl = null;
  }

  CCP.snackbar = {
    push: push,
    error: error,
    success: success,
    warning: warning,
    info: info,
    dismiss: dismiss,
    _getItems: function () {
      return items.slice();
    },
    _reset: reset,
    _toggleExpanded: toggleExpanded,
    _setPaused: setPaused,
    _stopTickLoop: stopTickLoop,
    _startTickLoop: startTickLoop,
    _runTickAt: tick,
    _findMountHost: findMountHost,
  };
})();

(function ccpWebSocketModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  const MSG_INJECT = CCP.MSG_INJECT || "COGNIGY_COPILOT_INJECT";

  /**
   * Log large objects as JSON (truncated) for DevTools; avoids silent failures on circular refs.
   */
  function logInspectableObject(label, obj, maxChars) {
    maxChars = maxChars || 14000;
    try {
      const s = JSON.stringify(
        obj,
        function replacer(_key, value) {
          if (typeof value === "function") {
            return "[Function]";
          }
          if (value && typeof value === "object") {
            if (typeof Node !== "undefined" && value instanceof Node) {
              return "[Node]";
            }
          }
          return value;
        },
        0
      );
      if (s.length > maxChars) {
        console.log(
          LOG_PREFIX,
          label,
          s.slice(0, maxChars) + "\n… [truncated, " + s.length + " chars total]"
        );
      } else {
        console.log(LOG_PREFIX, label, obj);
      }
    } catch (err) {
      console.warn(LOG_PREFIX, label, "(JSON.stringify failed, logging String())", err);
      try {
        console.log(LOG_PREFIX, label, String(obj));
      } catch (e2) {
        console.warn(LOG_PREFIX, label, "[unloggable]", e2);
      }
    }
  }
  /** --- WebSocket monkey-patch --- */
  const OriginalWebSocket = window.WebSocket;

  /** Collaboration /socket.io URLs — used to inject synthetic engine frames for Chart Lab (same listeners as server). */
  function registerCollaborationSocket(ws, url) {
    if (typeof url !== "string") {
      return;
    }
    if (url.indexOf("socket.io") === -1) {
      return;
    }
    if (url.indexOf("collaboration") === -1 && url.indexOf("Collaboration") === -1) {
      return;
    }
    const list = (CCP._collaborationSockets = CCP._collaborationSockets || []);
    if (list.indexOf(ws) !== -1) {
      return;
    }
    list.push(ws);
    console.log(
      LOG_PREFIX,
      "registered collaboration WebSocket for inject",
      url.slice(0, 140),
      "count",
      list.length
    );
    function notifyValidationFabCollabSocketReady() {
      try {
        if (typeof CCP.notifyValidationFabCollaborationReady === "function") {
          CCP.notifyValidationFabCollaborationReady();
        } else {
          CCP._validationFabCollabReadyPending = true;
        }
      } catch (e) {
        console.warn(LOG_PREFIX, "notifyValidationFabCollabSocketReady", e);
      }
    }
    if (ws.readyState === WebSocket.OPEN) {
      notifyValidationFabCollabSocketReady();
    } else {
      ws.addEventListener("open", notifyValidationFabCollabSocketReady, { once: true });
    }
    ws.addEventListener(
      "close",
      function onCollabWsClose() {
        const ix = list.indexOf(ws);
        if (ix !== -1) {
          list.splice(ix, 1);
        }
      },
      { once: true }
    );
  }

  /**
   * Socket.IO Engine.IO v4 EVENT packet as sent on the wire: 42["name", payload]
   * @param {string} eventName
   * @param {object} payload
   */
  function buildEngineIoSocketIoEventPacket(eventName, payload) {
    return "42" + JSON.stringify([eventName, payload]);
  }

  /**
   * Dispatch a synthetic inbound message so the page's Socket.IO client runs the same path as a real server frame.
   * @param {string} enginePayloadText e.g. 42["flowChart:update",{...}]
   * @returns {{ dispatched: number, skipped: number }}
   */
  function dispatchSyntheticMessageOnCollaborationSockets(enginePayloadText) {
    const list = CCP._collaborationSockets || [];
    let dispatched = 0;
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      const ws = list[i];
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        skipped++;
        continue;
      }
      try {
        ws.dispatchEvent(new MessageEvent("message", { data: enginePayloadText }));
        dispatched++;
      } catch (e) {
        console.warn(LOG_PREFIX, "synthetic message dispatch failed", e);
        skipped++;
      }
    }
    return { dispatched: dispatched, skipped: skipped };
  }

  CCP.buildEngineIoSocketIoEventPacket = buildEngineIoSocketIoEventPacket;
  CCP.dispatchCollaborationSocketIoMessage = dispatchSyntheticMessageOnCollaborationSockets;

  /** Prefer a second seen userId (peer); else synthetic “other” id so Cognigy may treat as remote edit. */
  CCP.pickSyntheticPeerUserIdForCollab = function pickSyntheticPeerUserIdForCollab() {
    const set = CCP._seenFlowChartUpdateUserIds;
    if (!set || set.size === 0) {
      return "ffffffffffffffffffffffff";
    }
    const arr = Array.from(set);
    return arr.length >= 2 ? arr[1] : "ffffffffffffffffffffffff";
  };

  function patchSocketInstance(ws, url) {
    if (typeof url === "string" && url.indexOf("socket.io") !== -1) {
      console.log(LOG_PREFIX, "Cognigy Socket.IO WebSocket instance", url.slice(0, 120));
    }
    try {
      registerCollaborationSocket(ws, typeof url === "string" ? url : String(url));
    } catch (e) {
      console.warn(LOG_PREFIX, "registerCollaborationSocket", e);
    }
    ws.addEventListener("message", function onSocketMessage(ev) {
      try {
        const raw = typeof ev.data === "string" ? ev.data : "";
        if (!raw) {
          return;
        }
        if (raw.indexOf("socket.io") !== -1 && raw.length < 400) {
          console.log(LOG_PREFIX, "socket message sample", raw.slice(0, 200));
        }
        handlePossibleSocketIoMessage(raw);
      } catch (e) {
        console.error(LOG_PREFIX, "message handler error", e);
      }
    });
  }

  function handlePossibleSocketIoMessage(raw) {
    const parsed = tryParseSocketIoEvent(raw);
    if (!parsed) {
      return;
    }
    const eventName = parsed.eventName;
    const payload = parsed.payload;

    if (eventName === "flowChart:update") {
      console.log(LOG_PREFIX, "Socket.IO flowChart:update (collaboration)", {
        keys: payload && typeof payload === "object" ? Object.keys(payload) : [],
      });
      if (
        payload &&
        typeof payload === "object" &&
        payload.userId != null &&
        String(payload.userId).length > 0
      ) {
        const set = (CCP._seenFlowChartUpdateUserIds = CCP._seenFlowChartUpdateUserIds || new Set());
        set.add(String(payload.userId));
      }
    }

    if (eventName === "contextChanged" || eventName === "inputChanged") {
      const approxSize = (function sizeOf(p) {
        try {
          return JSON.stringify(p).length;
        } catch {
          return -1;
        }
      })(payload);
      console.log(LOG_PREFIX, "Socket.IO event detected", eventName, "payload approxSize", approxSize);
      logInspectableObject("intercepted raw Socket.IO payload for " + eventName, payload);
    }
  }

  /**
   * Parses Socket.IO engine format: prefix digits = packet type(s), then JSON array from first "[".
   * e.g. 42["event", {...}] — must NOT split on first comma inside the array (would break payloads).
   */
  function tryParseSocketIoEvent(raw) {
    if (typeof raw !== "string") {
      return null;
    }
    const trimmed = raw.trim();
    const ib = trimmed.indexOf("[");
    if (ib === -1) {
      return null;
    }
    let arr;
    try {
      arr = JSON.parse(trimmed.slice(ib));
    } catch {
      return null;
    }
    if (!Array.isArray(arr) || arr.length < 1) {
      return null;
    }
    const eventName = arr[0];
    const payload = arr[1];
    if (typeof eventName !== "string") {
      return null;
    }
    return { eventName, payload };
  }

  function PatchedWebSocket(url, protocols) {
    const ws = protocols !== undefined ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    try {
      patchSocketInstance(ws, url);
    } catch (e) {
      console.error(LOG_PREFIX, "patchSocketInstance failed", e);
    }
    return ws;
  }

  PatchedWebSocket.prototype = OriginalWebSocket.prototype;
  PatchedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  PatchedWebSocket.OPEN = OriginalWebSocket.OPEN;
  PatchedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
  PatchedWebSocket.CLOSED = OriginalWebSocket.CLOSED;

  window.WebSocket = PatchedWebSocket;
  console.log(LOG_PREFIX, "WebSocket constructor patched at", performance.now());
})();

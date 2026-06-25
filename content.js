/**
 * Cognigy Copilot — isolated content script (bridge + Cmd+I → Flow-Chat)
 * Prefix: [CognigyCopilot:CS]
 *
 * CRITICAL: First synchronous operation is injecting inject.js (no await/setTimeout before appendChild).
 * WebSocket constructor patching in the page only affects sockets created after inject.js runs.
 */

(function cognigyCopilotContent() {
  const LOG_PREFIX = "[CognigyCopilot:CS]";
  const MSG_INJECT = "COGNIGY_COPILOT_INJECT";
  const MSG_CONTENT = "COGNIGY_COPILOT_CONTENT";

  console.log(LOG_PREFIX, "content script frame", {
    href: window.location.href,
    isTop: window === window.top,
    origin: window.location.origin,
  });

  /** --- 1) Synchronous inject of main-world inject.js (first operation) --- */
  console.log(LOG_PREFIX, "Injecting inject.js at", performance.now());
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inject.js");
    script.async = false;
    script.onload = function onInjectLoad() {
      console.log(LOG_PREFIX, "inject.js loaded OK at", performance.now());
      try {
        script.remove();
      } catch (e) {
        console.warn(LOG_PREFIX, "inject script remove failed", e);
      }
    };
    script.onerror = function onInjectErr(e) {
      console.error(LOG_PREFIX, "inject.js failed to load at", performance.now(), e);
    };
    const root = document.head || document.documentElement;
    root.appendChild(script);
  } catch (e) {
    console.error(LOG_PREFIX, "inject.js appendChild failed", e);
  }

  /** --- 2) postMessage bridge: page (inject) <-> content --- */
  window.addEventListener(
    "message",
    function onWindowMessage(event) {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== "object" || data.source !== MSG_INJECT) {
        return;
      }

      const t = data.type;
      console.log(LOG_PREFIX, "message from inject", t, data.requestId || "");

      if (t === "PING") {
        postToPage({
          source: MSG_CONTENT,
          type: "PONG",
          requestId: data.requestId,
        });
        return;
      }

      if (t === "CHAT_STORAGE_GET") {
        const requestId = data.requestId;
        const keys = data.keys;
        chrome.storage.local.get(keys == null ? null : keys, function onGot(result) {
          const err = chrome.runtime.lastError;
          if (err) {
            postToPage({
              source: MSG_CONTENT,
              type: "CHAT_STORAGE_RESULT",
              requestId,
              payload: { ok: false, error: err.message },
            });
            return;
          }
          postToPage({
            source: MSG_CONTENT,
            type: "CHAT_STORAGE_RESULT",
            requestId,
            payload: { ok: true, data: result || {} },
          });
        });
        return;
      }

      if (t === "CHAT_STORAGE_SET") {
        const requestId = data.requestId;
        const items = data.items && typeof data.items === "object" ? data.items : {};
        chrome.storage.local.set(items, function onSet() {
          const err = chrome.runtime.lastError;
          if (err) {
            postToPage({
              source: MSG_CONTENT,
              type: "CHAT_STORAGE_RESULT",
              requestId,
              payload: { ok: false, error: err.message },
            });
            return;
          }
          postToPage({
            source: MSG_CONTENT,
            type: "CHAT_STORAGE_RESULT",
            requestId,
            payload: { ok: true },
          });
        });
        return;
      }

      if (t === "GEMINI_GENERATE_REQUEST") {
        const requestId = data.requestId;
        const payload = data.payload || {};
        let port;
        try {
          port = chrome.runtime.connect({ name: "GEMINI_GENERATE" });
        } catch (err) {
          postToPage({
            source: MSG_CONTENT,
            type: "GEMINI_GENERATE_ERROR",
            requestId,
            error: String(err && err.message ? err.message : err),
          });
          return;
        }
        port.onMessage.addListener(function onPortMsg(msg) {
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "chunk") {
            postToPage({
              source: MSG_CONTENT,
              type: "GEMINI_GENERATE_CHUNK",
              requestId,
              payload: { type: msg.chunkType || "answer", text: msg.text || "" },
            });
          }
          if (msg.type === "done") {
            postToPage({ source: MSG_CONTENT, type: "GEMINI_GENERATE_DONE", requestId });
            try {
              port.disconnect();
            } catch (_) {}
          }
          if (msg.type === "error") {
            postToPage({
              source: MSG_CONTENT,
              type: "GEMINI_GENERATE_ERROR",
              requestId,
              error: msg.error || "Unknown error",
            });
            try {
              port.disconnect();
            } catch (_) {}
          }
        });
        port.onDisconnect.addListener(function () {
          const err = chrome.runtime.lastError;
          if (err) {
            postToPage({
              source: MSG_CONTENT,
              type: "GEMINI_GENERATE_ERROR",
              requestId,
              error: err.message,
            });
          }
        });
        port.postMessage({
          type: "GENERATE",
          apiKey: payload.apiKey,
          model: payload.model,
          systemInstruction: payload.systemInstruction,
          userText: payload.userText,
        });
        return;
      }
    },
    false
  );

  function postToPage(msg) {
    window.postMessage(msg, "*");
  }

  /** --- Cmd+I / Ctrl+I → Flow-Chat im Page-Inject (Top-Frame) --- */
  window.addEventListener(
    "keydown",
    function onKeyDown(e) {
      const isI = e.key === "i" || e.key === "I";
      if (!isI || !(e.metaKey || e.ctrlKey)) {
        return;
      }
      if (window !== window.top) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      console.log(LOG_PREFIX, "Cmd/Ctrl+I → OPEN_FLOW_CHAT", { meta: e.metaKey, ctrl: e.ctrlKey });
      postToPage({ source: MSG_CONTENT, type: "OPEN_FLOW_CHAT" });
    },
    true
  );

  console.log(LOG_PREFIX, "content script booted at", performance.now());
})();

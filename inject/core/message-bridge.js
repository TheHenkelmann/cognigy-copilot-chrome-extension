(function ccpMessageBridgeModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  const MSG_CONTENT = CCP.MSG_CONTENT || "COGNIGY_COPILOT_CONTENT";

  function getHandler(name) {
    return CCP.handlers && typeof CCP.handlers[name] === "function" ? CCP.handlers[name] : null;
  }

  window.addEventListener(
    "message",
    function onPageMessage(event) {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || typeof data !== "object" || data.source !== MSG_CONTENT) {
        return;
      }

      const t = data.type;
      if (t === "OPEN_FLOW_CHAT") {
        const fn = getHandler("handleOpenFlowChat");
        if (fn) {
          try {
            fn(data);
          } catch (e) {
            console.warn(LOG_PREFIX, "handleOpenFlowChat", e);
          }
        }
        return;
      }
      if (t === "GET_EDITOR_SELECTION_REQUEST") {
        const reset = getHandler("resetEditStreamState");
        if (reset) reset();
        const fn = getHandler("handleGetSelectionRequest");
        if (fn) fn(data);
        return;
      }
      if (t === "EDIT_CHUNK") {
        const fn = getHandler("handleEditChunk");
        if (fn) fn(data.payload);
        return;
      }
      if (t === "EDIT_DONE") {
        const fn = getHandler("handleEditDone");
        if (fn) fn();
        return;
      }
      if (t === "EDIT_CANCEL") {
        console.log(LOG_PREFIX, "EDIT_CANCEL (overlay dismissed)");
        const fn = getHandler("finishEditStream");
        if (fn) fn();
        return;
      }
      if (t === "EDIT_ERROR") {
        console.error(LOG_PREFIX, "EDIT_ERROR from content", data.payload);
        const fn = getHandler("finishEditStream");
        if (fn) fn();
      }
    },
    false
  );
})();

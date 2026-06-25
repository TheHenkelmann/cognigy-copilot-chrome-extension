/**
 * Flow FAB chat UI: Cursor-like layout, two blocks (integrity | chat), tabs, storage, mock stream.
 */
(function ccpFlowChatUiModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const LOG_PREFIX = CCP.LOG_PREFIX || "[CognigyCopilot:INJ]";
  const MSG_INJECT = CCP.MSG_INJECT || "COGNIGY_COPILOT_INJECT";
  const MSG_CONTENT = CCP.MSG_CONTENT || "COGNIGY_COPILOT_CONTENT";

  const STORAGE_INDEX_KEY = "henleyFlowChatSessionIndex";
  const STORAGE_SESSION_PREFIX = "henleyFlowChatSession:";

  const MODEL_OPTIONS = [
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
    { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
  ];
  const DEFAULT_MODEL_ID = "gemini-3.1-flash-lite";
  /** Set to true to show the chat block in the FAB panel. */
  const CHAT_UI_VISIBLE = false;

  /** @type {HTMLElement | null} */
  let panelEl = null;
  /** @type {object | null} */
  let validationUi = null;

  let sessionId = "";
  let tabs = [];
  let activeTabId = "";
  let saveTimer = null;
  let hasUserSentInSession = false;
  let historyOverlay = null;
  let globalMaxMsgsHeight = 0;

  /** @type {Record<string, HTMLElement>} */
  let dom = {};

  function uid() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function ensureStyles() {
    if (document.getElementById("ccp-flow-chat-styles")) return;
    const st = document.createElement("style");
    st.id = "ccp-flow-chat-styles";
    st.textContent = [
      "[data-ccp-flow-chat-root]{display:flex;flex-direction:column;min-height:0;gap:10px;padding:2px 0;}",
      "[data-copilot-fab-panel].ccp-fc-panel-chassis{background:transparent!important;border:none!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;}",
      ".ccp-fc-bd-box{border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:#181818;overflow:hidden;flex-shrink:0;box-shadow:0 6px 28px rgba(0,0,0,0.42);}",
      ".ccp-fc-integrity{display:flex;flex-direction:column;min-height:0;}",
      ".ccp-fc-integrity-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;font-size:12px;font-weight:600;cursor:default;user-select:none;color:rgba(245,245,245,0.95);border-bottom:1px solid rgba(255,255,255,0.06);}",
      ".ccp-fc-integrity-head-tools{display:flex;align-items:center;margin-left:auto;flex-shrink:0;}",
      ".ccp-fc-integrity-export-wrap{position:relative;display:inline-flex;align-items:center;gap:2px;flex-shrink:0;}",
      ".ccp-fc-integrity-copy-main{display:inline-flex;align-items:center;border-radius:6px;transition:background 160ms ease,color 160ms ease;}",
      ".ccp-fc-integrity-copy-main:hover{background:rgba(148,163,184,0.12);}",
      ".ccp-fc-integrity-copy-main:hover .ccp-fc-integrity-copy-icon,.ccp-fc-integrity-copy-main:hover .ccp-fc-integrity-copy-action{color:rgba(241,245,249,0.95);}",
      ".ccp-fc-integrity-copy-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:24px;padding-left:4px;color:rgba(203,213,225,0.72);pointer-events:none;transition:color 160ms ease,transform 160ms ease;}",
      ".ccp-fc-integrity-copy-icon svg{display:block;}",
      ".ccp-fc-integrity-copy-action{display:inline-flex;align-items:center;height:24px;padding:0 6px 0 2px;border:0;border-radius:6px;background:transparent;color:rgba(203,213,225,0.88);font-size:11px;font-weight:500;font-family:inherit;line-height:1;cursor:pointer;transition:color 160ms ease,transform 160ms ease;}",
      ".ccp-fc-integrity-copy-main.ccp-copied{background:rgba(34,197,94,0.2);}",
      ".ccp-fc-integrity-copy-icon.ccp-copied{color:rgba(134,239,172,0.98);transform:scale(1.08);}",
      ".ccp-fc-integrity-copy-action.ccp-copied{color:rgba(187,247,208,0.98)!important;transform:scale(1.02);}",
      ".ccp-fc-integrity-format-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:rgba(203,213,225,0.78);cursor:pointer;transition:color 120ms ease,background 120ms ease;}",
      ".ccp-fc-integrity-format-btn:hover{background:rgba(148,163,184,0.12);color:rgba(241,245,249,0.95);}",
      ".ccp-fc-integrity-format-btn svg{display:block;}",
      ".ccp-fc-integrity-format-menu{position:absolute;right:0;top:calc(100% + 4px);min-width:96px;padding:4px;border-radius:8px;background:#262626;border:1px solid rgba(255,255,255,0.1);box-shadow:0 10px 28px rgba(0,0,0,0.45);z-index:40;}",
      ".ccp-fc-integrity-format-option{display:block;width:100%;padding:7px 10px;border:0;border-radius:6px;background:transparent;color:rgba(226,232,240,0.88);font-size:11px;font-weight:500;font-family:inherit;text-align:left;cursor:pointer;transition:background 120ms ease,color 120ms ease;}",
      ".ccp-fc-integrity-format-option:hover{background:rgba(148,163,184,0.1);color:rgba(241,245,249,0.96);}",
      ".ccp-fc-integrity-body{overflow:auto;padding:6px 8px;max-height:420px;min-height:220px;}",
      ".ccp-fc-integrity.ccp-composer-expanded .ccp-fc-integrity-body{max-height:420px;min-height:220px;}",
      ".ccp-fc-chat-shell{display:flex;flex-direction:column;min-height:0;flex:0 1 auto;border:1px solid rgba(255,255,255,0.1);border-radius:12px;background:#181818;overflow:visible;position:relative;box-shadow:0 6px 28px rgba(0,0,0,0.42);}",
      ".ccp-fc-chat-shell.ccp-fc-chat-shell--hidden{display:none!important;}",
      ".ccp-fc-integrity-fix-btn{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;z-index:2;padding:2px 8px;border-radius:999px;border:1px solid rgba(34,197,94,0.35);background:rgba(34,197,94,0.08);color:rgba(134,239,172,0.95);font-size:11px;font-weight:600;font-family:inherit;line-height:1.4;cursor:pointer;transition:background 120ms ease,border-color 120ms ease,opacity 120ms ease;}",
      ".ccp-fc-integrity-fix-btn:hover:not(:disabled){background:rgba(34,197,94,0.16);border-color:rgba(34,197,94,0.5);}",
      ".ccp-fc-integrity-fix-btn:disabled{opacity:0.55;cursor:default;}",
      ".ccp-fc-fix-all-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(15,23,42,0.35);flex-shrink:0;}",
      ".ccp-fc-fix-all-btn{display:inline-flex;align-items:center;gap:0;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:rgba(226,232,240,0.92);font-size:11px;font-family:inherit;cursor:pointer;overflow:hidden;transition:background 120ms ease,border-color 120ms ease;}",
      ".ccp-fc-fix-all-btn:hover:not(:disabled){background:rgba(148,163,184,0.12);border-color:rgba(255,255,255,0.16);}",
      ".ccp-fc-fix-all-btn:disabled{opacity:0.65;cursor:default;}",
      ".ccp-fc-fix-all-btn-primary{padding:5px 8px 5px 6px;font-weight:600;}",
      ".ccp-fc-fix-all-btn-divider{width:1px;align-self:stretch;background:rgba(255,255,255,0.12);flex-shrink:0;}",
      ".ccp-fc-fix-all-btn-type{padding:5px 8px;font-weight:500;color:rgba(203,213,225,0.88);}",
      ".ccp-fc-fix-all-btn-count{margin-left:2px;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,0.08);font-size:10px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:rgba(225,228,234,0.78);}",
      ".ccp-fc-fix-progress-wrap{position:relative;width:20px;height:20px;flex-shrink:0;margin-right:4px;}",
      ".ccp-fc-fix-progress-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:rgba(226,232,240,0.9);pointer-events:none;}",
      ".ccp-fc-chat-chrome{display:flex;flex-direction:column;min-height:0;flex:0 1 auto;}",
      ".ccp-fc-tabs-row{display:flex;align-items:stretch;gap:6px;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;min-width:0;position:relative;min-height:28px;}",
      ".ccp-fc-tabs-scroll{flex:1 1 0;min-width:0;display:flex;align-items:center;gap:2px;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-ms-overflow-style:none;}",
      ".ccp-fc-tabs-scroll::-webkit-scrollbar{display:none;}",
      ".ccp-fc-tabs-tools{flex-shrink:0;display:flex;align-items:stretch;justify-content:flex-end;gap:6px;}",
      ".ccp-fc-tab-wrap{display:inline-flex;align-items:center;gap:4px;max-width:160px;padding:3px 6px 3px 4px;border-radius:6px;border:1px solid transparent;background:transparent;cursor:pointer;user-select:none;}",
      ".ccp-fc-tab-wrap.ccp-active{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.08);}",
      ".ccp-fc-tab-icon-tab{width:14px;height:14px;flex-shrink:0;margin-right:5px;opacity:0.75;color:rgba(230,230,230,0.9);}",
      ".ccp-fc-tab-label{flex:1;min-width:0;padding:0;font-size:11px;font-weight:500;color:rgba(220,220,220,0.88);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:inherit;}",
      ".ccp-fc-tab-close{width:18px;height:18px;border:none;border-radius:4px;background:transparent;color:rgba(180,180,180,0.85);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;padding:0;flex-shrink:0;}",
      ".ccp-fc-tab-close:hover{background:rgba(255,255,255,0.08);color:#f5f5f5;}",
      ".ccp-fc-tab-tool{width:20px;height:20px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;padding:0;color:#515151;cursor:pointer;flex-shrink:0;}",
      ".ccp-fc-tab-tool svg{width:20px;height:20px;display:block;}",
      ".ccp-fc-tab-tool:hover{color:#9a9a9a;background:transparent;}",
      ".ccp-fc-msgs{flex:0 1 auto;overflow-y:auto;padding:0;display:flex;flex-direction:column;}",
      ".ccp-fc-msg-row{padding:10px 12px;}",
      ".ccp-fc-msg-body{font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}",
      ".ccp-fc-msg-user .ccp-fc-msg-body{background:#212121;border:1px solid #484848;border-radius:8px;padding:10px 12px;color:rgba(245,245,245,0.95);}",
      ".ccp-fc-thought{font-size:11px;font-weight:500;color:rgba(160,160,160,0.95);margin-bottom:6px;letter-spacing:0.01em;}",
      ".ccp-fc-bot-text{white-space:pre-wrap;word-break:break-word;color:rgba(230,230,230,0.92);}",
      ".ccp-fc-input-shell{margin:0 8px 8px;border-radius:10px;display:flex;flex-direction:column;background:#181818;flex-shrink:0;overflow:visible;}",
      ".ccp-fc-editor-wrap{position:relative;display:flex;flex-direction:column;min-height:56px;max-height:180px;background:#212121;border:1px solid #484848;border-radius:8px;margin:0;padding:10px 12px;overflow:visible;cursor:text;}",
      ".ccp-fc-editor-wrap button{cursor:pointer;}",
      ".ccp-fc-composer-editor{flex:1 1 auto;min-height:22px;max-height:100%;overflow-y:auto;font-size:13px;line-height:1.45;outline:none;color:#ececec;}",
      ".ccp-fc-composer-editor:empty:before{content:attr(data-placeholder);color:rgba(160,160,160,0.55);}",
      ".ccp-fc-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding:0;background:transparent;flex-shrink:0;}",
      ".ccp-fc-toolbar-left{display:flex;align-items:center;gap:8px;}",
      ".ccp-fc-toolbar-right{display:flex;align-items:center;gap:10px;}",
      ".ccp-fc-usage{width:20px;height:20px;flex-shrink:0;opacity:0.9;}",
      ".ccp-fc-mode-wrap{position:relative;display:inline-flex;align-items:center;}",
      ".ccp-fc-mode-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;font-size:11px;font-weight:500;border:none;border-radius:9999px;background:#393939;color:#d6d6d6;cursor:pointer;font-family:inherit;}",
      ".ccp-fc-mode-btn svg{width:10px;height:10px;flex-shrink:0;opacity:0.6;}",
      ".ccp-fc-mode-btn:hover{color:#fff;}",
      ".ccp-fc-mode-menu{position:absolute;left:0;bottom:100%;margin-bottom:4px;min-width:140px;max-height:200px;overflow-y:auto;background:#2a2a2a;border:1px solid rgba(255,255,255,0.12);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.45);display:none;z-index:30;}",
      ".ccp-fc-mode-menu.ccp-on{display:block;}",
      ".ccp-fc-mode-item{padding:8px 12px;font-size:11px;color:#e8e8e8;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);}",
      ".ccp-fc-mode-item:last-child{border-bottom:none;}",
      ".ccp-fc-mode-item:hover{background:rgba(255,255,255,0.06);}",
      ".ccp-fc-mode-item.ccp-sel{background:rgba(255,255,255,0.08);}",
      ".ccp-fc-model-wrap{position:relative;display:inline-flex;align-items:center;gap:4px;}",
      ".ccp-fc-model-btn{display:inline-flex;align-items:center;gap:4px;padding:2px 4px;border:none;background:transparent;cursor:pointer;color:rgba(210,210,210,0.92);font-size:11px;font-weight:450;font-family:inherit;max-width:200px;}",
      ".ccp-fc-model-btn:hover{color:#fff;}",
      ".ccp-fc-model-btn svg{opacity:0.65;flex-shrink:0;}",
      ".ccp-fc-model-menu{position:absolute;left:0;bottom:100%;margin-bottom:4px;min-width:200px;max-height:240px;overflow-y:auto;background:#2a2a2a;border:1px solid rgba(255,255,255,0.12);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.45);display:none;z-index:30;}",
      ".ccp-fc-model-menu.ccp-on{display:block;}",
      ".ccp-fc-model-item{padding:8px 12px;font-size:11px;color:#e8e8e8;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);}",
      ".ccp-fc-model-item:last-child{border-bottom:none;}",
      ".ccp-fc-model-item:hover{background:rgba(255,255,255,0.06);}",
      ".ccp-fc-model-item.ccp-sel{background:rgba(255,255,255,0.08);}",
      ".ccp-fc-send-round{width:30px;height:30px;border-radius:50%;border:none;background:rgba(240,240,240,0.12);color:#f5f5f5;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0;}",
      ".ccp-fc-send-round:hover{background:rgba(240,240,240,0.2);}",
      ".ccp-ref-chip{display:inline-flex;align-items:center;padding:1px 6px 2px;margin:0 2px;border-radius:5px;background:rgba(80,120,200,0.22);border:1px solid rgba(120,160,240,0.35);color:#a8c8ff;font-size:12px;font-weight:600;vertical-align:baseline;user-select:none;}",
      ".ccp-fc-history-pop{position:absolute;left:6px;right:6px;top:100%;margin-top:4px;max-height:220px;overflow-y:auto;background:#262626;border:1px solid rgba(255,255,255,0.1);border-radius:8px;z-index:15;box-shadow:0 12px 32px rgba(0,0,0,0.5);display:none;}",
      ".ccp-fc-history-pop.ccp-on{display:block;}",
      ".ccp-fc-history-item{padding:8px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);color:#e2e2e2;}",
      ".ccp-fc-history-item:hover{background:rgba(255,255,255,0.06);}",
      ".ccp-fc-chat-strip-hint{padding:6px 10px;font-size:11px;color:rgba(160,160,160,0.9);border-bottom:1px solid rgba(255,255,255,0.06);display:none;cursor:default;}",
      ".ccp-fc-chat-strip-hint.ccp-on{display:block;cursor:pointer;}",
    ].join("");
    document.head.appendChild(st);
  }

  function iconTabChatSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true">' +
      '<path d="M13.0867 21.3877L13.7321 21.7697L13.0867 21.3877ZM13.6288 20.4718L12.9833 20.0898L13.6288 20.4718ZM10.3712 20.4718L9.72579 20.8539H9.72579L10.3712 20.4718ZM10.9133 21.3877L11.5587 21.0057L10.9133 21.3877ZM1.25 10.5C1.25 10.9142 1.58579 11.25 2 11.25C2.41421 11.25 2.75 10.9142 2.75 10.5H1.25ZM3.07351 15.6264C2.915 15.2437 2.47627 15.062 2.09359 15.2205C1.71091 15.379 1.52918 15.8177 1.68769 16.2004L3.07351 15.6264ZM7.78958 18.9915L7.77666 19.7413L7.78958 18.9915ZM5.08658 18.6194L4.79957 19.3123H4.79957L5.08658 18.6194ZM21.6194 15.9134L22.3123 16.2004V16.2004L21.6194 15.9134ZM16.2104 18.9915L16.1975 18.2416L16.2104 18.9915ZM18.9134 18.6194L19.2004 19.3123H19.2004L18.9134 18.6194ZM19.6125 2.7368L19.2206 3.37628L19.6125 2.7368ZM21.2632 4.38751L21.9027 3.99563V3.99563L21.2632 4.38751ZM4.38751 2.7368L3.99563 2.09732V2.09732L4.38751 2.7368ZM2.7368 4.38751L2.09732 3.99563H2.09732L2.7368 4.38751ZM9.40279 19.2098L9.77986 18.5615L9.77986 18.5615L9.40279 19.2098ZM13.7321 21.7697L14.2742 20.8539L12.9833 20.0898L12.4412 21.0057L13.7321 21.7697ZM9.72579 20.8539L10.2679 21.7697L11.5587 21.0057L11.0166 20.0898L9.72579 20.8539ZM12.4412 21.0057C12.2485 21.3313 11.7515 21.3313 11.5587 21.0057L10.2679 21.7697C11.0415 23.0767 12.9585 23.0767 13.7321 21.7697L12.4412 21.0057ZM10.5 2.75H13.5V1.25H10.5V2.75ZM21.25 10.5V11.5H22.75V10.5H21.25ZM7.8025 18.2416C6.54706 18.2199 5.88923 18.1401 5.37359 17.9265L4.79957 19.3123C5.60454 19.6457 6.52138 19.7197 7.77666 19.7413L7.8025 18.2416ZM1.68769 16.2004C2.27128 17.6093 3.39066 18.7287 4.79957 19.3123L5.3736 17.9265C4.33223 17.4951 3.50486 16.6678 3.07351 15.6264L1.68769 16.2004ZM21.25 11.5C21.25 12.6751 21.2496 13.5189 21.2042 14.1847C21.1592 14.8438 21.0726 15.2736 20.9265 15.6264L22.3123 16.2004C22.5468 15.6344 22.6505 15.0223 22.7007 14.2868C22.7504 13.5581 22.75 12.6546 22.75 11.5H21.25ZM16.2233 19.7413C17.4786 19.7197 18.3955 19.6457 19.2004 19.3123L18.6264 17.9265C18.1108 18.1401 17.4529 18.2199 16.1975 18.2416L16.2233 19.7413ZM20.9265 15.6264C20.4951 16.6678 19.6678 17.4951 18.6264 17.9265L19.2004 19.3123C20.6093 18.7287 21.7287 17.6093 22.3123 16.2004L20.9265 15.6264ZM13.5 2.75C15.1512 2.75 16.337 2.75079 17.2619 2.83873C18.1757 2.92561 18.7571 3.09223 19.2206 3.37628L20.0044 2.09732C19.2655 1.64457 18.4274 1.44279 17.4039 1.34547C16.3915 1.24921 15.1222 1.25 13.5 1.25V2.75ZM22.75 10.5C22.75 8.87781 22.7508 7.6085 22.6545 6.59611C22.5572 5.57256 22.3554 4.73445 21.9027 3.99563L20.6237 4.77938C20.9078 5.24291 21.0744 5.82434 21.1613 6.73809C21.2492 7.663 21.25 8.84876 21.25 10.5H22.75ZM19.2206 3.37628C19.7925 3.72672 20.2733 4.20752 20.6237 4.77938L21.9027 3.99563C21.4286 3.22194 20.7781 2.57144 20.0044 2.09732L19.2206 3.37628ZM10.5 1.25C8.87781 1.25 7.6085 1.24921 6.59611 1.34547C5.57256 1.44279 4.73445 1.64457 3.99563 2.09732L4.77938 3.37628C5.24291 3.09223 5.82434 2.92561 6.73809 2.83873C7.663 2.75079 8.84876 2.75 10.5 2.75V1.25ZM2.75 10.5C2.75 8.84876 2.75079 7.663 2.83873 6.73809C2.92561 5.82434 3.09223 5.24291 3.37628 4.77938L2.09732 3.99563C1.64457 4.73445 1.44279 5.57256 1.34547 6.59611C1.24921 7.6085 1.25 8.87781 1.25 10.5H2.75ZM3.99563 2.09732C3.22194 2.57144 2.57144 3.22194 2.09732 3.99563L3.37628 4.77938C3.72672 4.20752 4.20752 3.72672 4.77938 3.37628L3.99563 2.09732ZM11.0166 20.0898C10.8136 19.7468 10.6354 19.4441 10.4621 19.2063C10.2795 18.9559 10.0702 18.7304 9.77986 18.5615L9.02572 19.8582C9.07313 19.8857 9.13772 19.936 9.24985 20.0898C9.37122 20.2564 9.50835 20.4865 9.72579 20.8539L11.0166 20.0898ZM7.77666 19.7413C8.21575 19.7489 8.49387 19.7545 8.70588 19.7779C8.90399 19.7999 8.98078 19.832 9.02572 19.8582L9.77986 18.5615C9.4871 18.3912 9.18246 18.3215 8.87097 18.287C8.57339 18.2541 8.21375 18.2487 7.8025 18.2416L7.77666 19.7413ZM14.2742 20.8539C14.4916 20.4865 14.6287 20.2564 14.7501 20.0898C14.8622 19.936 14.9268 19.8857 14.9742 19.8582L14.2201 18.5615C13.9298 18.7304 13.7204 18.9559 13.5379 19.2063C13.3646 19.4441 13.1864 19.7468 12.9833 20.0898L14.2742 20.8539ZM16.1975 18.2416C15.7862 18.2487 15.4266 18.2541 15.129 18.287C14.8175 18.3215 14.5129 18.3912 14.2201 18.5615L14.9742 19.8582C15.0192 19.832 15.096 19.7999 15.2941 19.7779C15.5061 19.7545 15.7842 19.7489 16.2233 19.7413L16.1975 18.2416Z" fill="currentColor"/>' +
      '<path d="M15.5 7.83008L15.6716 8.00165C17.0049 9.33498 17.6716 10.0017 17.6716 10.8301C17.6716 11.6585 17.0049 12.3252 15.6716 13.6585L15.5 13.8301" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M13.2939 6L11.9998 10.8296L10.7058 15.6593" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M8.49994 7.83008L8.32837 8.00165C6.99504 9.33498 6.32837 10.0017 6.32837 10.8301C6.32837 11.6585 6.99504 12.3252 8.32837 13.6585L8.49994 13.8301" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      "</svg>"
    );
  }
  function iconSelectChevronsSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" width="10" height="10" aria-hidden="true">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M12.7071 4.29289C12.3166 3.90237 11.6834 3.90237 11.2929 4.29289L7.29289 8.29289C6.90237 8.68342 6.90237 9.31658 7.29289 9.70711C7.68342 10.0976 8.31658 10.0976 8.70711 9.70711L12 6.41421L15.2929 9.70711C15.6834 10.0976 16.3166 10.0976 16.7071 9.70711C17.0976 9.31658 17.0976 8.68342 16.7071 8.29289L12.7071 4.29289ZM7.29289 15.7071L11.2929 19.7071C11.6834 20.0976 12.3166 20.0976 12.7071 19.7071L16.7071 15.7071C17.0976 15.3166 17.0976 14.6834 16.7071 14.2929C16.3166 13.9024 15.6834 13.9024 15.2929 14.2929L12 17.5858L8.70711 14.2929C8.31658 13.9024 7.68342 13.9024 7.29289 14.2929C6.90237 14.6834 6.90237 15.3166 7.29289 15.7071Z" fill="currentColor"/>' +
      "</svg>"
    );
  }
  function iconSendSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  }
  function iconPlusSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  }
  function iconHistorySvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" fill="none" aria-hidden="true">' +
      '<g transform="translate(16 16)">' +
      '<circle cx="80" cy="80" r="74" stroke="currentColor" stroke-width="12" fill="none"/>' +
      '<path d="M80 30v50l40 32" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
      "</g></svg>"
    );
  }

  function storageRequest(type, extra) {
    return new Promise(function (resolve) {
      const requestId = "stg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== MSG_CONTENT || d.type !== "CHAT_STORAGE_RESULT" || d.requestId !== requestId)
          return;
        window.removeEventListener("message", onMsg);
        resolve(d.payload || {});
      }
      window.addEventListener("message", onMsg);
      window.postMessage(Object.assign({ source: MSG_INJECT, requestId }, extra, { type: type }), "*");
      setTimeout(function () {
        window.removeEventListener("message", onMsg);
        resolve({ ok: false, error: "timeout" });
      }, 12000);
    });
  }

  function storageGet(keys) {
    return storageRequest("CHAT_STORAGE_GET", { keys: keys });
  }

  function storageSet(items) {
    return storageRequest("CHAT_STORAGE_SET", { items: items });
  }

  function getActiveTab() {
    return tabs.find(function (t) {
      return t.id === activeTabId;
    });
  }

  function modelLabel(id) {
    const o = MODEL_OPTIONS.find(function (x) {
      return x.id === id;
    });
    return o ? o.label : id;
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      void persistSession();
    }, 400);
  }

  async function persistSession() {
    if (!sessionId) return;
    const titleTab = tabs[0];
    const title = (titleTab && titleTab.title) || "Agent";
    const snapshot = {
      id: sessionId,
      title: title,
      updatedAt: Date.now(),
      tabs: tabs.map(function (t) {
        return {
          id: t.id,
          title: t.title,
          messages: t.messages,
          modelId: t.modelId || DEFAULT_MODEL_ID,
          mode: t.mode || "agent",
        };
      }),
      activeTabId: activeTabId,
      hasUserSent: hasUserSentInSession,
    };
    const indexRes = await storageGet([STORAGE_INDEX_KEY]);
    const data = (indexRes && indexRes.ok && indexRes.data) || {};
    let index = Array.isArray(data[STORAGE_INDEX_KEY]) ? data[STORAGE_INDEX_KEY].slice() : [];
    index = index.filter(function (e) {
      return e && e.id !== sessionId;
    });
    index.unshift({ id: sessionId, title: title, updatedAt: snapshot.updatedAt });
    index = index.slice(0, 40);
    const items = {};
    items[STORAGE_INDEX_KEY] = index;
    items[STORAGE_SESSION_PREFIX + sessionId] = snapshot;
    await storageSet(items);
  }

  function updateChatChromeVisibility() {
    const empty = tabs.length === 0;
    if (dom.chatChrome) {
      dom.chatChrome.style.display = empty ? "none" : "";
    }
    if (dom.chatStripHint) {
      dom.chatStripHint.classList.toggle("ccp-on", empty);
    }
    applyChatSizing();
  }

  function computeAvailableMsgsHeight() {
    const panelMax = window.innerHeight - 78;
    let used = 0;
    if (dom.integrityWrap) used += dom.integrityWrap.offsetHeight;
    if (dom.tabsRow) used += dom.tabsRow.offsetHeight;
    if (dom.inputShell) used += dom.inputShell.offsetHeight;
    used += 28;
    return Math.max(60, panelMax - used);
  }

  function applyChatSizing() {
    if (!CHAT_UI_VISIBLE || !dom.msgScroll) return;
    const avail = computeAvailableMsgsHeight();
    const minH = Math.min(globalMaxMsgsHeight, avail);
    dom.msgScroll.style.maxHeight = avail + "px";
    dom.msgScroll.style.minHeight = minH + "px";
  }

  function recordCurrentMsgsHeight() {
    if (!dom.msgScroll) return;
    const tab = getActiveTab();
    if (!tab) return;
    const prevMin = dom.msgScroll.style.minHeight;
    dom.msgScroll.style.minHeight = "0px";
    const h = dom.msgScroll.scrollHeight;
    dom.msgScroll.style.minHeight = prevMin;
    tab.observedMsgsHeight = Math.max(tab.observedMsgsHeight || 0, h);
    let max = 0;
    tabs.forEach(function (t) {
      if (t && t.observedMsgsHeight && t.observedMsgsHeight > max) max = t.observedMsgsHeight;
    });
    globalMaxMsgsHeight = max;
    applyChatSizing();
  }

  function renderModelButtonLabel() {
    const tab = getActiveTab();
    if (!dom.modelBtn || !tab) return;
    const id = tab.modelId || DEFAULT_MODEL_ID;
    const o = MODEL_OPTIONS.find(function (x) {
      return x.id === id;
    });
    const text = o ? o.label.replace(/^Gemini\s+/i, "") : id;
    dom.modelBtn.innerHTML =
      '<span class="ccp-fc-model-label">' + escapeHtml(text) + "</span>" + iconSelectChevronsSvg();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderModelMenu() {
    if (!dom.modelMenu) return;
    dom.modelMenu.innerHTML = "";
    const tab = getActiveTab();
    const cur = (tab && tab.modelId) || DEFAULT_MODEL_ID;
    MODEL_OPTIONS.forEach(function (opt) {
      const row = document.createElement("div");
      row.className = "ccp-fc-model-item" + (opt.id === cur ? " ccp-sel" : "");
      row.textContent = opt.label;
      row.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
      });
      row.addEventListener("click", function () {
        if (tab) tab.modelId = opt.id;
        dom.modelMenu.classList.remove("ccp-on");
        renderModelButtonLabel();
        scheduleSave();
      });
      dom.modelMenu.appendChild(row);
    });
  }

  const MODE_OPTIONS = [
    { id: "agent", label: "Agent" },
    { id: "ask", label: "Ask" },
  ];

  function modeLabel(id) {
    const o = MODE_OPTIONS.find(function (x) {
      return x.id === id;
    });
    return o ? o.label : id;
  }

  function renderModeButtons() {
    if (!dom.modeBtn) return;
    const tab = getActiveTab();
    const mode = (tab && tab.mode) || "agent";
    dom.modeBtn.innerHTML =
      '<span class="ccp-fc-mode-label">' + escapeHtml(modeLabel(mode)) + "</span>" + iconSelectChevronsSvg();
  }

  function renderModeMenu() {
    if (!dom.modeMenu) return;
    dom.modeMenu.innerHTML = "";
    const tab = getActiveTab();
    const cur = (tab && tab.mode) || "agent";
    MODE_OPTIONS.forEach(function (opt) {
      const row = document.createElement("div");
      row.className = "ccp-fc-mode-item" + (opt.id === cur ? " ccp-sel" : "");
      row.textContent = opt.label;
      row.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
      });
      row.addEventListener("click", function () {
        if (tab) tab.mode = opt.id;
        dom.modeMenu.classList.remove("ccp-on");
        renderModeButtons();
        scheduleSave();
      });
      dom.modeMenu.appendChild(row);
    });
  }

  function renderTabsBar() {
    if (!dom.tabsScroll) return;
    dom.tabsScroll.innerHTML = "";

    tabs.forEach(function (tab) {
      const wrap = document.createElement("div");
      wrap.className = "ccp-fc-tab-wrap" + (tab.id === activeTabId ? " ccp-active" : "");
      wrap.setAttribute("role", "presentation");

      const ico = document.createElement("span");
      ico.className = "ccp-fc-tab-icon-tab";
      ico.innerHTML = iconTabChatSvg();

      const label = document.createElement("span");
      label.className = "ccp-fc-tab-label";
      label.textContent = tab.title || "Neuer Agent";
      label.title = tab.title || "";

      wrap.addEventListener("click", function () {
        activeTabId = tab.id;
        renderTabsBar();
        renderMessages();
        renderModelButtonLabel();
        renderModeButtons();
        renderModelMenu();
      });

      const close = document.createElement("button");
      close.type = "button";
      close.className = "ccp-fc-tab-close";
      close.setAttribute("aria-label", "Tab schließen");
      close.textContent = "×";
      close.addEventListener("click", function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        closeTab(tab.id);
      });

      wrap.appendChild(ico);
      wrap.appendChild(label);
      wrap.appendChild(close);
      dom.tabsScroll.appendChild(wrap);
    });

    updateChatChromeVisibility();
  }

  function closeTab(tabId) {
    const ix = tabs.findIndex(function (t) {
      return t.id === tabId;
    });
    if (ix < 0) return;
    tabs.splice(ix, 1);
    if (activeTabId === tabId) {
      activeTabId = tabs[0] ? tabs[0].id : "";
    }
    if (!activeTabId && tabs.length) activeTabId = tabs[0].id;
    renderTabsBar();
    renderMessages();
    renderModelButtonLabel();
    renderModeButtons();
    renderModelMenu();
    updateIntegrityChrome();
    updateChatChromeVisibility();
    scheduleSave();
  }

  function newChatTab() {
    const id = uid();
    tabs.push({
      id: id,
      title: "Neuer Agent",
      messages: [],
      modelId: DEFAULT_MODEL_ID,
      mode: "agent",
    });
    activeTabId = id;
    renderTabsBar();
    renderMessages();
    renderModelButtonLabel();
    renderModeButtons();
    renderModelMenu();
    updateChatChromeVisibility();
    scheduleSave();
  }

  function renderMessages() {
    if (!dom.msgScroll) return;
    dom.msgScroll.innerHTML = "";
    const tab = getActiveTab();
    if (!tab || !Array.isArray(tab.messages)) return;
    tab.messages.forEach(function (m) {
      const row = document.createElement("div");
      row.className = "ccp-fc-msg-row ccp-fc-msg-" + (m.role === "user" ? "user" : "bot");

      if (m.role === "user") {
        const body = document.createElement("div");
        body.className = "ccp-fc-msg-body";
        body.textContent = m.displayText || m.text || "";
        row.appendChild(body);
      } else {
        const th = document.createElement("div");
        th.className = "ccp-fc-thought";
        th.textContent = "Thought (mock)";
        const body = document.createElement("div");
        body.className = "ccp-fc-bot-text";
        body.textContent = m.text || "";
        row.appendChild(th);
        row.appendChild(body);
      }
      dom.msgScroll.appendChild(row);
    });
    recordCurrentMsgsHeight();
    dom.msgScroll.scrollTop = dom.msgScroll.scrollHeight;
  }

  function updateIntegrityChrome() {}

  function setComposerExpanded() {}

  function serializeComposer() {
    const ed = dom.composerEditor;
    if (!ed) return { displayText: "", canonicalText: "" };
    const displayParts = [];
    const canonicalParts = [];

    function walk(node) {
      if (node.nodeType === 3) {
        const t = node.textContent || "";
        displayParts.push(t);
        canonicalParts.push(t);
        return;
      }
      if (node.nodeType === 1) {
        if (node.classList && node.classList.contains("ccp-ref-chip")) {
          const nid = node.getAttribute("data-node-id") || "";
          const from = node.getAttribute("data-line-from") || "";
          const to = node.getAttribute("data-line-to") || "";
          const label = (node.getAttribute("data-label") || nid || "node").trim();
          const hasRange = from && to;
          const hasBody = node.getAttribute("data-has-body") === "1";
          const body = (node.getAttribute("data-body") || "").replace(/\r/g, "");
          const vis = hasRange ? "@" + label + " (" + from + "-" + to + ")" : "@" + (nid ? label : "node");
          displayParts.push(vis);
          if (hasBody && nid) {
            canonicalParts.push("```js @" + nid + "\n" + body + "\n```");
          } else if (nid) {
            canonicalParts.push("@" + nid);
          } else {
            canonicalParts.push(vis);
          }
          return;
        }
        for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
      }
    }
    walk(ed);
    return {
      displayText: displayParts
        .join("")
        .replace(/\u00a0/g, " ")
        .trim(),
      canonicalText: canonicalParts
        .join("")
        .replace(/\u00a0/g, " ")
        .trim(),
    };
  }

  function clearComposer() {
    if (dom.composerEditor) dom.composerEditor.innerHTML = "";
  }

  function insertReferenceChip(payload) {
    if (!dom.composerEditor) return;
    const nodeId = (payload && payload.nodeId) || "";
    const labelRaw = (payload && payload.nodeLabel) || nodeId || "node";
    const label = String(labelRaw).replace(/\s+/g, " ").trim().slice(0, 40) || "node";
    const sel = payload && payload.hasNonemptySelection;
    const from = payload && payload.lineFrom != null ? String(payload.lineFrom) : "";
    const to = payload && payload.lineTo != null ? String(payload.lineTo) : "";
    const selection = (payload && payload.selection) || "";
    const chip = document.createElement("span");
    chip.className = "ccp-ref-chip";
    chip.contentEditable = "false";
    chip.setAttribute("data-node-id", nodeId);
    chip.setAttribute("data-label", label);
    if (sel && from && to) {
      chip.setAttribute("data-line-from", from);
      chip.setAttribute("data-line-to", to);
      chip.setAttribute("data-has-body", "1");
      chip.setAttribute("data-body", selection);
      chip.textContent = "@" + label + " (" + from + "-" + to + ")";
    } else {
      chip.setAttribute("data-has-body", "0");
      chip.textContent = "@" + (nodeId ? label : "node");
      if (nodeId) chip.setAttribute("data-node-id", nodeId);
    }
    dom.composerEditor.appendChild(chip);
    dom.composerEditor.appendChild(document.createTextNode(" "));
    try {
      const r = document.createRange();
      r.selectNodeContents(dom.composerEditor);
      r.collapse(false);
      const selObj = window.getSelection();
      selObj.removeAllRanges();
      selObj.addRange(r);
    } catch (_) {}
  }

  function streamMockAssistant(targetEl, botMsg, fullText) {
    let i = 0;
    function tick() {
      if (i >= fullText.length) return;
      i = Math.min(fullText.length, i + 14);
      const slice = fullText.slice(0, i);
      botMsg.text = slice;
      if (targetEl.isConnected) targetEl.textContent = slice;
      recordCurrentMsgsHeight();
      if (dom.msgScroll) dom.msgScroll.scrollTop = dom.msgScroll.scrollHeight;
      setTimeout(tick, 32);
    }
    tick();
  }

  function onSend() {
    const tab = getActiveTab();
    if (!tab) return;
    const ser = serializeComposer();
    if (!ser.displayText && !ser.canonicalText.replace(/\s/g, "")) return;
    const display = ser.displayText || ser.canonicalText.trim();
    const canonical = ser.canonicalText.trim();
    tab.messages.push({
      id: uid(),
      role: "user",
      text: canonical || display,
      displayText: display,
      canonicalText: canonical,
    });
    if (!hasUserSentInSession) {
      hasUserSentInSession = true;
    }
    clearComposer();
    renderMessages();

    const reply =
      "Mock-Antwort: Ich habe deine Eingabe entgegengenommen (" +
      String(display).slice(0, 120) +
      (display.length > 120 ? "…" : "") +
      "). Später wird hier der echte Agent angebunden.";
    const botMsg = { id: uid(), role: "assistant", text: "" };
    tab.messages.push(botMsg);
    renderMessages();
    const bodies = dom.msgScroll.querySelectorAll(".ccp-fc-bot-text");
    const lastBody = bodies[bodies.length - 1];
    if (lastBody) streamMockAssistant(lastBody, botMsg, reply);

    const isDefaultTitle = !tab.title || tab.title === "Neuer Agent";
    if (isDefaultTitle) {
      tab.title = display.slice(0, 22) + (display.length > 22 ? "…" : "") || "Neuer Agent";
    }
    renderTabsBar();
    scheduleSave();
  }

  async function loadSession(id) {
    const key = STORAGE_SESSION_PREFIX + id;
    const res = await storageGet([key]);
    if (!res || !res.ok || !res.data || !res.data[key]) return false;
    const snap = res.data[key];
    sessionId = snap.id || id;
    tabs = Array.isArray(snap.tabs)
      ? snap.tabs.map(function (t) {
          return {
            id: t.id || uid(),
            title: t.title || "Neuer Agent",
            messages: Array.isArray(t.messages) ? t.messages.slice() : [],
            modelId: t.modelId || DEFAULT_MODEL_ID,
            mode: t.mode === "ask" ? "ask" : "agent",
          };
        })
      : [];
    activeTabId = snap.activeTabId || (tabs[0] && tabs[0].id) || "";
    hasUserSentInSession = !!snap.hasUserSent;
    if (!hasUserSentInSession) {
      for (let ti = 0; ti < tabs.length; ti++) {
        const t = tabs[ti];
        if (
          t &&
          Array.isArray(t.messages) &&
          t.messages.some(function (m) {
            return m && m.role === "user";
          })
        ) {
          hasUserSentInSession = true;
          break;
        }
      }
    }
    if (!tabs.length) newChatTab();
    renderTabsBar();
    renderMessages();
    renderModelButtonLabel();
    renderModeButtons();
    renderModelMenu();
    updateIntegrityChrome();
    updateChatChromeVisibility();
    hideHistoryOverlay();
    return true;
  }

  async function newSession() {
    sessionId = uid();
    tabs = [];
    activeTabId = "";
    hasUserSentInSession = false;
    newChatTab();
    updateIntegrityChrome();
    updateChatChromeVisibility();
    await persistSession();
  }

  async function toggleHistoryOverlay() {
    if (!historyOverlay) return;
    const on = historyOverlay.classList.contains("ccp-on");
    if (on) {
      hideHistoryOverlay();
      return;
    }
    const res = await storageGet([STORAGE_INDEX_KEY]);
    const data = (res && res.ok && res.data) || {};
    const index = Array.isArray(data[STORAGE_INDEX_KEY]) ? data[STORAGE_INDEX_KEY] : [];
    historyOverlay.innerHTML = "";
    if (!index.length) {
      const empty = document.createElement("div");
      empty.className = "ccp-fc-history-item";
      empty.style.cursor = "default";
      empty.textContent = "Kein gespeicherter Verlauf.";
      historyOverlay.appendChild(empty);
    } else {
      index.forEach(function (entry) {
        const row = document.createElement("div");
        row.className = "ccp-fc-history-item";
        row.textContent =
          (entry.title || entry.id || "") + " · " + new Date(entry.updatedAt || 0).toLocaleString();
        row.addEventListener("click", function () {
          void loadSession(entry.id);
        });
        historyOverlay.appendChild(row);
      });
    }
    historyOverlay.classList.add("ccp-on");
  }

  function hideHistoryOverlay() {
    if (historyOverlay) historyOverlay.classList.remove("ccp-on");
  }

  function buildUsageDonut() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ccp-fc-usage");
    svg.setAttribute("viewBox", "0 0 36 36");
    const r = 14;
    const c = 2 * Math.PI * r;
    const dash = c * 0.45;
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bg.setAttribute("cx", "18");
    bg.setAttribute("cy", "18");
    bg.setAttribute("r", String(r));
    bg.setAttribute("fill", "none");
    bg.setAttribute("stroke", "rgba(255,255,255,0.1)");
    bg.setAttribute("stroke-width", "4");
    const fg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    fg.setAttribute("cx", "18");
    fg.setAttribute("cy", "18");
    fg.setAttribute("r", String(r));
    fg.setAttribute("fill", "none");
    fg.setAttribute("stroke", "rgba(200,200,200,0.55)");
    fg.setAttribute("stroke-width", "4");
    fg.setAttribute("stroke-linecap", "round");
    fg.setAttribute("stroke-dasharray", dash + " " + c);
    fg.setAttribute("transform", "rotate(-90 18 18)");
    svg.appendChild(bg);
    svg.appendChild(fg);
    return svg;
  }

  function buildFabPanelContent(panel, ui) {
    ensureStyles();
    panel.innerHTML = "";
    panel.classList.add("ccp-fc-panel-chassis");
    panel.style.background = "transparent";
    panel.style.border = "none";
    panel.style.boxShadow = "none";
    panel.style.borderRadius = "0";
    panel.style.overflow = "visible";
    panel.style.flexDirection = "column";
    panel.style.minHeight = "0";
    panel.style.maxHeight = "calc(100vh - 78px)";
    panel.style.height = "auto";

    const root = document.createElement("div");
    root.setAttribute("data-ccp-flow-chat-root", "1");
    root.style.position = "relative";

    const integrityBox = document.createElement("div");
    integrityBox.className = "ccp-fc-bd-box";
    dom.integrityWrap = document.createElement("div");
    dom.integrityWrap.className = "ccp-fc-integrity";
    dom.integrityWrap.setAttribute("data-ccp-integrity-wrap", "1");
    const ihead = document.createElement("div");
    ihead.className = "ccp-fc-integrity-head";
    const iheadTitle = document.createElement("span");
    iheadTitle.textContent = "Flow Integrity Check";
    const iheadTools = document.createElement("div");
    iheadTools.className = "ccp-fc-integrity-head-tools";
    iheadTools.setAttribute("data-ccp-integrity-head-tools", "1");
    ihead.appendChild(iheadTitle);
    ihead.appendChild(iheadTools);
    ui.integrityHeaderTools = iheadTools;
    const ibody = document.createElement("div");
    ibody.className = "ccp-fc-integrity-body";
    dom.integrityWrap.appendChild(ihead);
    dom.integrityWrap.appendChild(ibody);
    integrityBox.appendChild(dom.integrityWrap);
    root.appendChild(integrityBox);

    if (CCP.release && CCP.release.ui && typeof CCP.release.ui.buildFabReleaseBox === "function") {
      root.appendChild(CCP.release.ui.buildFabReleaseBox());
    }

    const chatShell = document.createElement("div");
    chatShell.className = "ccp-fc-chat-shell" + (CHAT_UI_VISIBLE ? "" : " ccp-fc-chat-shell--hidden");

    dom.chatStripHint = document.createElement("div");
    dom.chatStripHint.className = "ccp-fc-chat-strip-hint";
    dom.chatStripHint.textContent = "Kein aktiver Agent — mit + einen neuen Chat starten.";
    chatShell.appendChild(dom.chatStripHint);

    const tabsRow = document.createElement("div");
    tabsRow.className = "ccp-fc-tabs-row";
    dom.tabsRow = tabsRow;
    dom.tabsScroll = document.createElement("div");
    dom.tabsScroll.className = "ccp-fc-tabs-scroll";
    const tabsTools = document.createElement("div");
    tabsTools.className = "ccp-fc-tabs-tools";

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "ccp-fc-tab-tool";
    plus.title = "Neuer Agent";
    plus.setAttribute("aria-label", "Neuer Agent");
    plus.innerHTML = iconPlusSvg();
    plus.addEventListener("click", function (ev) {
      ev.stopPropagation();
      newChatTab();
    });
    const histBtn = document.createElement("button");
    histBtn.type = "button";
    histBtn.className = "ccp-fc-tab-tool";
    histBtn.title = "Verlauf";
    histBtn.setAttribute("aria-label", "Verlauf");
    histBtn.innerHTML = iconHistorySvg();
    histBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      toggleHistoryOverlay();
    });
    tabsTools.appendChild(plus);
    tabsTools.appendChild(histBtn);

    tabsRow.appendChild(dom.tabsScroll);
    tabsRow.appendChild(tabsTools);

    historyOverlay = document.createElement("div");
    historyOverlay.className = "ccp-fc-history-pop";
    tabsRow.appendChild(historyOverlay);
    chatShell.appendChild(tabsRow);

    dom.chatChrome = document.createElement("div");
    dom.chatChrome.className = "ccp-fc-chat-chrome";

    dom.msgScroll = document.createElement("div");
    dom.msgScroll.className = "ccp-fc-msgs";
    dom.chatChrome.appendChild(dom.msgScroll);

    const inputShell = document.createElement("div");
    inputShell.className = "ccp-fc-input-shell";
    dom.inputShell = inputShell;
    const edWrap = document.createElement("div");
    edWrap.className = "ccp-fc-editor-wrap";
    dom.composerEditor = document.createElement("div");
    dom.composerEditor.className = "ccp-fc-composer-editor";
    dom.composerEditor.contentEditable = "true";
    dom.composerEditor.setAttribute("data-placeholder", "Nachricht… (⌘I für Referenz)");
    edWrap.appendChild(dom.composerEditor);

    const toolbar = document.createElement("div");
    toolbar.className = "ccp-fc-toolbar";
    const left = document.createElement("div");
    left.className = "ccp-fc-toolbar-left";
    const right = document.createElement("div");
    right.className = "ccp-fc-toolbar-right";
    right.appendChild(buildUsageDonut());
    const send = document.createElement("button");
    send.type = "button";
    send.className = "ccp-fc-send-round";
    send.setAttribute("aria-label", "Senden");
    send.innerHTML = iconSendSvg();
    send.addEventListener("click", function (ev) {
      ev.preventDefault();
      onSend();
    });
    right.appendChild(send);

    const modeWrap = document.createElement("div");
    modeWrap.className = "ccp-fc-mode-wrap";
    dom.modeBtn = document.createElement("button");
    dom.modeBtn.type = "button";
    dom.modeBtn.className = "ccp-fc-mode-btn";
    dom.modeMenu = document.createElement("div");
    dom.modeMenu.className = "ccp-fc-mode-menu";
    modeWrap.appendChild(dom.modeBtn);
    modeWrap.appendChild(dom.modeMenu);
    dom.modeBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      const willOpen = !dom.modeMenu.classList.contains("ccp-on");
      if (dom.modelMenu) dom.modelMenu.classList.remove("ccp-on");
      dom.modeMenu.classList.toggle("ccp-on", willOpen);
      if (willOpen) renderModeMenu();
    });

    const modelWrap = document.createElement("div");
    modelWrap.className = "ccp-fc-model-wrap";
    dom.modelBtn = document.createElement("button");
    dom.modelBtn.type = "button";
    dom.modelBtn.className = "ccp-fc-model-btn";
    dom.modelMenu = document.createElement("div");
    dom.modelMenu.className = "ccp-fc-model-menu";
    modelWrap.appendChild(dom.modelBtn);
    modelWrap.appendChild(dom.modelMenu);
    dom.modelBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      const willOpen = !dom.modelMenu.classList.contains("ccp-on");
      if (dom.modeMenu) dom.modeMenu.classList.remove("ccp-on");
      dom.modelMenu.classList.toggle("ccp-on", willOpen);
      if (willOpen) renderModelMenu();
    });

    left.appendChild(modeWrap);
    left.appendChild(modelWrap);
    toolbar.appendChild(left);
    toolbar.appendChild(right);
    edWrap.appendChild(toolbar);
    inputShell.appendChild(edWrap);
    dom.chatChrome.appendChild(inputShell);
    chatShell.appendChild(dom.chatChrome);

    root.appendChild(chatShell);
    panel.appendChild(root);

    document.addEventListener(
      "click",
      function docCloseMenus(ev) {
        if (dom.modelMenu && dom.modelMenu.classList.contains("ccp-on") && !modelWrap.contains(ev.target)) {
          dom.modelMenu.classList.remove("ccp-on");
        }
        if (dom.modeMenu && dom.modeMenu.classList.contains("ccp-on") && !modeWrap.contains(ev.target)) {
          dom.modeMenu.classList.remove("ccp-on");
        }
      },
      true
    );

    dom.composerEditor.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        onSend();
      }
    });
    dom.chatStripHint.addEventListener("click", function () {
      if (tabs.length === 0) newChatTab();
    });

    window.addEventListener("resize", function () {
      applyChatSizing();
    });

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(function () {
        applyChatSizing();
      });
      if (dom.integrityWrap) ro.observe(dom.integrityWrap);
      if (dom.tabsRow) ro.observe(dom.tabsRow);
      if (dom.inputShell) ro.observe(dom.inputShell);
    }

    panelEl = panel;
    validationUi = ui;
    ui.flowChatRoot = root;
    void newSession();
    renderModelButtonLabel();
    renderModeButtons();
    renderModelMenu();
    renderModeMenu();
    updateChatChromeVisibility();

    return { integrityList: ibody };
  }

  function focusComposer() {
    if (dom.composerEditor) {
      dom.composerEditor.focus();
    }
  }

  function handleOpenFlowChat() {
    if (window !== window.top) {
      return;
    }
    if (!CCP.namingApi || typeof CCP.namingApi.setFabPanelOpen !== "function") {
      return;
    }
    CCP.namingApi.setFabPanelOpen(true);
    requestAnimationFrame(function () {
      const requestId = "fcc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      function onSel(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (
          !d ||
          d.source !== MSG_INJECT ||
          d.type !== "GET_EDITOR_SELECTION_RESPONSE" ||
          d.requestId !== requestId
        )
          return;
        window.removeEventListener("message", onSel);
        clearTimeout(timer);
        insertReferenceChip(d.payload || {});
        focusComposer();
      }
      const timer = setTimeout(function () {
        window.removeEventListener("message", onSel);
        insertReferenceChip({});
        focusComposer();
      }, 6000);
      window.addEventListener("message", onSel);
      window.postMessage(
        { source: MSG_CONTENT, type: "GET_EDITOR_SELECTION_REQUEST", requestId: requestId },
        "*"
      );
    });
  }

  CCP.flowChatUi = {
    buildFabPanelContent: buildFabPanelContent,
    focusComposer: focusComposer,
    notifyPanelClosed: function () {
      hideHistoryOverlay();
      if (dom.modelMenu) dom.modelMenu.classList.remove("ccp-on");
      if (dom.modeMenu) dom.modeMenu.classList.remove("ccp-on");
    },
  };

  CCP.handlers = CCP.handlers || {};
  CCP.handlers.handleOpenFlowChat = function () {
    handleOpenFlowChat();
  };
})();

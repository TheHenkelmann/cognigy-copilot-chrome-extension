/**
 * Cognigy Copilot — Release wizard UI (Check / Annotate / Build).
 */
(function ccpReleaseUiModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const rel = (CCP.release = CCP.release || {});
  if (rel.ui && rel.ui.__bootstrapped) return;

  const ui = (rel.ui = rel.ui || {});
  ui.__bootstrapped = true;

  const MSG_INJECT = CCP.MSG_INJECT || "COGNIGY_COPILOT_INJECT";
  const MSG_CONTENT = CCP.MSG_CONTENT || "COGNIGY_COPILOT_CONTENT";
  const SETTINGS_KEY = "ccp.releaseSettings";
  const ISSUE_TYPE_NAMING = "naming_convention_violation";
  const MODEL_OPTIONS = [
    { id: "gemini-3.5-flash", label: "gemini-3.5-flash" },
    { id: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite" },
    { id: "gemini-3.1-pro-preview", label: "gemini-3.1-pro-preview" },
  ];
  const DEFAULT_MODEL = "gemini-3.5-flash";
  const FEATURES = {
    aiGenerate: false,
    releaseMessage: false,
    settings: false,
  };

  const CHECK_STEPS = [
    {
      id: "refresh",
      title: "Daten aktualisieren",
      description:
        "Lädt alle Flows und deren Nodes neu vom Server (Hard Refresh), damit der Release auf dem aktuellsten Stand basiert.",
    },
    {
      id: "errors",
      title: "Fehler prüfen",
      description:
        "Prüft, ob Fehlermeldungen (Severity 3) vorhanden sind. Ignorierte Meldungen werden nicht berücksichtigt.",
    },
    {
      id: "warnings",
      title: "Warnungen prüfen",
      description:
        "Prüft, ob Warnmeldungen (Severity 2) vorhanden sind. Ignorierte Meldungen werden nicht berücksichtigt.",
    },
    {
      id: "info",
      title: "Info-Meldungen prüfen",
      description:
        "Prüft, ob Info-Meldungen (Severity 1) vorhanden sind, ausgenommen Naming-Convention-Hinweise. Ignorierte Meldungen werden nicht berücksichtigt.",
    },
    {
      id: "naming",
      title: "Naming Convention prüfen",
      description:
        "Prüft Naming-Convention-Verstöße. Bei Funden kann Autofix All ausgeführt werden; danach wird erneut geprüft.",
    },
    {
      id: "playbooks",
      title: "Playbooks ausführen",
      description: "Startet alle Playbooks in Batches à 100 parallel und wartet auf Abschluss der Tasks.",
    },
  ];

  const BUILD_STEPS = [
    {
      id: "create",
      title: "Snapshot erstellen",
      description: "Erstellt einen neuen Snapshot mit dem Release-Namen.",
    },
    { id: "package", title: "Snapshot packagen", description: "Packt den Snapshot für den Download." },
    { id: "link", title: "Download-Link erstellen", description: "Erzeugt einen temporären Download-Link." },
    {
      id: "download",
      title: "Download starten",
      description: "Startet den automatischen Download und speichert Release-Daten.",
    },
  ];

  const state = {
    overlay: null,
    settingsOverlay: null,
    activeTab: "check",
    checkRunning: false,
    checkSkipped: false,
    checkStepIndex: -1,
    checkStepStates: {},
    checkStepExpanded: {},
    buildRunning: false,
    snapshots: [],
    releasesByName: {},
    selectedSnapshotName: "",
    baselineRelease: null,
    currentFlows: [],
    diffFlows: [],
    selectedFlowName: "",
    releaseName: "",
    releaseMessage: "",
    commitMessage: "",
    snapshotId: null,
    settings: { apiKey: "", model: DEFAULT_MODEL },
    monaco: null,
    diffEditor: null,
    singleEditor: null,
    storedReleaseNames: [],
    nameTakenByUser: false,
    buildReleaseName: "",
  };

  const diffViewerState = {
    overlay: null,
    escHandler: null,
    diffEditor: null,
    singleEditor: null,
    snapshots: [],
    releasesByName: {},
    currentFlows: [],
    diffFlows: [],
    selectedFlowName: "",
    selectedSnapshotName: "",
    baselineRelease: null,
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ensureStyles() {
    if (document.getElementById("ccp-release-styles")) return;
    const st = document.createElement("style");
    st.id = "ccp-release-styles";
    st.textContent = [
      ".ccp-rel-overlay{position:fixed;inset:0;z-index:2147483647;background:#0a0c10;display:flex;flex-direction:column;color:#ececec;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}",
      ".ccp-rel-header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.08);background:#12141a;flex-shrink:0;}",
      ".ccp-rel-title{font-size:16px;font-weight:700;flex:1;}",
      ".ccp-rel-tabs{display:flex;gap:4px;}",
      ".ccp-rel-tab{padding:8px 14px;border-radius:8px;border:1px solid transparent;background:transparent;color:rgba(220,220,220,0.75);font-size:13px;font-weight:600;cursor:pointer;}",
      ".ccp-rel-tab.ccp-on{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.12);color:#fff;}",
      ".ccp-rel-tab:disabled{opacity:0.4;cursor:default;}",
      ".ccp-rel-icon-btn{width:34px;height:34px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#ddd;cursor:pointer;display:flex;align-items:center;justify-content:center;}",
      ".ccp-rel-body{flex:1;display:flex;flex-direction:column;padding:18px;min-height:0;background:#0a0c10;overflow:hidden;}",
      ".ccp-rel-body:has(.ccp-rel-annotate-tab-panel){padding:0;}",
      ".ccp-rel-tab-panel{display:none;flex:1;min-height:0;overflow:auto;}",
      ".ccp-rel-tab-panel.ccp-rel-check-tab{display:flex;flex-direction:column;overflow:hidden;}",
      ".ccp-rel-tab-panel.ccp-rel-annotate-tab-panel{display:flex;flex-direction:column;overflow:hidden;padding:0;min-height:0;flex:1;}",
      ".ccp-rel-actions{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}",
      ".ccp-rel-btn{padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:#eee;font-size:13px;font-weight:600;cursor:pointer;}",
      ".ccp-rel-btn:hover:not(:disabled){background:rgba(255,255,255,0.1);}",
      ".ccp-rel-btn:disabled{opacity:0.45;cursor:default;}",
      ".ccp-rel-btn-primary{background:rgba(59,130,246,0.25);border-color:rgba(59,130,246,0.45);}",
      ".ccp-rel-btn-danger{background:rgba(220,38,38,0.2);border-color:rgba(220,38,38,0.4);}",
      ".ccp-rel-check-tab{flex:1;min-height:0;display:flex;flex-direction:column;}",
      ".ccp-rel-check-steps{flex:1;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;}",
      ".ccp-rel-step{border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:#181b22;overflow:hidden;flex-shrink:0;}",
      ".ccp-rel-step.ccp-expanded{flex:1 1 auto;max-height:80%;min-height:0;display:flex;flex-direction:column;}",
      ".ccp-rel-step-head{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;user-select:none;}",
      ".ccp-rel-step-head:hover{background:rgba(255,255,255,0.03);}",
      ".ccp-rel-step-chevron{width:14px;flex-shrink:0;font-size:10px;color:rgba(180,180,180,0.85);transition:transform 0.15s ease;line-height:1;}",
      ".ccp-rel-step.ccp-expanded .ccp-rel-step-chevron{transform:rotate(90deg);}",
      ".ccp-rel-step-head-tools{display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0;}",
      ".ccp-rel-step-icon{width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;}",
      ".ccp-rel-step-title{font-size:13px;font-weight:600;flex:1;min-width:0;}",
      ".ccp-rel-step-head .ccp-rel-btn{padding:5px 10px;font-size:11px;}",
      ".ccp-rel-btn-fixall{background:rgba(34,197,94,0.22)!important;border-color:rgba(34,197,94,0.55)!important;color:#86efac!important;}",
      ".ccp-rel-btn-fixall:hover:not(:disabled){background:rgba(34,197,94,0.32)!important;}",
      ".ccp-rel-step-body{padding:0 12px 12px 12px;font-size:12px;line-height:1.5;color:rgba(220,220,220,0.85);display:none;min-height:0;}",
      ".ccp-rel-step.ccp-expanded .ccp-rel-step-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;}",
      ".ccp-rel-step-desc{color:rgba(180,180,180,0.9);margin-bottom:8px;}",
      ".ccp-rel-step-detail{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,0.25);border-radius:6px;padding:8px;max-height:180px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;flex-shrink:0;}",
      ".ccp-rel-step.ccp-expanded .ccp-rel-step-detail{flex:1;max-height:none;min-height:0;overflow:auto;}",
      ".ccp-rel-step-detail.ccp-rel-step-visual{white-space:normal;font-family:inherit;font-size:12px;max-height:320px;padding:0;background:transparent;}",
      ".ccp-rel-step.ccp-expanded .ccp-rel-step-detail.ccp-rel-step-visual{max-height:none;display:flex;flex-direction:column;}",
      ".ccp-rel-check-panel{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;overflow:hidden;}",
      ".ccp-rel-check-hint{font-size:12px;color:rgba(180,180,180,0.95);padding:4px 2px;}",
      ".ccp-rel-meta-row{display:flex;flex-wrap:wrap;gap:8px;}",
      ".ccp-rel-meta-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);font-size:12px;font-weight:600;color:#e8e8e8;}",
      ".ccp-rel-meta-ic{font-size:13px;line-height:1;opacity:0.85;}",
      ".ccp-rel-meta-txt{line-height:1.2;}",
      ".ccp-rel-item-list{display:flex;flex-direction:column;gap:4px;max-height:240px;overflow:auto;padding:2px 0;flex-shrink:0;}",
      ".ccp-rel-step.ccp-expanded .ccp-rel-item-list{flex:1;max-height:none;min-height:0;}",
      ".ccp-rel-check-item{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.06);}",
      ".ccp-rel-check-item.ccp-rel-st-running{border-color:rgba(59,130,246,0.35);background:rgba(59,130,246,0.08);}",
      ".ccp-rel-check-item.ccp-rel-st-success{border-color:rgba(34,197,94,0.3);background:rgba(34,197,94,0.06);}",
      ".ccp-rel-check-item.ccp-rel-st-failed{border-color:rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);}",
      ".ccp-rel-check-item-ic{width:18px;flex-shrink:0;text-align:center;font-size:13px;line-height:1.4;}",
      ".ccp-rel-check-item-body{flex:1;min-width:0;}",
      ".ccp-rel-check-item-title{font-size:12px;font-weight:600;color:#eee;line-height:1.35;word-break:break-word;}",
      ".ccp-rel-check-item-meta{font-size:11px;color:rgba(180,180,180,0.9);margin-top:2px;line-height:1.4;word-break:break-word;}",
      ".ccp-rel-check-item-meta:empty{display:none;}",
      ".ccp-rel-check-item-link{display:inline-block;margin-top:4px;font-size:11px;color:#93c5fd;text-decoration:none;}",
      ".ccp-rel-check-item-link:hover{text-decoration:underline;color:#bfdbfe;}",
      ".ccp-rel-step-err{font-size:11px;color:#fca5a5;margin-top:4px;line-height:1.4;}",
      ".ccp-rel-field{margin-bottom:14px;}",
      ".ccp-rel-label{display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:rgba(220,220,220,0.9);}",
      ".ccp-rel-input,.ccp-rel-textarea{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:#0f1117;color:#eee;font-size:13px;font-family:inherit;}",
      ".ccp-rel-textarea{min-height:120px;resize:vertical;}",
      ".ccp-rel-char-count{font-size:11px;color:rgba(160,160,160,0.9);margin-top:4px;text-align:right;}",
      ".ccp-rel-char-count.ccp-over{color:#f87171;}",
      ".ccp-rel-warn{padding:10px 12px;border-radius:8px;background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.35);color:#fde68a;font-size:12px;margin-bottom:12px;}",
      ".ccp-rel-annotate-tab{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;height:100%;}",
      ".ccp-rel-annotate-head{flex-shrink:0;}",
      ".ccp-rel-annotate-toolbar{display:flex;align-items:flex-end;gap:12px;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,0.08);background:#0a0c10;flex-shrink:0;}",
      ".ccp-rel-annotate-toolbar-name{flex:0 0 220px;min-width:160px;position:relative;}",
      ".ccp-rel-annotate-toolbar-commit{flex:1 1 auto;min-width:0;}",
      ".ccp-rel-annotate-toolbar-build{flex:0 0 auto;}",
      ".ccp-rel-annotate-toolbar .ccp-rel-field{margin-bottom:0;width:100%;}",
      ".ccp-rel-annotate-toolbar .ccp-rel-label{margin-bottom:4px;font-size:11px;}",
      ".ccp-rel-annotate-toolbar .ccp-rel-input{padding:7px 10px;}",
      ".ccp-rel-annotate-toolbar .ccp-rel-char-count{margin-top:2px;font-size:10px;display:none;}",
      ".ccp-rel-annotate-toolbar .ccp-rel-name-warn{position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:2;padding:6px 8px;font-size:11px;}",
      ".ccp-rel-annotate-toolbar-build .ccp-rel-btn{white-space:nowrap;}",
      ".ccp-rel-annotate-diff{flex:1 1 auto;display:flex;flex-direction:column;min-height:0;width:100%;box-sizing:border-box;overflow:hidden;}",
      ".ccp-rel-annotate-copy-row{display:flex;gap:8px;flex-wrap:wrap;margin:0;}",
      ".ccp-rel-diff-panel .ccp-rel-diff-layout{flex:1;min-height:0;}",
      ".ccp-rel-btn.ccp-rel-btn-copied{background:rgba(34,197,94,0.25)!important;border-color:rgba(34,197,94,0.5)!important;color:#86efac!important;}",
      ".ccp-rel-diff-wrap{display:flex;gap:0;flex:1;min-height:0;min-width:0;width:100%;max-width:100%;border-top:1px solid rgba(255,255,255,0.08);overflow:hidden;background:#0f1117;box-sizing:border-box;}",
      ".ccp-rel-flow-list{flex:0 0 240px;width:240px;max-width:240px;min-width:0;border-left:1px solid rgba(255,255,255,0.08);overflow-x:hidden;overflow-y:auto;box-sizing:border-box;scrollbar-gutter:stable;padding:0;}",
      ".ccp-rel-flow-item{display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:hidden;}",
      ".ccp-rel-flow-item-name{display:block;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".ccp-rel-flow-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}",
      ".ccp-rel-flow-dot-added{background:#22c55e;}",
      ".ccp-rel-flow-dot-removed{background:#ef4444;}",
      ".ccp-rel-flow-dot-changed{background:#3b82f6;}",
      ".ccp-rel-flow-item:hover{background:rgba(255,255,255,0.04);}",
      ".ccp-rel-flow-item.ccp-on{background:rgba(59,130,246,0.18);}",
      ".ccp-rel-diff-editor{flex:1;min-width:0;min-height:0;}",
      ".ccp-rel-md-preview{padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.2);font-size:13px;line-height:1.5;min-height:80px;}",
      ".ccp-rel-md-preview h1,.ccp-rel-md-preview h2,.ccp-rel-md-preview h3{font-size:14px;margin:8px 0 4px;}",
      ".ccp-rel-md-preview code{background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:4px;}",
      ".ccp-rel-md-preview pre{background:rgba(0,0,0,0.35);padding:8px;border-radius:6px;overflow:auto;}",
      ".ccp-rel-thoughts{padding:8px 10px;border-radius:8px;background:rgba(80,80,120,0.15);border:1px solid rgba(120,120,180,0.25);font-size:11px;color:rgba(200,200,230,0.9);max-height:120px;overflow:auto;white-space:pre-wrap;margin-top:8px;display:none;}",
      ".ccp-rel-thoughts.ccp-on{display:block;}",
      ".ccp-rel-snap-list-wrap{margin-bottom:12px;}",
      ".ccp-rel-snap-list-wrap .ccp-rel-label{margin-bottom:6px;}",
      ".ccp-rel-snap-items{display:flex;flex-direction:column;gap:4px;}",
      ".ccp-rel-snap-item{padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.06);font-size:12px;line-height:1.4;color:rgba(220,220,220,0.9);}",
      ".ccp-rel-snap-item-name{font-weight:600;color:#eee;}",
      ".ccp-rel-snap-item-meta{font-size:11px;color:rgba(160,160,160,0.95);margin-top:2px;}",
      ".ccp-rel-fab-btn-row{display:flex;flex-direction:column;gap:8px;width:100%;}",
      ".ccp-rel-fab-btn-row .ccp-rel-fab-btn{width:100%;}",
      ".ccp-rel-btn-copy-icon{display:inline-flex;align-items:center;gap:6px;}",
      ".ccp-rel-copy-ic{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;}",
      ".ccp-rel-copy-ic svg{display:block;}",
      ".ccp-rel-diff-overlay{position:fixed;inset:0;z-index:2147483647;background:#1e1e1e;display:flex;flex-direction:column;color:#cccccc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}",
      ".ccp-rel-diff-close{position:absolute;top:12px;right:12px;z-index:3;width:34px;height:34px;border-radius:6px;border:1px solid #454545;background:#252526;color:#cccccc;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;}",
      ".ccp-rel-diff-close:hover{background:#2a2d2e;color:#ffffff;}",
      ".ccp-rel-diff-layout{display:flex;flex:1;min-height:0;height:100%;width:100%;background:#1e1e1e;}",
      ".ccp-rel-diff-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:#1e1e1e;}",
      ".ccp-rel-diff-main-editor{flex:1;min-width:0;min-height:0;background:#1e1e1e;}",
      ".ccp-rel-diff-sidebar{flex:0 0 280px;width:280px;max-width:280px;min-width:0;display:flex;flex-direction:column;border-right:1px solid #454545;background:#252526;box-sizing:border-box;overflow:hidden;color:#cccccc;}",
      ".ccp-rel-diff-sidebar-head{flex-shrink:0;padding:12px;border-bottom:1px solid #454545;display:flex;flex-direction:column;gap:10px;background:#252526;}",
      ".ccp-rel-diff-sidebar-head .ccp-rel-label{margin:0;font-size:12px;color:#cccccc;}",
      ".ccp-rel-diff-sidebar-head .ccp-rel-annotate-copy-row{margin:0;}",
      ".ccp-rel-diff-panel .ccp-rel-snap-select{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid #454545;background:#3c3c3c;color:#cccccc;font-size:12px;font-family:inherit;}",
      ".ccp-rel-diff-panel .ccp-rel-snap-select option:disabled{color:#858585;}",
      ".ccp-rel-diff-panel .ccp-rel-snap-select option{background:#3c3c3c;color:#cccccc;}",
      ".ccp-rel-diff-sidebar .ccp-rel-flow-list{flex:1;min-height:0;border-left:none;width:100%;max-width:100%;flex-basis:auto;background:#252526;}",
      ".ccp-rel-diff-panel .ccp-rel-flow-item{border-bottom:1px solid #333333;color:#cccccc;}",
      ".ccp-rel-diff-panel .ccp-rel-flow-item:hover{background:#2a2d2e;}",
      ".ccp-rel-diff-panel .ccp-rel-flow-item.ccp-on{background:#094771;color:#ffffff;}",
      ".ccp-rel-diff-panel .ccp-rel-btn{border:1px solid #454545;background:#3c3c3c;color:#cccccc;}",
      ".ccp-rel-diff-panel .ccp-rel-btn:hover:not(:disabled){background:#505050;color:#ffffff;}",
      ".ccp-rel-diff-panel .ccp-rel-btn.ccp-rel-btn-copied{background:#094771!important;border-color:#007acc!important;color:#ffffff!important;}",
      ".ccp-rel-diff-empty{padding:24px;font-size:13px;color:#858585;}",
      ".ccp-rel-settings-card{max-width:480px;margin:10vh auto;padding:20px;border-radius:12px;background:#181b22;border:1px solid rgba(255,255,255,0.1);box-shadow:0 20px 60px rgba(0,0,0,0.5);}",
      ".ccp-rel-settings-row{margin-bottom:14px;}",
      ".ccp-rel-pw-wrap{display:flex;gap:8px;align-items:center;}",
      ".ccp-rel-pw-wrap input{flex:1;}",
      ".ccp-rel-fab-btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(59,130,246,0.18);color:#dbeafe;font-size:12px;font-weight:600;cursor:pointer;}",
      ".ccp-rel-fab-btn:hover{background:rgba(59,130,246,0.28);}",
      ".ccp-rel-name-warn{padding:8px 10px;border-radius:8px;background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.35);color:#fde68a;font-size:12px;margin-top:6px;display:none;}",
    ].join("");
    document.head.appendChild(st);
  }

  function statusIcon(status) {
    if (status === "running") return "⏳";
    if (status === "success") return "✅";
    if (status === "failed") return "❌";
    if (status === "skipped") return "⏭";
    return "○";
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      const requestId = "rls-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== MSG_CONTENT || d.type !== "CHAT_STORAGE_RESULT" || d.requestId !== requestId)
          return;
        window.removeEventListener("message", onMsg);
        resolve((d.payload && d.payload.data) || {});
      }
      window.addEventListener("message", onMsg);
      window.postMessage(
        { source: MSG_INJECT, type: "CHAT_STORAGE_GET", requestId: requestId, keys: keys },
        "*"
      );
      setTimeout(function () {
        window.removeEventListener("message", onMsg);
        resolve({});
      }, 5000);
    });
  }

  function storageSet(items) {
    return new Promise(function (resolve) {
      const requestId = "rls-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== MSG_CONTENT || d.type !== "CHAT_STORAGE_RESULT" || d.requestId !== requestId)
          return;
        window.removeEventListener("message", onMsg);
        resolve(d.payload && d.payload.ok);
      }
      window.addEventListener("message", onMsg);
      window.postMessage(
        { source: MSG_INJECT, type: "CHAT_STORAGE_SET", requestId: requestId, items: items },
        "*"
      );
      setTimeout(function () {
        window.removeEventListener("message", onMsg);
        resolve(false);
      }, 5000);
    });
  }

  async function loadSettings() {
    const data = await storageGet([SETTINGS_KEY]);
    const s = data[SETTINGS_KEY];
    state.settings.apiKey = "";
    state.settings.model = DEFAULT_MODEL;
    if (s && typeof s === "object") {
      if (s.apiKey) state.settings.apiKey = String(s.apiKey);
      if (s.model) state.settings.model = String(s.model);
    }
  }

  async function saveSettings() {
    const payload = {};
    payload[SETTINGS_KEY] = { apiKey: state.settings.apiKey, model: state.settings.model };
    await storageSet(payload);
  }

  function streamGemini(opts, handlers) {
    const h = handlers || {};
    return new Promise(function (resolve, reject) {
      const requestId = "gem-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== MSG_CONTENT || d.requestId !== requestId) return;
        if (d.type === "GEMINI_GENERATE_CHUNK") {
          const p = d.payload || {};
          if (p.type === "thought" && typeof h.onThought === "function") h.onThought(p.text || "");
          if (p.type === "answer" && typeof h.onAnswer === "function") h.onAnswer(p.text || "");
        }
        if (d.type === "GEMINI_GENERATE_DONE") {
          window.removeEventListener("message", onMsg);
          resolve();
        }
        if (d.type === "GEMINI_GENERATE_ERROR") {
          window.removeEventListener("message", onMsg);
          reject(new Error(d.error || "Gemini error"));
        }
      }
      window.addEventListener("message", onMsg);
      window.postMessage(
        {
          source: MSG_INJECT,
          type: "GEMINI_GENERATE_REQUEST",
          requestId: requestId,
          payload: opts,
        },
        "*"
      );
      setTimeout(
        function () {
          window.removeEventListener("message", onMsg);
          reject(new Error("Gemini request timed out"));
        },
        5 * 60 * 1000
      );
    });
  }

  function renderMarkdown(text) {
    let s = String(text || "");
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    s = s.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    s = s.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/^- (.+)$/gm, "<li>$1</li>");
    s = s.replace(/(<li>.*<\/li>\n?)+/g, function (m) {
      return "<ul>" + m + "</ul>";
    });
    s = s.replace(/\n/g, "<br>");
    return s;
  }

  function resolveExtensionAssetUrl(relativePath) {
    try {
      const baseSrc = CCP.bootstrapScriptSrc ? String(CCP.bootstrapScriptSrc) : "";
      if (!baseSrc) return "";
      return new URL(String(relativePath || "").replace(/^\/+/, ""), baseSrc).toString();
    } catch (_) {
      return "";
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = function () {
        resolve();
      };
      script.onerror = function (e) {
        reject(e);
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function isUsableReleaseMonaco(monaco) {
    if (!monaco || !monaco.editor || monaco._partial) return false;
    if (typeof monaco.editor.createDiffEditor === "function") return true;
    if (typeof monaco.editor.create === "function") return true;
    return false;
  }

  function resolveMonacoFromWindow() {
    try {
      const candidates = [window.monaco, globalThis.monaco];
      for (let i = 0; i < candidates.length; i++) {
        if (isUsableReleaseMonaco(candidates[i])) return candidates[i];
      }
    } catch (_) {}
    return null;
  }

  function resolveMonacoFromBridge() {
    try {
      const bridge = CCP.monacoBridge;
      if (bridge && typeof bridge.getMonacoApi === "function") {
        const monaco = bridge.getMonacoApi();
        if (isUsableReleaseMonaco(monaco)) return monaco;
      }
    } catch (_) {}
    return null;
  }

  function isAmdRequire(fn) {
    return typeof fn === "function" && typeof fn.config === "function";
  }

  let monacoLoadPromise = null;

  function loadBundledMonaco() {
    if (monacoLoadPromise) return monacoLoadPromise;
    monacoLoadPromise = new Promise(async function (resolve) {
      const existing = resolveMonacoFromWindow() || resolveMonacoFromBridge();
      if (existing) {
        resolve(existing);
        return;
      }

      const loaderUrl = resolveExtensionAssetUrl("inject/vendor/monaco/vs/loader.js");
      if (!loaderUrl) {
        console.warn("[CCP release-ui] monaco loader url unavailable");
        resolve(null);
        return;
      }

      let settled = false;
      function finish(monaco) {
        if (settled) return;
        settled = true;
        resolve(isUsableReleaseMonaco(monaco) ? monaco : resolveMonacoFromWindow());
      }

      const timeoutId = setTimeout(function () {
        console.warn("[CCP release-ui] monaco load timed out");
        finish(null);
      }, 30000);

      try {
        const savedDefine = window.define;
        const savedRequire = window.require;
        if (savedDefine && savedDefine.amd) {
          try {
            delete window.define;
          } catch (_) {
            window.define = undefined;
          }
        }
        if (savedRequire && !isAmdRequire(savedRequire)) {
          try {
            delete window.require;
          } catch (_) {
            window.require = undefined;
          }
        }

        await loadScript(loaderUrl);

        const amdRequire = window.require;
        if (!isAmdRequire(amdRequire)) {
          console.warn("[CCP release-ui] AMD require unavailable after monaco loader");
          clearTimeout(timeoutId);
          finish(null);
          return;
        }

        const baseVsUrl = resolveExtensionAssetUrl("inject/vendor/monaco/vs");
        amdRequire.config({ paths: { vs: baseVsUrl } });
        amdRequire(
          ["vs/editor/editor.main"],
          function () {
            clearTimeout(timeoutId);
            finish(resolveMonacoFromWindow());
          },
          function (err) {
            console.warn("[CCP release-ui] monaco require failed", err);
            clearTimeout(timeoutId);
            finish(null);
          }
        );
      } catch (error) {
        console.warn("[CCP release-ui] monaco load failed", error);
        clearTimeout(timeoutId);
        finish(null);
      }
    });
    return monacoLoadPromise;
  }

  async function ensureMonaco() {
    if (state.monaco && isUsableReleaseMonaco(state.monaco)) return state.monaco;

    const existing = resolveMonacoFromWindow() || resolveMonacoFromBridge();
    if (existing) {
      state.monaco = existing;
      return existing;
    }

    const monaco = await loadBundledMonaco();
    if (monaco) {
      state.monaco = monaco;
      return monaco;
    }
    monacoLoadPromise = null;
    return null;
  }

  function getVisibleUiIssues() {
    if (CCP.namingApi && typeof CCP.namingApi.getVisibleProjectMapIssues === "function") {
      return CCP.namingApi.getVisibleProjectMapIssues();
    }
    return [];
  }

  async function getNamingIssuesRaw() {
    if (CCP.namingApi && typeof CCP.namingApi.runNamingConventionScanNow === "function") {
      await CCP.namingApi.runNamingConventionScanNow();
    }
    const ns = window.__cognigyCopilotNamingState;
    if (ns && ns.validation) return ns.validation.namingConventionIssues || [];
    return [];
  }

  function getVisibleNamingIssues() {
    return getVisibleUiIssues().filter(function (i) {
      return i.type === ISSUE_TYPE_NAMING;
    });
  }

  function getFirstAlphabeticalFlow() {
    const map = CCP.namingApi && CCP.namingApi.getProjectMap ? CCP.namingApi.getProjectMap() : null;
    if (!map || !Array.isArray(map.flows) || !map.flows.length) return null;
    const sorted = map.flows.slice().sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    });
    const flow = sorted[0];
    return {
      id: flow._id || flow.id || "",
      reference_id: flow.reference_id || flow.referenceId || "",
      name: flow.name || "",
    };
  }

  function checkItemStatusIcon(status) {
    if (status === "running") return "⏳";
    if (status === "success") return "✅";
    if (status === "failed") return "❌";
    return "○";
  }

  function resetDetailVisual(detailEl) {
    detailEl.className = "ccp-rel-step-detail ccp-rel-step-visual";
    detailEl.innerHTML = "";
  }

  function resetDetailText(detailEl) {
    detailEl.className = "ccp-rel-step-detail";
  }

  function createCheckItem(name, status, subtext) {
    const st = status || "open";
    const item = el("div", "ccp-rel-check-item ccp-rel-st-" + st);
    const ic = el("span", "ccp-rel-check-item-ic", checkItemStatusIcon(st));
    const body = el("div", "ccp-rel-check-item-body");
    const title = el("div", "ccp-rel-check-item-title", name);
    const meta = el("div", "ccp-rel-check-item-meta", subtext || "");
    body.appendChild(title);
    body.appendChild(meta);
    item.appendChild(ic);
    item.appendChild(body);
    return { item: item, ic: ic, title: title, meta: meta, body: body, link: null };
  }

  function setCheckItemLink(view, href, label) {
    if (!view || !view.body) return;
    if (!href) {
      if (view.link) view.link.style.display = "none";
      return;
    }
    if (!view.link) {
      view.link = el("a", "ccp-rel-check-item-link", label || "Run öffnen");
      view.link.target = "_blank";
      view.link.rel = "noopener noreferrer";
      view.body.appendChild(view.link);
    }
    view.link.href = href;
    view.link.textContent = label || "Run öffnen";
    view.link.style.display = "";
  }

  function updateCheckItem(view, status, subtext, linkHref) {
    view.item.className = "ccp-rel-check-item ccp-rel-st-" + status;
    view.ic.textContent = checkItemStatusIcon(status);
    if (subtext != null) view.meta.textContent = subtext;
    if (linkHref !== undefined) setCheckItemLink(view, linkHref);
  }

  function getCognigyProjectBaseUrl() {
    const m = String(window.location.href || "").match(
      /^(https?:\/\/[^/]+\/project\/[a-z0-9]{24}\/[a-z0-9]{24})/i
    );
    return m ? m[1] : "";
  }

  function buildPlaybookRunUrl(playbookId, playbookRunId) {
    const base = getCognigyProjectBaseUrl();
    const pbId = String(playbookId || "");
    const runId = String(playbookRunId || "");
    if (!base || !pbId || !runId) return "";
    return base + "/playbook/" + pbId + "/run/" + runId;
  }

  function playbookRunLink(run) {
    if (!run) return "";
    const pb = run.playbook || {};
    const pbId = pb._id || pb.id || run.playbookId;
    const runId = run.playbookRunId || run.taskId;
    return buildPlaybookRunUrl(pbId, runId);
  }

  function playbookUiStatus(run, phase) {
    if (phase === "start") return "running";
    if (!run) return "open";
    if (run.error || String(run.status || "").toLowerCase() === "error") return "failed";
    const st = String(run.status || "").toLowerCase();
    if (st === "done") return "success";
    if (st === "cancelled" || st === "cancelling") return "failed";
    if (phase === "done" && playbookRunFailed(run)) return "failed";
    if (phase === "done") return "success";
    if (st === "active") return "running";
    if (st === "queued" || st === "pending") return "open";
    return "open";
  }

  function playbookUiMessage(run, phase) {
    if (phase === "start") return "Starte…";
    if (!run) return "";
    if (run.error) return String(run.error);
    const st = String(run.status || "").toLowerCase();
    if (phase === "scheduled" && st === "queued") return "Geplant";
    if (st === "active") return "Task läuft…";
    if (st === "done") return "Erfolgreich";
    if (st === "queued" || st === "pending") return "Wartet…";
    if (phase === "done") return playbookRunMessage(run);
    return st || "";
  }

  function createMetaChip(icon, text) {
    const chip = el("span", "ccp-rel-meta-chip");
    chip.appendChild(el("span", "ccp-rel-meta-ic", icon));
    chip.appendChild(el("span", "ccp-rel-meta-txt", text || ""));
    return chip;
  }

  function sortIssuesForDisplay(a, b) {
    const flowA = String((a && (a.flowName || a.flowId)) || "").toLowerCase();
    const flowB = String((b && (b.flowName || b.flowId)) || "").toLowerCase();
    if (flowA !== flowB) return flowA.localeCompare(flowB);
    const nodeA = String((a && (a.nodeName || a.nodeId)) || "").toLowerCase();
    const nodeB = String((b && (b.nodeName || b.nodeId)) || "").toLowerCase();
    if (nodeA !== nodeB) return nodeA.localeCompare(nodeB);
    return String((a && a.message) || "").localeCompare(String((b && b.message) || ""));
  }

  function issueItemTitle(issue) {
    const flow = String((issue && (issue.flowName || issue.flowId)) || "").trim();
    const node = String((issue && (issue.nodeName || issue.nodeId)) || "").trim();
    if (flow && node) return flow + " / " + node;
    if (flow) return flow;
    if (node) return node;
    return String((issue && issue.type) || "Issue");
  }

  function createIssuesListView(detailEl, issues, opts) {
    resetDetailVisual(detailEl);
    const o = opts || {};
    const panel = el("div", "ccp-rel-check-panel");
    const hint = el("div", "ccp-rel-check-hint", o.hint || "");
    const list = el("div", "ccp-rel-item-list");
    panel.appendChild(hint);
    panel.appendChild(list);
    detailEl.appendChild(panel);

    const sorted = (issues || []).slice().sort(sortIssuesForDisplay);
    if (!sorted.length) {
      hint.textContent = o.emptyHint || "Keine Einträge.";
      return { count: 0, panel: panel, list: list, hint: hint };
    }
    hint.textContent = o.countHint || sorted.length + " Einträge";
    sorted.forEach(function (issue) {
      const status = Number(issue.severity) === 3 ? "failed" : "open";
      const view = createCheckItem(issueItemTitle(issue), status, String(issue.message || ""));
      if (issue.url) {
        setCheckItemLink(view, issue.url, "Node öffnen");
      }
      list.appendChild(view.item);
    });
    return { count: sorted.length, panel: panel, list: list, hint: hint };
  }

  function flowDisplayName(flowId, map) {
    const f = map && map.getFlow ? map.getFlow(flowId) : null;
    if (f && f.name) return f.name;
    const sid = String(flowId || "");
    if (sid.length > 8) return "Flow " + sid.slice(0, 8) + "…";
    return sid || "Flow";
  }

  function createFlowLoadView(detailEl, map) {
    resetDetailVisual(detailEl);
    const panel = el("div", "ccp-rel-check-panel");
    const hint = el("div", "ccp-rel-check-hint", "Bereite Laden vor…");
    const list = el("div", "ccp-rel-item-list");
    panel.appendChild(hint);
    panel.appendChild(list);
    detailEl.appendChild(panel);
    const byFlowId = {};

    function ensureFlow(flowId, status) {
      const sid = String(flowId || "");
      if (!sid) return null;
      if (byFlowId[sid]) return byFlowId[sid];
      const view = createCheckItem(flowDisplayName(sid, map), status || "open", "Wartet…");
      list.appendChild(view.item);
      byFlowId[sid] = view;
      return view;
    }

    return {
      hint: hint,
      list: list,
      ensureFlow: ensureFlow,
      resetAndInitFromFlowMeta: function (flowMetas) {
        list.innerHTML = "";
        Object.keys(byFlowId).forEach(function (k) {
          delete byFlowId[k];
        });
        const sorted = (flowMetas || []).slice().sort(function (a, b) {
          return String(a.name || a.id || "").localeCompare(String(b.name || b.id || ""), undefined, {
            sensitivity: "base",
          });
        });
        hint.textContent = sorted.length ? "Lade " + sorted.length + " Flows…" : "Keine Flows im Projekt";
        sorted.forEach(function (f) {
          const id = f.id || f._id;
          if (!id || byFlowId[id]) return;
          const view = createCheckItem(f.name || id, "open", "Wartet…");
          list.appendChild(view.item);
          byFlowId[id] = view;
        });
      },
      initFromFlows: function (flows) {
        const sorted = (flows || []).slice().sort(function (a, b) {
          return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
        });
        hint.textContent = sorted.length ? "Lade " + sorted.length + " Flows…" : "Lade Flows…";
        sorted.forEach(function (f) {
          const id = f._id || f.id;
          if (!id || byFlowId[id]) return;
          const view = createCheckItem(f.name || id, "open", "Wartet…");
          list.appendChild(view.item);
          byFlowId[id] = view;
        });
      },
      updateFlow: function (flowId, status, nodeDone, nodeTotal) {
        const v = ensureFlow(flowId, status);
        if (!v) return;
        let sub = "";
        if (status === "running") sub = "Nodes: " + nodeDone + " / " + (nodeTotal || "?");
        else if (status === "success") {
          sub = nodeTotal != null && nodeTotal > 0 ? nodeDone + " Nodes geladen" : "Geladen";
        } else if (status === "open") sub = "Wartet…";
        updateCheckItem(v, status, sub);
        if (map && map.getFlow) {
          const nm = flowDisplayName(flowId, map);
          if (nm) v.title.textContent = nm;
        }
      },
      finalize: function (projectMap) {
        const flows = (projectMap && projectMap.flows) || [];
        hint.textContent = "Hard Refresh abgeschlossen — " + flows.length + " Flows";
        flows.forEach(function (f) {
          const id = f._id || f.id;
          if (!id) return;
          if (!byFlowId[id]) ensureFlow(id, "success");
          const nodes = Array.isArray(f.nodes) ? f.nodes.length : 0;
          updateCheckItem(byFlowId[id], "success", nodes + " Nodes");
          if (f.name) byFlowId[id].title.textContent = f.name;
        });
      },
    };
  }

  function createPlaybookRunView(detailEl) {
    resetDetailVisual(detailEl);
    const panel = el("div", "ccp-rel-check-panel");
    const meta = el("div", "ccp-rel-meta-row");
    const flowChip = createMetaChip("⎇", "…");
    const localeChip = createMetaChip("🌐", "…");
    meta.appendChild(flowChip);
    meta.appendChild(localeChip);
    const list = el("div", "ccp-rel-item-list");
    panel.appendChild(meta);
    panel.appendChild(list);
    detailEl.appendChild(panel);
    const items = [];

    return {
      setFlow: function (name) {
        flowChip.querySelector(".ccp-rel-meta-txt").textContent = name || "—";
      },
      setLocale: function (name) {
        localeChip.querySelector(".ccp-rel-meta-txt").textContent = name || "—";
      },
      setPlaybooks: function (playbooks) {
        list.innerHTML = "";
        items.length = 0;
        (playbooks || []).forEach(function (pb) {
          const name = pb.name || pb._id || pb.id || "?";
          const view = createCheckItem(name, "open", "");
          list.appendChild(view.item);
          items.push(view);
        });
      },
      updatePlaybook: function (index, status, message, linkHref) {
        const v = items[index];
        if (!v) return;
        updateCheckItem(v, status, message || "", linkHref);
      },
      items: items,
    };
  }

  function playbookRunMessage(run) {
    if (!run) return "";
    if (run.error) return String(run.error);
    const st = String(run.status || "").toLowerCase();
    if (st === "done") return "Erfolgreich";
    return st || "Unbekannt";
  }

  function playbookRunFailed(run) {
    return !!(run && (run.error || String(run.status || "").toLowerCase() !== "done"));
  }

  function appendStepError(detailEl, message) {
    if (!detailEl.classList.contains("ccp-rel-step-visual")) {
      detailEl.textContent = (detailEl.textContent || "") + "\n\nFehler: " + message;
      return;
    }
    const panel = detailEl.querySelector(".ccp-rel-check-panel");
    if (!panel) return;
    let errEl = panel.querySelector(".ccp-rel-step-err");
    if (!errEl) {
      errEl = el("div", "ccp-rel-step-err");
      panel.appendChild(errEl);
    }
    errEl.textContent = message;
  }

  async function persistReleasePayload(partial) {
    const payload = await CCP.release.buildCurrentReleasePayload(
      Object.assign(
        {
          release_name: state.releaseName.trim(),
          snapshot_id: state.snapshotId || null,
          release_message: state.releaseMessage,
          commit_message: state.commitMessage,
          download_link: "",
        },
        partial || {}
      )
    );
    await CCP.release.save(payload);
    if (payload.release_name && state.storedReleaseNames.indexOf(payload.release_name) < 0) {
      state.storedReleaseNames.push(payload.release_name);
    }
    return payload;
  }

  function formatIssuesList(issues, max) {
    const lim = max || 20;
    const lines = [];
    for (let i = 0; i < Math.min(issues.length, lim); i++) {
      const iss = issues[i];
      const flow =
        iss.flow && (iss.flow.name || iss.flow.id || iss.flow._id)
          ? iss.flow.name || iss.flow.id
          : iss.flowName || "";
      const node =
        iss.node && (iss.node.label || iss.node.id) ? iss.node.label || iss.node.id : iss.nodeName || "";
      lines.push(
        "- [" +
          (iss.severity || "?") +
          "] " +
          (iss.type || "") +
          ": " +
          (iss.message || "") +
          (flow ? " (" + flow + (node ? " / " + node : "") + ")" : "")
      );
    }
    if (issues.length > lim) lines.push("… und " + (issues.length - lim) + " weitere");
    return lines.join("\n");
  }

  async function runCheckStep(stepId, detailEl) {
    const projectId = CCP.namingApi.getProjectId();
    if (stepId === "refresh") {
      const map = CCP.namingApi.getProjectMap();
      if (!map) throw new Error("Project map nicht verfügbar");
      if (!CCP.namingApi.runHardProjectMapRefresh) {
        throw new Error("Hard Refresh nicht verfügbar");
      }
      const view = createFlowLoadView(detailEl, map);
      view.hint.textContent = "Flow-Liste wird geladen…";

      const result = await CCP.namingApi.runHardProjectMapRefresh({
        onProgress: function (ev) {
          const d = (ev && ev.detail) || {};
          const stage = String(d.stage || "");
          if (stage === "flows-list") {
            view.hint.textContent = "Flow-Liste wird geladen…";
          }
          if (stage === "flows-enumerated") {
            view.resetAndInitFromFlowMeta(d.flows || []);
          }
          if (stage === "flows-load") {
            const done = Number(d.done) || 0;
            const total = Number(d.total) || 0;
            view.hint.textContent = total ? "Flows laden: " + done + " / " + total : "Flows werden geladen…";
          }
          if (stage.indexOf("flow-nodes:") === 0) {
            const flowId = stage.slice("flow-nodes:".length);
            const done = Number(d.done) || 0;
            const total = Number(d.total) || 0;
            const st = total > 0 && done >= total ? "success" : "running";
            view.updateFlow(flowId, st, done, total);
          }
        },
      });
      if (!result || !result.ok) {
        throw new Error((result && (result.error || result.reason)) || "Hard Refresh fehlgeschlagen");
      }
      view.finalize(result.map || map);
      return { ok: true };
    }
    if (stepId === "errors") {
      const issues = getVisibleUiIssues().filter(function (i) {
        return Number(i.severity) === 3;
      });
      if (issues.length) {
        createIssuesListView(detailEl, issues, {
          countHint: issues.length + " Fehler",
        });
        throw new Error(issues.length + " Fehler gefunden");
      }
      resetDetailText(detailEl);
      detailEl.textContent = "Keine Fehler gefunden.";
      return { ok: true };
    }
    if (stepId === "warnings") {
      const issues = getVisibleUiIssues().filter(function (i) {
        return Number(i.severity) === 2;
      });
      if (issues.length) {
        createIssuesListView(detailEl, issues, {
          countHint: issues.length + " Warnungen",
        });
        throw new Error(issues.length + " Warnungen gefunden");
      }
      resetDetailText(detailEl);
      detailEl.textContent = "Keine Warnungen gefunden.";
      return { ok: true };
    }
    if (stepId === "info") {
      const issues = getVisibleUiIssues().filter(function (i) {
        return Number(i.severity) === 1 && i.type !== ISSUE_TYPE_NAMING;
      });
      if (issues.length) {
        createIssuesListView(detailEl, issues, {
          countHint: issues.length + " Info-Meldungen",
        });
        throw new Error(issues.length + " Info-Meldungen gefunden");
      }
      resetDetailText(detailEl);
      detailEl.textContent = "Keine relevanten Info-Meldungen.";
      return { ok: true };
    }
    if (stepId === "naming") {
      await getNamingIssuesRaw();
      const issues = getVisibleNamingIssues();
      if (!issues.length) {
        resetDetailText(detailEl);
        detailEl.textContent = "Keine Naming-Convention-Verstöße.";
        return { ok: true };
      }
      createIssuesListView(detailEl, issues, {
        countHint: issues.length + " Naming-Verstöße",
      });
      throw new Error(issues.length + " Naming-Verstöße — Autofix All ausführen oder Skip");
    }
    if (stepId === "playbooks") {
      const view = createPlaybookRunView(detailEl);
      const firstFlow = getFirstAlphabeticalFlow();
      if (!firstFlow || !firstFlow.reference_id) {
        throw new Error("Kein Flow für Playbook-Ausführung verfügbar");
      }
      const primaryLocale = await CCP.release.api.getPrimaryLocale(projectId);
      if (!primaryLocale || !primaryLocale.reference_id) {
        throw new Error("Keine Primary-Locale verfügbar");
      }
      view.setFlow(firstFlow.name);
      view.setLocale(primaryLocale.name + (primaryLocale.primary ? " (primary)" : ""));

      const playbooks = await CCP.release.api.listPlaybooks(projectId);
      if (!playbooks.length) {
        resetDetailVisual(detailEl);
        detailEl.appendChild(el("div", "ccp-rel-check-hint", "Keine Playbooks im Projekt."));
        return { ok: true };
      }
      view.setPlaybooks(playbooks);

      const result = await CCP.release.api.runAllPlaybooks(projectId, {
        flowReferenceId: firstFlow.reference_id,
        localeReferenceId: primaryLocale.reference_id,
        onProgress: function (ev) {
          const idx = ev.index;
          const run = ev.run;
          const uiStatus = playbookUiStatus(run, ev.phase);
          const link = playbookRunLink(run);
          const showLink = link && uiStatus !== "running" ? link : "";
          view.updatePlaybook(idx, uiStatus, playbookUiMessage(run, ev.phase), showLink);
        },
      });
      const failed = (result.runs || []).filter(playbookRunFailed);
      if (failed.length) throw new Error(failed.length + " Playbook(s) fehlgeschlagen");
      return { ok: true };
    }
    throw new Error("Unbekannter Schritt: " + stepId);
  }

  function renderCheckTab(container) {
    container.className = "ccp-rel-tab-panel ccp-rel-check-tab";
    container.innerHTML = "";
    const actions = el("div", "ccp-rel-actions");
    const startBtn = el("button", "ccp-rel-btn ccp-rel-btn-primary", "Start Check");
    const skipBtn = el("button", "ccp-rel-btn", "Skip Check");
    actions.appendChild(startBtn);
    actions.appendChild(skipBtn);
    container.appendChild(actions);

    const stepsWrap = el("div", "ccp-rel-check-steps");
    const stepEls = {};
    CHECK_STEPS.forEach(function (step, idx) {
      const st = state.checkStepStates[step.id] || "pending";
      const expanded = state.checkStepExpanded && state.checkStepExpanded[step.id];
      const box = el("div", "ccp-rel-step" + (expanded ? " ccp-expanded" : ""));
      box.dataset.stepId = step.id;
      const head = el("div", "ccp-rel-step-head");
      head.appendChild(el("span", "ccp-rel-step-chevron", "▶"));
      head.appendChild(el("span", "ccp-rel-step-icon", statusIcon(st)));
      head.appendChild(el("span", "ccp-rel-step-title", step.title));
      const headTools = el("div", "ccp-rel-step-head-tools");
      head.appendChild(headTools);
      head.addEventListener("click", function (ev) {
        if (ev.target.closest(".ccp-rel-step-head-tools")) return;
        toggleStepExpanded(step.id);
      });
      box.appendChild(head);
      const body = el("div", "ccp-rel-step-body");
      body.appendChild(el("div", "ccp-rel-step-desc", step.description));
      const detail = el("div", "ccp-rel-step-detail");
      body.appendChild(detail);
      box.appendChild(body);
      stepsWrap.appendChild(box);
      stepEls[step.id] = {
        box: box,
        icon: head.querySelector(".ccp-rel-step-icon"),
        detail: detail,
        headTools: headTools,
      };
    });
    container.appendChild(stepsWrap);

    function toggleStepExpanded(stepId) {
      if (!state.checkStepExpanded) state.checkStepExpanded = {};
      const next = !state.checkStepExpanded[stepId];
      state.checkStepExpanded[stepId] = next;
      if (stepEls[stepId]) stepEls[stepId].box.classList.toggle("ccp-expanded", next);
    }

    function expandStep(index) {
      const step = CHECK_STEPS[index];
      if (!step || !stepEls[step.id]) return;
      if (!state.checkStepExpanded) state.checkStepExpanded = {};
      state.checkStepExpanded[step.id] = true;
      stepEls[step.id].box.classList.add("ccp-expanded");
      state.checkStepIndex = index;
    }

    function attachNamingAutofix(step, stepIndex, els, headTools, onSuccess) {
      const autofixBtn = el("button", "ccp-rel-btn ccp-rel-btn-fixall", "Fix All");
      headTools.insertBefore(autofixBtn, headTools.firstChild);
      autofixBtn.addEventListener("click", async function () {
        autofixBtn.disabled = true;
        autofixBtn.textContent = "Fixing…";
        try {
          const autofix = CCP.naming && CCP.naming.issueAutofix;
          const ctx =
            CCP.namingApi && CCP.namingApi.getAutofixContext ? CCP.namingApi.getAutofixContext() : null;
          if (!autofix || !ctx) throw new Error("Autofix nicht verfügbar");
          await getNamingIssuesRaw();
          const issues = getVisibleNamingIssues();
          const fixable = issues.filter(function (iss) {
            return autofix.canFixIssue(iss);
          });
          await autofix.fixIssuesByType(ISSUE_TYPE_NAMING, fixable, { ctx: ctx });
          await getNamingIssuesRaw();
          const remaining = getVisibleNamingIssues();
          if (remaining.length) throw new Error(remaining.length + " Verstöße verbleiben");
          state.checkStepStates[step.id] = "success";
          els.icon.textContent = statusIcon("success");
          els.detail.textContent = "Naming-Verstöße behoben.";
          headTools.innerHTML = "";
          if (typeof onSuccess === "function") onSuccess();
          else renderAllStepHeadActions();
        } catch (err) {
          autofixBtn.disabled = false;
          autofixBtn.textContent = "Fix All";
          els.detail.textContent += "\n\nAutofix-Fehler: " + err.message;
        }
      });
    }

    function renderStepHeadActions(step, stepIndex) {
      const els = stepEls[step.id];
      if (!els || state.checkRunning) {
        if (els) els.headTools.innerHTML = "";
        return;
      }
      const st = state.checkStepStates[step.id] || "pending";
      els.headTools.innerHTML = "";
      const btnLabel = st === "pending" ? "Start" : "Restart";
      const stepBtn = el(
        "button",
        "ccp-rel-btn" + (st === "pending" ? " ccp-rel-btn-primary" : ""),
        btnLabel
      );
      stepBtn.addEventListener("click", function () {
        void runSingleStep(stepIndex);
      });
      els.headTools.appendChild(stepBtn);
      if (step.id === "naming" && st === "failed") {
        attachNamingAutofix(step, stepIndex, els, els.headTools);
      }
    }

    function renderAllStepHeadActions() {
      CHECK_STEPS.forEach(function (step, idx) {
        renderStepHeadActions(step, idx);
      });
    }

    function clearStepHeadTools(fromIndex) {
      for (let j = fromIndex; j < CHECK_STEPS.length; j++) {
        const sid = CHECK_STEPS[j].id;
        if (stepEls[sid] && stepEls[sid].headTools) stepEls[sid].headTools.innerHTML = "";
      }
    }

    function showStepFailureActions(step, stepIndex, els) {
      els.headTools.innerHTML = "";
      const retryBtn = el("button", "ccp-rel-btn ccp-rel-btn-primary", "Retry");
      const skipStepBtn = el("button", "ccp-rel-btn", "Skip");
      retryBtn.addEventListener("click", function () {
        void runFrom(stepIndex);
      });
      skipStepBtn.addEventListener("click", function () {
        state.checkStepStates[step.id] = "skipped";
        els.icon.textContent = statusIcon("skipped");
        els.headTools.innerHTML = "";
        void runFrom(stepIndex + 1);
      });
      els.headTools.appendChild(retryBtn);
      els.headTools.appendChild(skipStepBtn);
      if (step.id === "naming") {
        attachNamingAutofix(step, stepIndex, els, els.headTools, function () {
          void runFrom(stepIndex + 1);
        });
      }
    }

    async function runSingleStep(index) {
      if (state.checkRunning) return;
      const step = CHECK_STEPS[index];
      const els = stepEls[step.id];
      state.checkRunning = true;
      startBtn.disabled = true;
      skipBtn.disabled = true;
      clearStepHeadTools(0);
      expandStep(index);
      state.checkStepStates[step.id] = "running";
      els.icon.textContent = statusIcon("running");
      els.detail.textContent = "Läuft…";
      try {
        await runCheckStep(step.id, els.detail);
        state.checkStepStates[step.id] = "success";
        els.icon.textContent = statusIcon("success");
      } catch (e) {
        state.checkStepStates[step.id] = "failed";
        els.icon.textContent = statusIcon("failed");
        if (String(e.message || "").indexOf("Autofix") === -1) {
          appendStepError(els.detail, e.message);
        }
      } finally {
        state.checkRunning = false;
        startBtn.disabled = false;
        skipBtn.disabled = false;
        renderAllStepHeadActions();
      }
    }

    async function runFrom(index) {
      state.checkRunning = true;
      startBtn.disabled = true;
      skipBtn.disabled = true;
      clearStepHeadTools(0);
      for (let i = index; i < CHECK_STEPS.length; i++) {
        state.checkStepIndex = i;
        const step = CHECK_STEPS[i];
        const els = stepEls[step.id];
        els.headTools.innerHTML = "";
        expandStep(i);
        state.checkStepStates[step.id] = "running";
        els.icon.textContent = statusIcon("running");
        els.detail.textContent = "Läuft…";
        try {
          await runCheckStep(step.id, els.detail);
          state.checkStepStates[step.id] = "success";
          els.icon.textContent = statusIcon("success");
        } catch (e) {
          state.checkStepStates[step.id] = "failed";
          els.icon.textContent = statusIcon("failed");
          if (String(e.message || "").indexOf("Autofix") === -1) {
            appendStepError(els.detail, e.message);
          }
          showStepFailureActions(step, i, els);
          CHECK_STEPS.forEach(function (s, j) {
            if (j !== i) renderStepHeadActions(s, j);
          });
          state.checkRunning = false;
          startBtn.disabled = false;
          skipBtn.disabled = false;
          return;
        }
      }
      state.checkRunning = false;
      startBtn.disabled = false;
      skipBtn.disabled = false;
      switchTab("annotate");
    }

    startBtn.addEventListener("click", function () {
      void runFrom(0);
    });
    skipBtn.addEventListener("click", function () {
      state.checkSkipped = true;
      CHECK_STEPS.forEach(function (s) {
        state.checkStepStates[s.id] = "skipped";
        if (stepEls[s.id]) stepEls[s.id].icon.textContent = statusIcon("skipped");
      });
      switchTab("annotate");
    });

    renderAllStepHeadActions();
  }

  async function prepareAnnotateData() {
    const projectId = CCP.namingApi.getProjectId();
    state.releaseName = await CCP.release.resolveDefaultReleaseName();
    state.storedReleaseNames = await CCP.release.listReleaseNames();
    try {
      state.snapshots = await CCP.release.api.listSnapshots(projectId);
    } catch (e) {
      state.snapshots = [];
      console.warn("[CCP release-ui] listSnapshots failed", e);
    }
    if (state.snapshots.length >= 10) {
      const oldest = state.snapshots.slice().sort(function (a, b) {
        return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
      })[0];
      if (oldest && (oldest._id || oldest.id)) {
        try {
          await CCP.release.api.waitForDeleteSnapshot(oldest._id || oldest.id);
          state.snapshots = await CCP.release.api.listSnapshots(projectId);
        } catch (e) {
          console.warn("[CCP release-ui] delete oldest snapshot failed", e);
        }
      }
    }
    const releases = await CCP.release.loadAllReleases();
    state.releasesByName = {};
    (releases || []).forEach(function (r) {
      if (r && r.release_name) state.releasesByName[String(r.release_name)] = r;
    });
    const payload = await CCP.release.buildCurrentReleasePayload({ release_name: state.releaseName });
    state.currentFlows = payload.flows || [];
    state.baselineRelease = null;
    state.selectedSnapshotName = "";
    const defaultSnap = pickDefaultSnapshot(state.snapshots, state.releasesByName);
    if (defaultSnap) applyDiffViewerBaseline(state, defaultSnap);
    else {
      state.diffFlows = buildDiffFlowsList([], state.currentFlows);
      state.selectedFlowName = pickDefaultFlowName(state.diffFlows);
    }
  }

  function updateDiffEditor(host, ctx) {
    updateDiffEditorModels(ctx || state, host);
  }

  function flowChangeDotClass(status) {
    if (status === "removed") return "ccp-rel-flow-dot-removed";
    if (status === "added") return "ccp-rel-flow-dot-added";
    if (status === "changed") return "ccp-rel-flow-dot-changed";
    return "";
  }

  function clipboardIconSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect>' +
      '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>'
    );
  }

  function copyIconButtonHtml(label) {
    return '<span class="ccp-rel-copy-ic">' + clipboardIconSvg() + "</span>" + label;
  }

  function createCopyIconButton(label) {
    const btn = el("button", "ccp-rel-btn ccp-rel-btn-copy-icon");
    btn.innerHTML = copyIconButtonHtml(label);
    return btn;
  }

  function formatSnapshotDate(snap) {
    const ts = Number(snap && snap.createdAt) || 0;
    return ts ? new Date(ts * 1000).toLocaleString() : "?";
  }

  function buildSnapshotListWrap(snapshots) {
    const wrap = el("div", "ccp-rel-snap-list-wrap");
    wrap.appendChild(el("label", "ccp-rel-label", "Snapshots"));
    const items = el("div", "ccp-rel-snap-items");
    if (!snapshots.length) {
      items.appendChild(el("div", "ccp-rel-snap-item", "Keine Snapshots vorhanden."));
    } else {
      snapshots.forEach(function (snap) {
        const item = el("div", "ccp-rel-snap-item");
        item.appendChild(el("div", "ccp-rel-snap-item-name", snap.name || snap._id || "?"));
        item.appendChild(el("div", "ccp-rel-snap-item-meta", formatSnapshotDate(snap)));
        items.appendChild(item);
      });
    }
    wrap.appendChild(items);
    return wrap;
  }

  function buildDiffFlowsList(baselineFlows, currentFlows) {
    let diffFlows = CCP.release.diffFlows(baselineFlows || [], currentFlows || []);
    if (!diffFlows.length && currentFlows && currentFlows.length) {
      diffFlows = currentFlows
        .slice()
        .sort(function (a, b) {
          return String(a.name || "").localeCompare(String(b.name || ""));
        })
        .map(function (f) {
          const json = CCP.release.diffFlows([], [f])[0];
          return (
            json || {
              name: f.name || f.id || "unknown",
              status: "added",
              oldJson: "",
              newJson: CCP.release.prettyJsonForDiff(f.nodes != null ? f.nodes : f),
            }
          );
        });
    }
    return diffFlows;
  }

  function pickDefaultFlowName(diffFlows) {
    if (!diffFlows || !diffFlows.length) return "";
    const changed = diffFlows.find(function (d) {
      return d.status !== "unchanged";
    });
    return (changed || diffFlows[0]).name;
  }

  function populateFlowListEl(flowListEl, diffFlows, selectedFlowName, onSelect) {
    flowListEl.innerHTML = "";
    (diffFlows || []).forEach(function (d) {
      const item = el("div", "ccp-rel-flow-item" + (d.name === selectedFlowName ? " ccp-on" : ""));
      item.dataset.flowName = d.name;
      item.title = d.status;
      item.appendChild(el("span", "ccp-rel-flow-item-name", d.name));
      const dotCls = flowChangeDotClass(d.status);
      if (dotCls) item.appendChild(el("span", "ccp-rel-flow-dot " + dotCls));
      item.addEventListener("click", function () {
        onSelect(d.name);
      });
      flowListEl.appendChild(item);
    });
  }

  function highlightFlowListSelection(flowListEl, selectedFlowName) {
    if (!flowListEl) return;
    flowListEl.querySelectorAll(".ccp-rel-flow-item").forEach(function (n) {
      n.classList.toggle("ccp-on", n.dataset.flowName === selectedFlowName);
    });
  }

  function disposeMonacoEditors(diffEditor, singleEditor) {
    if (diffEditor) {
      try {
        diffEditor.dispose();
      } catch (_) {}
    }
    if (singleEditor) {
      try {
        singleEditor.dispose();
      } catch (_) {}
    }
  }

  function updateDiffEditorModels(ctx, host) {
    if (!state.monaco || !ctx) return;
    const sel = (ctx.diffFlows || []).find(function (d) {
      return d.name === ctx.selectedFlowName;
    });
    if (!sel) return;
    if (ctx.singleEditor) {
      ctx.singleEditor.setValue(sel.newJson || "{}");
      return;
    }
    if (!ctx.diffEditor) return;
    const orig = state.monaco.editor.createModel(sel.oldJson || "{}", "json");
    const mod = state.monaco.editor.createModel(sel.newJson || "{}", "json");
    ctx.diffEditor.setModel({ original: orig, modified: mod });
  }

  async function mountMonacoDiffHost(host, ctx) {
    const monaco = await ensureMonaco();
    if (!host) return false;
    if (!monaco) {
      host.textContent = "Monaco Editor nicht verfügbar.";
      return false;
    }
    disposeMonacoEditors(ctx.diffEditor, ctx.singleEditor);
    ctx.diffEditor = null;
    ctx.singleEditor = null;
    host.innerHTML = "";
    const useSingle = !ctx.baselineRelease;
    if (useSingle && typeof monaco.editor.create === "function") {
      ctx.singleEditor = monaco.editor.create(host, {
        value: "{}",
        language: "json",
        readOnly: true,
        automaticLayout: true,
        theme: "vs-dark",
        minimap: { enabled: false },
      });
    } else if (typeof monaco.editor.createDiffEditor === "function") {
      ctx.diffEditor = monaco.editor.createDiffEditor(host, {
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        theme: "vs-dark",
        minimap: { enabled: false },
      });
    } else if (typeof monaco.editor.create === "function") {
      ctx.singleEditor = monaco.editor.create(host, {
        value: "{}",
        language: "json",
        readOnly: true,
        automaticLayout: true,
        theme: "vs-dark",
        minimap: { enabled: false },
      });
    } else {
      host.textContent = "Monaco Editor nicht verfügbar.";
      return false;
    }
    updateDiffEditorModels(ctx, host);
    requestAnimationFrame(function () {
      try {
        if (ctx.diffEditor && typeof ctx.diffEditor.layout === "function") ctx.diffEditor.layout();
        if (ctx.singleEditor && typeof ctx.singleEditor.layout === "function") ctx.singleEditor.layout();
      } catch (_) {}
    });
    return true;
  }

  function snapshotReleaseInfo(snap, releasesByName) {
    const name = String((snap && snap.name) || "");
    const release = releasesByName[name];
    if (release) return { ok: true, release: release };
    return { ok: false, reason: "Kein gespeicherter Release in IndexedDB" };
  }

  function pickDefaultSnapshot(snapshots, releasesByName) {
    for (let i = 0; i < (snapshots || []).length; i++) {
      if (snapshotReleaseInfo(snapshots[i], releasesByName).ok) return snapshots[i];
    }
    return null;
  }

  async function loadDiffViewerContext() {
    const projectId = CCP.namingApi.getProjectId();
    let snapshots = [];
    try {
      snapshots = await CCP.release.api.listSnapshots(projectId);
    } catch (e) {
      console.warn("[CCP release-ui] diff viewer listSnapshots failed", e);
    }
    const releases = await CCP.release.loadAllReleases();
    const releasesByName = {};
    (releases || []).forEach(function (r) {
      if (r && r.release_name) releasesByName[String(r.release_name)] = r;
    });
    const payload = await CCP.release.buildCurrentReleasePayload({});
    return {
      snapshots: snapshots,
      releasesByName: releasesByName,
      currentFlows: payload.flows || [],
    };
  }

  function applyDiffViewerBaseline(ctx, snap) {
    const info = snapshotReleaseInfo(snap, ctx.releasesByName);
    ctx.baselineRelease = info.ok ? info.release : null;
    ctx.selectedSnapshotName = snap ? String(snap.name || "") : "";
    const baselineFlows = ctx.baselineRelease ? ctx.baselineRelease.flows || [] : [];
    ctx.diffFlows = buildDiffFlowsList(baselineFlows, ctx.currentFlows);
    ctx.selectedFlowName = pickDefaultFlowName(ctx.diffFlows);
  }

  function createDiffViewerLayoutDom() {
    const layout = el("div", "ccp-rel-diff-layout");
    const sidebar = el("div", "ccp-rel-diff-sidebar");
    const sidebarHead = el("div", "ccp-rel-diff-sidebar-head");
    sidebarHead.appendChild(el("label", "ccp-rel-label", "Snapshot"));
    const snapSelect = el("select", "ccp-rel-snap-select");
    sidebarHead.appendChild(snapSelect);

    const copyRow = el("div", "ccp-rel-annotate-copy-row");
    const copyFlowLabel = "Flow";
    const copyAllLabel = "Projekt";
    const copyFlowBtn = createCopyIconButton(copyFlowLabel);
    const copyAllBtn = createCopyIconButton(copyAllLabel);
    copyRow.appendChild(copyAllBtn);
    copyRow.appendChild(copyFlowBtn);
    sidebarHead.appendChild(copyRow);
    sidebar.appendChild(sidebarHead);

    const flowList = el("div", "ccp-rel-flow-list");
    sidebar.appendChild(flowList);
    layout.appendChild(sidebar);

    const main = el("div", "ccp-rel-diff-main");
    const diffHost = el("div", "ccp-rel-diff-main-editor");
    main.appendChild(diffHost);
    layout.appendChild(main);

    return {
      layout: layout,
      refs: {
        snapSelect: snapSelect,
        flowList: flowList,
        diffHost: diffHost,
        copyFlowBtn: copyFlowBtn,
        copyAllBtn: copyAllBtn,
        copyFlowLabel: copyFlowLabel,
        copyAllLabel: copyAllLabel,
        copyFlowDefaultHtml: copyIconButtonHtml(copyFlowLabel),
        copyAllDefaultHtml: copyIconButtonHtml(copyAllLabel),
      },
    };
  }

  function wireDiffViewerEvents(ctx, refs) {
    refs.snapSelect.addEventListener("change", function () {
      const snap = findSnapshotByName(ctx.snapshots, refs.snapSelect.value);
      if (!snap) return;
      const info = snapshotReleaseInfo(snap, ctx.releasesByName);
      if (!info.ok) return;
      applyDiffViewerBaseline(ctx, snap);
      refreshDiffViewerUi(ctx, refs);
      void mountMonacoDiffHost(refs.diffHost, ctx);
    });

    refs.copyFlowBtn.addEventListener("click", function () {
      const baseline = ctx.baselineRelease ? ctx.baselineRelease.flows : [];
      const text = CCP.release.diffText(baseline, ctx.currentFlows, { flowName: ctx.selectedFlowName });
      void copyToClipboard(text).then(function (ok) {
        if (ok) showCopyFeedback(refs.copyFlowBtn, refs.copyFlowLabel, refs.copyFlowDefaultHtml);
      });
    });
    refs.copyAllBtn.addEventListener("click", function () {
      const baseline = ctx.baselineRelease ? ctx.baselineRelease.flows : [];
      const text = CCP.release.diffText(baseline, ctx.currentFlows);
      void copyToClipboard(text).then(function (ok) {
        if (ok) showCopyFeedback(refs.copyAllBtn, refs.copyAllLabel, refs.copyAllDefaultHtml);
      });
    });
  }

  async function mountDiffViewer(ctx, refs) {
    refreshDiffViewerUi(ctx, refs);
    wireDiffViewerEvents(ctx, refs);
    await mountMonacoDiffHost(refs.diffHost, ctx);
  }

  function showCopyFeedback(btn, defaultLabel, defaultHtml) {
    if (!btn) return;
    btn.classList.add("ccp-rel-btn-copied");
    if (defaultHtml) btn.innerHTML = "Kopiert!";
    else btn.textContent = "Kopiert!";
    setTimeout(function () {
      btn.classList.remove("ccp-rel-btn-copied");
      if (defaultHtml) btn.innerHTML = defaultHtml;
      else btn.textContent = defaultLabel;
    }, 1800);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  async function renderAnnotateTab(container) {
    container.innerHTML = el("div", "", "Annotate wird vorbereitet…").outerHTML;
    try {
      await prepareAnnotateData();
    } catch (e) {
      container.innerHTML = "";
      container.appendChild(el("div", "ccp-rel-warn", "Fehler beim Laden: " + e.message));
      return;
    }
    container.innerHTML = "";
    container.className = "ccp-rel-tab-panel ccp-rel-annotate-tab-panel";

    const annotateTab = el("div", "ccp-rel-annotate-tab");
    const annotateHead = el("div", "ccp-rel-annotate-head");
    const toolbar = el("div", "ccp-rel-annotate-toolbar");

    container.appendChild(annotateTab);
    annotateTab.appendChild(annotateHead);
    annotateHead.appendChild(toolbar);

    const buildBtn = el("button", "ccp-rel-btn ccp-rel-btn-primary", "Build Release");
    buildBtn.id = "ccp-rel-build-btn";
    buildBtn.disabled = true;

    function updateBuildButton() {
      const name = state.releaseName.trim();
      const nameTaken = state.storedReleaseNames.indexOf(name) >= 0 && name !== state.buildReleaseName;
      state.nameTakenByUser = nameTaken;
      const ok = name && !nameTaken && state.commitMessage.trim() && state.commitMessage.length <= 500;
      buildBtn.disabled = !ok;
    }
    state._updateBuildBtn = updateBuildButton;

    async function aiGenerate(target, thoughtsEl, systemPrompt) {
      if (!FEATURES.aiGenerate) return;
      await loadSettings();
      if (!state.settings.apiKey) {
        alert("Bitte zuerst einen Gemini API Key in den Einstellungen hinterlegen.");
        if (FEATURES.settings) ui.openSettings();
        return;
      }
      target.value = "";
      thoughtsEl.textContent = "";
      thoughtsEl.classList.add("ccp-on");
      const baseline = state.baselineRelease ? state.baselineRelease.flows : [];
      const diffText = CCP.release.diffText(baseline, state.currentFlows);
      try {
        await streamGemini(
          {
            apiKey: state.settings.apiKey,
            model: state.settings.model || DEFAULT_MODEL,
            systemInstruction: systemPrompt,
            userText: diffText,
          },
          {
            onThought: function (t) {
              thoughtsEl.textContent += t;
              thoughtsEl.scrollTop = thoughtsEl.scrollHeight;
            },
            onAnswer: function (t) {
              if (target.tagName === "TEXTAREA" && target.value.length + t.length <= 10000) {
                target.value += t;
                target.dispatchEvent(new Event("input"));
              } else if (target.tagName === "INPUT") {
                const next = (target.value + t).slice(0, 500);
                target.value = next;
                target.dispatchEvent(new Event("input"));
              }
            },
          }
        );
      } catch (e) {
        alert("AI-Fehler: " + e.message);
      }
    }

    const nameField = el("div", "ccp-rel-field");
    nameField.appendChild(el("label", "ccp-rel-label", "Release Name"));
    const nameInput = el("input", "ccp-rel-input");
    nameInput.value = state.releaseName;
    const nameWarn = el("div", "ccp-rel-name-warn");
    nameWarn.textContent = "Dieser Release-Name ist bereits gespeichert. Bitte einen anderen Namen wählen.";
    nameInput.addEventListener("input", function () {
      state.releaseName = nameInput.value;
      const taken =
        state.storedReleaseNames.indexOf(nameInput.value.trim()) >= 0 &&
        nameInput.value.trim() !== state.buildReleaseName;
      nameWarn.style.display = taken ? "block" : "none";
      updateBuildButton();
    });
    nameField.appendChild(nameInput);
    nameField.appendChild(nameWarn);
    const nameCol = el("div", "ccp-rel-annotate-toolbar-name");
    nameCol.appendChild(nameField);
    toolbar.appendChild(nameCol);

    if (FEATURES.releaseMessage) {
      const msgField = el("div", "ccp-rel-field");
      msgField.appendChild(el("label", "ccp-rel-label", "Release Message (optional, max. 10.000 Zeichen)"));
      const msgArea = el("textarea", "ccp-rel-textarea");
      msgArea.maxLength = 10000;
      msgArea.value = state.releaseMessage;
      const msgCount = el("div", "ccp-rel-char-count", "0 / 10000");
      const msgPreview = el("div", "ccp-rel-md-preview");
      const msgThoughts = el("div", "ccp-rel-thoughts");
      function updMsg() {
        state.releaseMessage = msgArea.value;
        msgCount.textContent = msgArea.value.length + " / 10000";
        msgCount.classList.toggle("ccp-over", msgArea.value.length > 10000);
        msgPreview.innerHTML = renderMarkdown(msgArea.value);
      }
      msgArea.addEventListener("input", updMsg);
      msgField.appendChild(msgArea);
      msgField.appendChild(msgCount);
      msgField.appendChild(msgPreview);
      if (FEATURES.aiGenerate) {
        const msgAiBtn = el("button", "ccp-rel-btn", "Generate with AI");
        msgAiBtn.style.marginTop = "6px";
        msgField.appendChild(msgAiBtn);
        msgField.appendChild(msgThoughts);
        msgAiBtn.addEventListener("click", function () {
          void aiGenerate(
            msgArea,
            msgThoughts,
            "Du schreibst ausführliche Release Notes auf Deutsch basierend auf einem Projekt-Diff. Formatiere als Markdown mit Überschriften und Bullet Points. Beschreibe was sich geändert hat."
          );
        });
      }
      annotateHead.appendChild(msgField);
      updMsg();
    }

    const commitField = el("div", "ccp-rel-field");
    commitField.appendChild(el("label", "ccp-rel-label", "Commit Message (max. 500 Zeichen)"));
    const commitInput = el("input", "ccp-rel-input");
    commitInput.maxLength = 500;
    commitInput.value = state.commitMessage;
    const commitCount = el("div", "ccp-rel-char-count", "0 / 500");
    const commitThoughts = el("div", "ccp-rel-thoughts");
    function updCommit() {
      if (commitInput.value.length > 500) commitInput.value = commitInput.value.slice(0, 500);
      state.commitMessage = commitInput.value;
      commitCount.textContent = commitInput.value.length + " / 500";
      commitCount.classList.toggle("ccp-over", commitInput.value.length > 500);
      updateBuildButton();
    }
    commitInput.addEventListener("input", updCommit);
    commitField.appendChild(commitInput);
    commitField.appendChild(commitCount);
    if (FEATURES.aiGenerate) {
      const commitAiBtn = el("button", "ccp-rel-btn", "Generate with AI");
      commitAiBtn.style.marginTop = "6px";
      commitField.appendChild(commitAiBtn);
      commitField.appendChild(commitThoughts);
      commitAiBtn.addEventListener("click", function () {
        void aiGenerate(
          commitInput,
          commitThoughts,
          "Schreibe eine kurze Commit Message auf Deutsch (maximal 500 Zeichen, ein Satz oder kurze Liste). Nur die Commit Message, kein Markdown."
        );
      });
    }
    const commitCol = el("div", "ccp-rel-annotate-toolbar-commit");
    commitCol.appendChild(commitField);
    toolbar.appendChild(commitCol);

    buildBtn.addEventListener("click", function () {
      if (state.commitMessage.length > 500) return;
      switchTab("build");
      const buildPanel = state.overlay && state.overlay.querySelector('[data-tab-panel="build"]');
      if (buildPanel) void runBuild(buildPanel);
    });
    const buildCol = el("div", "ccp-rel-annotate-toolbar-build");
    buildCol.appendChild(el("label", "ccp-rel-label", "\u00a0"));
    buildCol.appendChild(buildBtn);
    toolbar.appendChild(buildCol);
    updCommit();

    const annotateDiff = el("div", "ccp-rel-annotate-diff ccp-rel-diff-panel");
    const diffLayout = createDiffViewerLayoutDom();
    annotateDiff.appendChild(diffLayout.layout);
    annotateTab.appendChild(annotateDiff);

    await mountDiffViewer(state, diffLayout.refs);
    requestAnimationFrame(function () {
      try {
        if (state.diffEditor && typeof state.diffEditor.layout === "function") state.diffEditor.layout();
        if (state.singleEditor && typeof state.singleEditor.layout === "function")
          state.singleEditor.layout();
      } catch (_) {}
    });
  }

  async function runBuild(buildPanel) {
    const projectId = CCP.namingApi.getProjectId();
    const buildContainer = buildPanel;
    buildContainer.innerHTML = "";
    state.buildRunning = true;
    state.buildReleaseName = state.releaseName.trim();

    const stepEls = {};
    BUILD_STEPS.forEach(function (step) {
      const box = el("div", "ccp-rel-step ccp-expanded");
      const head = el("div", "ccp-rel-step-head");
      head.appendChild(el("span", "ccp-rel-step-icon", statusIcon("pending")));
      head.appendChild(el("span", "ccp-rel-step-title", step.title));
      box.appendChild(head);
      const body = el("div", "ccp-rel-step-body");
      body.appendChild(el("div", "ccp-rel-step-desc", step.description));
      const detail = el("div", "ccp-rel-step-detail");
      body.appendChild(detail);
      box.appendChild(body);
      buildContainer.appendChild(box);
      stepEls[step.id] = { icon: head.querySelector(".ccp-rel-step-icon"), detail: detail };
    });

    async function runStep(id, fn) {
      const els = stepEls[id];
      els.icon.textContent = statusIcon("running");
      els.detail.textContent = "Läuft…";
      try {
        const result = await fn(els.detail);
        els.icon.textContent = statusIcon("success");
        return result;
      } catch (e) {
        els.icon.textContent = statusIcon("failed");
        els.detail.textContent = "Fehler: " + e.message;
        throw e;
      }
    }

    try {
      let snapshotId = null;
      await runStep("create", async function (detail) {
        const resp = await CCP.release.api.createSnapshot({
          name: state.releaseName.trim(),
          description: state.commitMessage.trim(),
          projectId: projectId,
        });
        const taskId = resp._id || resp.id;
        detail.textContent = "Task: " + taskId + " — warte…";
        const task = await CCP.release.api.pollTask(taskId, function (t) {
          detail.textContent =
            "Status: " +
            (t.status || "?") +
            (t.currentStep != null ? " (" + t.currentStep + "/" + (t.totalStep || "?") + ")" : "");
        });
        detail.textContent = "Snapshot erstellt.";
        const snaps = await CCP.release.api.listSnapshots(projectId);
        const match = snaps.find(function (s) {
          return s.name === state.releaseName.trim();
        });
        snapshotId = match ? match._id || match.id : null;
        state.snapshotId = snapshotId;
        await persistReleasePayload({ snapshot_id: snapshotId, download_link: "" });
        return task;
      });

      await runStep("package", async function (detail) {
        if (!snapshotId) throw new Error("Snapshot ID unbekannt");
        const resp = await CCP.release.api.packageSnapshot(snapshotId);
        const taskId = resp._id || resp.id;
        await CCP.release.api.pollTask(taskId, function (t) {
          detail.textContent = "Packaging: " + (t.status || "?");
        });
        detail.textContent = "Snapshot gepackaged.";
      });

      let downloadLink = "";
      await runStep("link", async function (detail) {
        if (!snapshotId) throw new Error("Snapshot ID unbekannt");
        const resp = await CCP.release.api.createDownloadLink(snapshotId, projectId);
        downloadLink = resp.downloadLink || "";
        detail.textContent = downloadLink || "Kein Link erhalten";
      });

      await runStep("download", async function (detail) {
        if (downloadLink) {
          const a = document.createElement("a");
          a.href = downloadLink;
          a.download = state.releaseName.trim() + ".zip";
          a.target = "_blank";
          document.body.appendChild(a);
          a.click();
          a.remove();
          detail.textContent = "Download gestartet.";
        } else {
          detail.textContent = "Download-Link fehlte.";
        }
        await persistReleasePayload({ snapshot_id: snapshotId, download_link: downloadLink });
      });
    } catch (e) {
      console.warn("[CCP release-ui] build failed", e);
    }
    state.buildRunning = false;
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    if (!state.overlay) return;
    const tabs = state.overlay.querySelectorAll(".ccp-rel-tab");
    tabs.forEach(function (t) {
      t.classList.toggle("ccp-on", t.dataset.tab === tabId);
      t.disabled = tabId === "build" && t.dataset.tab !== "build" && state.buildRunning;
    });
    const panels = state.overlay.querySelectorAll("[data-tab-panel]");
    panels.forEach(function (p) {
      const isActive = p.dataset.tabPanel === tabId;
      if (!isActive) {
        p.style.display = "none";
        p.classList.remove("ccp-rel-check-tab", "ccp-rel-annotate-tab-panel");
        return;
      }
      p.classList.add("ccp-rel-tab-panel");
      if (tabId === "check") {
        p.classList.add("ccp-rel-check-tab");
        p.style.display = "flex";
        p.style.flexDirection = "column";
      } else if (tabId === "annotate") {
        p.classList.add("ccp-rel-annotate-tab-panel");
        p.style.display = "flex";
        p.style.flexDirection = "column";
      } else {
        p.classList.remove("ccp-rel-check-tab", "ccp-rel-annotate-tab-panel");
        p.style.display = "block";
        p.style.flexDirection = "";
      }
    });
    const panel = state.overlay.querySelector('[data-tab-panel="' + tabId + '"]');
    if (!panel) return;
    if (tabId === "check") renderCheckTab(panel);
    if (tabId === "annotate") void renderAnnotateTab(panel);
    if (tabId === "build" && !state.buildRunning && !panel.querySelector(".ccp-rel-step")) {
      panel.innerHTML = el("div", "", 'Wechsle zu Annotate und klicke "Build Release".').outerHTML;
    }
  }

  function updateBuildButton() {
    if (typeof state._updateBuildBtn === "function") state._updateBuildBtn();
  }

  function buildReleaseOverlay() {
    ensureStyles();
    const overlay = el("div", "ccp-rel-overlay");
    overlay.setAttribute("data-ccp-release-overlay", "1");

    const header = el("div", "ccp-rel-header");
    header.appendChild(el("div", "ccp-rel-title", "Neuer Release"));
    const tabs = el("div", "ccp-rel-tabs");
    ["check", "annotate", "build"].forEach(function (id) {
      const label = id === "check" ? "Check" : id === "annotate" ? "Annotate" : "Build";
      const tab = el("button", "ccp-rel-tab" + (state.activeTab === id ? " ccp-on" : ""), label);
      tab.type = "button";
      tab.dataset.tab = id;
      tab.addEventListener("click", function () {
        switchTab(id);
      });
      tabs.appendChild(tab);
    });
    header.appendChild(tabs);
    if (FEATURES.settings) {
      const gearBtn = el("button", "ccp-rel-icon-btn", "⚙");
      gearBtn.type = "button";
      gearBtn.title = "Einstellungen";
      gearBtn.addEventListener("click", function () {
        ui.openSettings();
      });
      header.appendChild(gearBtn);
    }
    const closeBtn = el("button", "ccp-rel-icon-btn", "✕");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", function () {
      ui.closeReleaseOverlay();
    });
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    const body = el("div", "ccp-rel-body");
    ["check", "annotate", "build"].forEach(function (id) {
      const panel = el("div", "ccp-rel-tab-panel");
      panel.dataset.tabPanel = id;
      panel.style.display = "none";
      body.appendChild(panel);
    });
    overlay.appendChild(body);
    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
    switchTab(state.activeTab);
  }

  function buildSettingsOverlay() {
    ensureStyles();
    const overlay = el("div", "ccp-rel-overlay");
    overlay.setAttribute("data-ccp-settings-overlay", "1");
    const card = el("div", "ccp-rel-settings-card");
    const title = el("h2", "");
    title.textContent = "Release Einstellungen";
    title.style.fontSize = "16px";
    title.style.margin = "0 0 12px";
    card.appendChild(title);

    const keyRow = el("div", "ccp-rel-settings-row");
    keyRow.appendChild(el("label", "ccp-rel-label", "Gemini API Key"));
    const pwWrap = el("div", "ccp-rel-pw-wrap");
    const keyInput = el("input", "ccp-rel-input");
    keyInput.type = "password";
    keyInput.placeholder = "Gemini API Key eingeben…";
    keyInput.value = state.settings.apiKey || "";
    keyInput.autocomplete = "off";
    const revealBtn = el("button", "ccp-rel-btn", "👁");
    revealBtn.type = "button";
    revealBtn.addEventListener("click", function () {
      keyInput.type = keyInput.type === "password" ? "text" : "password";
    });
    pwWrap.appendChild(keyInput);
    pwWrap.appendChild(revealBtn);
    keyRow.appendChild(pwWrap);
    card.appendChild(keyRow);

    const modelRow = el("div", "ccp-rel-settings-row");
    modelRow.appendChild(el("label", "ccp-rel-label", "Modell für Releases"));
    const modelSelect = el("select", "ccp-rel-input");
    MODEL_OPTIONS.forEach(function (m) {
      const opt = el("option", "", m.label);
      opt.value = m.id;
      if (m.id === (state.settings.model || DEFAULT_MODEL)) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    modelRow.appendChild(modelSelect);
    card.appendChild(modelRow);

    const actions = el("div", "ccp-rel-actions");
    const saveBtn = el("button", "ccp-rel-btn ccp-rel-btn-primary", "Speichern");
    const cancelBtn = el("button", "ccp-rel-btn", "Abbrechen");
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);

    saveBtn.addEventListener("click", async function () {
      state.settings.apiKey = keyInput.value.trim();
      state.settings.model = modelSelect.value || DEFAULT_MODEL;
      await saveSettings();
      ui.closeSettings();
    });
    cancelBtn.addEventListener("click", function () {
      ui.closeSettings();
    });

    overlay.appendChild(card);
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) ui.closeSettings();
    });
    document.documentElement.appendChild(overlay);
    state.settingsOverlay = overlay;
  }

  ui.openReleaseOverlay = async function openReleaseOverlay() {
    if (window !== window.top) return;
    if (FEATURES.settings || FEATURES.aiGenerate) await loadSettings();
    state.activeTab = "check";
    state.checkStepIndex = -1;
    state.checkStepStates = {};
    state.checkStepExpanded = {};
    state.checkSkipped = false;
    state.buildRunning = false;
    state.buildReleaseName = "";
    state.snapshotId = null;
    if (state.overlay) state.overlay.remove();
    buildReleaseOverlay();
  };

  ui.closeReleaseOverlay = function closeReleaseOverlay() {
    if (state.diffEditor) {
      try {
        state.diffEditor.dispose();
      } catch (_) {}
      state.diffEditor = null;
    }
    if (state.singleEditor) {
      try {
        state.singleEditor.dispose();
      } catch (_) {}
      state.singleEditor = null;
    }
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }
  };

  ui.openSettings = async function openSettings() {
    await loadSettings();
    if (state.settingsOverlay) state.settingsOverlay.remove();
    buildSettingsOverlay();
  };

  ui.closeSettings = function closeSettings() {
    if (state.settingsOverlay) {
      state.settingsOverlay.remove();
      state.settingsOverlay = null;
    }
  };

  function populateSnapshotSelect(selectEl, snapshots, releasesByName, selectedName) {
    selectEl.innerHTML = "";
    if (!snapshots.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Keine Snapshots vorhanden";
      opt.disabled = true;
      opt.selected = true;
      selectEl.appendChild(opt);
      return;
    }
    snapshots.forEach(function (snap) {
      const info = snapshotReleaseInfo(snap, releasesByName);
      const opt = document.createElement("option");
      opt.value = String(snap.name || "");
      const dt = formatSnapshotDate(snap);
      opt.textContent = (snap.name || "?") + " — " + dt;
      if (!info.ok) {
        opt.disabled = true;
        opt.textContent += " (" + info.reason + ")";
      }
      if (selectedName && opt.value === selectedName && !opt.disabled) opt.selected = true;
      selectEl.appendChild(opt);
    });
    if (selectedName) {
      const hasSelected = Array.prototype.some.call(selectEl.options, function (o) {
        return o.value === selectedName && !o.disabled && o.selected;
      });
      if (!hasSelected) {
        for (let i = 0; i < selectEl.options.length; i++) {
          if (!selectEl.options[i].disabled) {
            selectEl.options[i].selected = true;
            break;
          }
        }
      }
    }
  }

  function findSnapshotByName(snapshots, name) {
    return (snapshots || []).find(function (s) {
      return String(s.name || "") === String(name || "");
    });
  }

  function refreshDiffViewerUi(ctx, refs) {
    populateSnapshotSelect(refs.snapSelect, ctx.snapshots, ctx.releasesByName, ctx.selectedSnapshotName);
    populateFlowListEl(refs.flowList, ctx.diffFlows, ctx.selectedFlowName, function (flowName) {
      ctx.selectedFlowName = flowName;
      highlightFlowListSelection(refs.flowList, flowName);
      updateDiffEditorModels(ctx, refs.diffHost);
    });
    updateDiffEditorModels(ctx, refs.diffHost);
  }

  ui.closeDiffViewerOverlay = function closeDiffViewerOverlay() {
    if (diffViewerState.escHandler) {
      document.removeEventListener("keydown", diffViewerState.escHandler);
      diffViewerState.escHandler = null;
    }
    disposeMonacoEditors(diffViewerState.diffEditor, diffViewerState.singleEditor);
    diffViewerState.diffEditor = null;
    diffViewerState.singleEditor = null;
    if (diffViewerState.overlay) {
      diffViewerState.overlay.remove();
      diffViewerState.overlay = null;
    }
  };

  function closeFabPanelIfOpen() {
    const api = CCP.namingApi;
    if (api && typeof api.setFabPanelOpen === "function") api.setFabPanelOpen(false);
  }

  ui.openDiffViewerOverlay = async function openDiffViewerOverlay() {
    ensureStyles();
    closeFabPanelIfOpen();
    ui.closeDiffViewerOverlay();
    const overlay = el("div", "ccp-rel-diff-overlay ccp-rel-diff-panel");
    const closeBtn = el("button", "ccp-rel-diff-close", "×");
    closeBtn.type = "button";
    closeBtn.title = "Schließen (Esc)";
    closeBtn.addEventListener("click", function () {
      ui.closeDiffViewerOverlay();
    });
    overlay.appendChild(closeBtn);

    const diffLayout = createDiffViewerLayoutDom();
    overlay.appendChild(diffLayout.layout);

    document.body.appendChild(overlay);
    diffViewerState.overlay = overlay;

    const loading = el("div", "ccp-rel-diff-empty", "Diff Viewer wird geladen…");
    diffLayout.refs.diffHost.appendChild(loading);

    const ctx = diffViewerState;
    ctx.diffEditor = null;
    ctx.singleEditor = null;
    ctx.selectedFlowName = "";
    ctx.selectedSnapshotName = "";
    ctx.baselineRelease = null;

    try {
      const loaded = await loadDiffViewerContext();
      ctx.snapshots = loaded.snapshots;
      ctx.releasesByName = loaded.releasesByName;
      ctx.currentFlows = loaded.currentFlows;
      const defaultSnap = pickDefaultSnapshot(ctx.snapshots, ctx.releasesByName);
      if (defaultSnap) applyDiffViewerBaseline(ctx, defaultSnap);
      else {
        ctx.diffFlows = buildDiffFlowsList([], ctx.currentFlows);
        ctx.selectedFlowName = pickDefaultFlowName(ctx.diffFlows);
      }
    } catch (e) {
      diffLayout.refs.diffHost.innerHTML = "";
      diffLayout.refs.diffHost.appendChild(
        el("div", "ccp-rel-diff-empty", "Fehler beim Laden: " + e.message)
      );
      return;
    }

    diffLayout.refs.diffHost.innerHTML = "";
    await mountDiffViewer(ctx, diffLayout.refs);

    diffViewerState.escHandler = function (ev) {
      if (ev.key === "Escape") ui.closeDiffViewerOverlay();
    };
    document.addEventListener("keydown", diffViewerState.escHandler);
  };

  ui.buildFabReleaseBox = function buildFabReleaseBox() {
    ensureStyles();
    const box = el("div", "ccp-fc-bd-box");
    const head = el("div", "ccp-fc-integrity-head");
    head.appendChild(el("span", "", "Releases"));
    if (FEATURES.settings) {
      const tools = el("div", "ccp-fc-integrity-head-tools");
      const gear = el("button", "ccp-rel-fab-gear", "⚙");
      gear.type = "button";
      gear.title = "Einstellungen";
      gear.addEventListener("click", function (ev) {
        ev.stopPropagation();
        ui.openSettings();
      });
      tools.appendChild(gear);
      head.appendChild(tools);
    }
    box.appendChild(head);
    const body = el("div", "ccp-fc-integrity-body");
    body.style.minHeight = "auto";
    body.style.maxHeight = "none";
    body.style.padding = "10px 12px";
    const btnRow = el("div", "ccp-rel-fab-btn-row");
    const btn = el("button", "ccp-rel-fab-btn", "Neuer Release");
    btn.type = "button";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      ui.openReleaseOverlay();
    });
    const diffBtn = el("button", "ccp-rel-fab-btn", "Diff Viewer");
    diffBtn.type = "button";
    diffBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      ui.openDiffViewerOverlay();
    });
    btnRow.appendChild(btn);
    btnRow.appendChild(diffBtn);
    body.appendChild(btnRow);
    box.appendChild(body);
    return box;
  };
})();

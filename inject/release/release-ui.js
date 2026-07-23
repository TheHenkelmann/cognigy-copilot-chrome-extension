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
  const DIFF_CURRENT_VALUE = "__current__";
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
    manageOverlay: null,
    activeTab: "check",
    checkRunning: false,
    checkSkipped: false,
    checkStepIndex: -1,
    checkStepStates: {},
    checkStepExpanded: {},
    buildRunning: false,
    snapshots: [],
    releasesByName: {},
    selectedOldSide: DIFF_CURRENT_VALUE,
    selectedNewSide: DIFF_CURRENT_VALUE,
    currentFlows: [],
    diffFlows: [],
    selectedFlowName: "",
    searchQuery: "",
    searchUseRegex: false,
    searchError: "",
    searchHits: null,
    searchDecoIds: { original: [], modified: [], single: [] },
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
    tabsRendered: {},
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
    searchQuery: "",
    searchUseRegex: false,
    searchError: "",
    searchHits: null,
    searchDecoIds: { original: [], modified: [], single: [] },
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
      ".ccp-rel-diff-search{display:flex;flex-direction:column;gap:6px;width:100%;}",
      ".ccp-rel-diff-search-row{display:flex;align-items:center;gap:6px;width:100%;}",
      ".ccp-rel-diff-search-input{flex:1;min-width:0;box-sizing:border-box;padding:7px 10px;border-radius:4px;border:1px solid #454545;background:#3c3c3c;color:#cccccc;font-size:12px;font-family:inherit;}",
      ".ccp-rel-diff-search-input:focus{outline:none;border-color:#007acc;}",
      ".ccp-rel-diff-search-input.ccp-rel-search-invalid{border-color:#f87171;}",
      ".ccp-rel-diff-search-regex{flex-shrink:0;width:30px;height:30px;padding:0;border-radius:4px;border:1px solid #454545;background:#3c3c3c;color:#858585;cursor:pointer;font-size:12px;font-weight:700;font-family:ui-monospace,Menlo,Consolas,monospace;line-height:1;}",
      ".ccp-rel-diff-search-regex.ccp-on{background:#094771;border-color:#007acc;color:#ffffff;}",
      ".ccp-rel-diff-search-regex:hover{background:#505050;color:#ffffff;}",
      ".ccp-rel-diff-search-regex.ccp-on:hover{background:#0b5a8c;}",
      ".ccp-rel-diff-search-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:14px;font-size:11px;color:#858585;}",
      ".ccp-rel-diff-search-counts{font-variant-numeric:tabular-nums;}",
      ".ccp-rel-diff-search-counts strong{color:#cccccc;font-weight:600;}",
      ".ccp-rel-diff-search-err{color:#f87171;}",
      ".ccp-rel-flow-item.ccp-rel-search-ghost{opacity:0.32;}",
      ".ccp-rel-flow-item.ccp-rel-search-ghost:hover{opacity:0.55;}",
      ".ccp-rel-flow-hits{display:flex;align-items:center;gap:4px;flex-shrink:0;margin-left:auto;}",
      ".ccp-rel-flow-hit{min-width:16px;height:16px;padding:0 5px;border-radius:8px;font-size:10px;font-weight:700;line-height:16px;text-align:center;font-variant-numeric:tabular-nums;}",
      ".ccp-rel-flow-hit-old{background:rgba(148,163,184,0.28);color:#cbd5e1;}",
      ".ccp-rel-flow-hit-new{background:rgba(59,130,246,0.32);color:#93c5fd;}",
      ".ccp-rel-flow-hit.ccp-rel-hit-zero{opacity:0.4;}",
      ".ccp-rel-search-ghost-line{opacity:0.28!important;}",
      ".ccp-rel-search-match{background:rgba(234,179,8,0.42);border-radius:2px;}",
      ".ccp-rel-diff-panel .ccp-rel-snap-select{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid #454545;background:#3c3c3c;color:#cccccc;font-size:12px;font-family:inherit;}",
      ".ccp-rel-diff-panel .ccp-rel-snap-select option:disabled{color:#858585;}",
      ".ccp-rel-diff-panel .ccp-rel-snap-select option{background:#3c3c3c;color:#cccccc;}",
      ".ccp-rel-snap-row{display:flex;gap:8px;align-items:center;width:100%;}",
      ".ccp-rel-snap-label-row{display:flex;align-items:center;width:100%;}",
      ".ccp-rel-snap-label-row .ccp-rel-label{margin:0;}",
      ".ccp-rel-snap-row .ccp-rel-snap-select{flex:1;min-width:0;width:auto;box-sizing:border-box;padding:8px 10px;border-radius:4px;border:1px solid #454545;background:#3c3c3c;color:#cccccc;font-size:12px;font-family:inherit;}",
      ".ccp-rel-snap-row .ccp-rel-btn-copy-project{flex-shrink:0;padding:6px 8px;font-size:11px;white-space:nowrap;}",
      ".ccp-rel-snap-gear{width:30px;height:30px;padding:0;flex-shrink:0;}",
      ".ccp-rel-diff-sidebar-head .ccp-rel-annotate-copy-row{width:100%;flex-wrap:nowrap;}",
      ".ccp-rel-diff-sidebar-head .ccp-rel-annotate-copy-row .ccp-rel-btn{flex:1;min-width:0;justify-content:center;}",
      ".ccp-rel-confirm-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}",
      ".ccp-rel-confirm-card{max-width:440px;width:100%;padding:20px;border-radius:12px;background:#181b22;border:1px solid rgba(255,255,255,0.12);box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#ececec;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}",
      ".ccp-rel-confirm-title{font-size:16px;font-weight:700;margin:0 0 10px;}",
      ".ccp-rel-confirm-text{font-size:13px;line-height:1.5;color:rgba(220,220,220,0.9);margin:0 0 12px;}",
      ".ccp-rel-confirm-phrase{display:block;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#fde68a;margin-bottom:12px;word-break:break-all;}",
      ".ccp-rel-confirm-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;}",
      ".ccp-rel-confirm-err{font-size:12px;color:#fca5a5;margin-top:8px;min-height:16px;}",
      ".ccp-rel-cleanup-card{max-width:760px;width:100%;max-height:85vh;display:flex;flex-direction:column;padding:20px;border-radius:12px;background:#181b22;border:1px solid rgba(255,255,255,0.12);box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#ececec;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-sizing:border-box;}",
      ".ccp-rel-cleanup-title{font-size:16px;font-weight:700;margin:0 0 10px;}",
      ".ccp-rel-cleanup-info{margin-bottom:14px;}",
      ".ccp-rel-cleanup-body{flex:1;min-height:0;overflow:auto;margin-bottom:14px;}",
      ".ccp-rel-cleanup-list{display:flex;flex-direction:column;gap:8px;}",
      ".ccp-rel-cleanup-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.08);}",
      ".ccp-rel-cleanup-item-main{flex:1;min-width:0;}",
      ".ccp-rel-cleanup-item-name{font-size:13px;font-weight:600;color:#eee;line-height:1.35;word-break:break-word;}",
      ".ccp-rel-cleanup-item-meta{font-size:11px;color:rgba(180,180,180,0.9);margin-top:3px;line-height:1.4;}",
      ".ccp-rel-cleanup-item-actions{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;}",
      ".ccp-rel-cleanup-item-actions .ccp-rel-btn{padding:6px 10px;font-size:11px;white-space:nowrap;}",
      ".ccp-rel-cleanup-err{margin-top:6px;font-size:11px;line-height:1.4;color:#f87171;}",
      ".ccp-rel-cleanup-footer{display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);}",
      ".ccp-rel-manage-overlay .ccp-rel-manage-body{flex:1;min-height:0;overflow:auto;padding:18px;}",
      ".ccp-rel-manage-list{display:flex;flex-direction:column;gap:8px;max-width:960px;margin:0 auto;}",
      ".ccp-rel-fab-gear{width:26px;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:#ddd;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;padding:0;}",
      ".ccp-rel-fab-gear:hover{background:rgba(255,255,255,0.1);}",
      ".ccp-rel-diff-sidebar .ccp-rel-flow-list{flex:1;min-height:0;border-left:none;width:100%;max-width:100%;flex-basis:auto;background:#252526;}",
      ".ccp-rel-diff-panel .ccp-rel-flow-item{border-bottom:1px solid #333333;color:#cccccc;}",
      ".ccp-rel-diff-panel .ccp-rel-flow-item:hover{background:#2a2d2e;}",
      ".ccp-rel-diff-panel .ccp-rel-flow-item.ccp-on{background:#094771;color:#ffffff;}",
      ".ccp-rel-diff-panel .ccp-rel-btn{border:1px solid #454545;background:#3c3c3c;color:#cccccc;}",
      ".ccp-rel-diff-panel .ccp-rel-btn:hover:not(:disabled){background:#505050;color:#ffffff;}",
      ".ccp-rel-diff-panel .ccp-rel-btn.ccp-rel-btn-copied{background:#094771!important;border-color:#007acc!important;color:#ffffff!important;}",
      ".ccp-rel-diff-empty{padding:24px;font-size:13px;color:#858585;}",
      ".ccp-rel-diff-editor-toolbar{display:flex;flex-shrink:0;border-bottom:1px solid #454545;background:#252526;}",
      ".ccp-rel-diff-side-toolbar{flex:1 1 50%;min-width:0;padding:8px 12px;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;}",
      ".ccp-rel-diff-side-toolbar-new{border-left:1px solid #454545;}",
      ".ccp-rel-diff-side-toolbar .ccp-rel-label{margin:0;font-size:11px;color:#858585;}",
      ".ccp-rel-diff-side-toolbar .ccp-rel-snap-row{width:100%;}",
      ".ccp-rel-diff-side-toolbar .ccp-rel-snap-select{width:100%;}",
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

  function playbookRunResultStatus(run) {
    return String((run && run.runResult && run.runResult.status) || "").toLowerCase();
  }

  function playbookUiStatus(run, phase) {
    if (phase === "start") return "running";
    if (!run) return "open";
    if (run.error || String(run.status || "").toLowerCase() === "error") return "failed";
    const st = String(run.status || "").toLowerCase();
    if (st === "cancelled" || st === "cancelling") return "failed";
    const result = playbookRunResultStatus(run);
    if (result === "failed" || result === "unknown") return "failed";
    if (result === "successful") return "success";
    if (st === "done") {
      // Task finished, but the run verdict isn't resolved yet — keep it
      // "running" so we don't flash a premature success.
      if (phase === "done") return playbookRunFailed(run) ? "failed" : "success";
      return "running";
    }
    if (st === "active") return "running";
    if (st === "queued" || st === "pending") return "open";
    return "open";
  }

  function playbookUiMessage(run, phase) {
    if (phase === "start") return "Starte…";
    if (!run) return "";
    if (run.error) return String(run.error);
    const st = String(run.status || "").toLowerCase();
    const result = playbookRunResultStatus(run);
    if (result === "successful") return "Erfolgreich";
    if (result === "failed") return "Fehlgeschlagen";
    if (st === "done") return "Prüfe Ergebnis…";
    if (phase === "scheduled" && st === "queued") return "Geplant";
    if (st === "active") return "Task läuft…";
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
    const result = playbookRunResultStatus(run);
    if (result === "successful") return "Erfolgreich";
    if (result === "failed") return "Fehlgeschlagen";
    const st = String(run.status || "").toLowerCase();
    if (st === "done") return "Erfolgreich";
    return st || "Unbekannt";
  }

  function playbookRunFailed(run) {
    if (!run) return true;
    if (run.error) return true;
    const result = playbookRunResultStatus(run);
    if (result === "failed" || result === "unknown") return true;
    if (result === "successful") return false;
    // No verdict resolved: fall back to the task lifecycle status.
    return String(run.status || "").toLowerCase() !== "done";
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
    const releases = await CCP.release.loadAllReleases();
    state.releasesByName = {};
    (releases || []).forEach(function (r) {
      if (r && r.release_name) state.releasesByName[String(r.release_name)] = r;
    });
    state.snapshots = mergeSnapshotsWithLocalReleases(state.snapshots, state.releasesByName);
    const payload = await CCP.release.buildCurrentReleasePayload({ release_name: state.releaseName });
    state.currentFlows = payload.flows || [];
    applyDiffDefaults(state);
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

  function populateFlowListEl(flowListEl, diffFlows, selectedFlowName, onSelect, searchHits) {
    flowListEl.innerHTML = "";
    const active = !!(searchHits && searchHits.active);
    const byFlow = (searchHits && searchHits.byFlow) || {};
    (diffFlows || []).forEach(function (d) {
      const hits = byFlow[d.name] || { old: 0, new: 0 };
      const totalHits = (hits.old || 0) + (hits.new || 0);
      const ghost = active && totalHits === 0;
      const item = el(
        "div",
        "ccp-rel-flow-item" +
          (d.name === selectedFlowName ? " ccp-on" : "") +
          (ghost ? " ccp-rel-search-ghost" : "")
      );
      item.dataset.flowName = d.name;
      item.title = d.status;
      item.appendChild(el("span", "ccp-rel-flow-item-name", d.name));
      if (active && totalHits > 0) {
        const hitsEl = el("span", "ccp-rel-flow-hits");
        const oldHit = el(
          "span",
          "ccp-rel-flow-hit ccp-rel-flow-hit-old" + (!(hits.old > 0) ? " ccp-rel-hit-zero" : ""),
          String(hits.old || 0)
        );
        oldHit.title = "Treffer Alt: " + (hits.old || 0);
        hitsEl.appendChild(oldHit);
        const newHit = el(
          "span",
          "ccp-rel-flow-hit ccp-rel-flow-hit-new" + (!(hits.new > 0) ? " ccp-rel-hit-zero" : ""),
          String(hits.new || 0)
        );
        newHit.title = "Treffer Neu: " + (hits.new || 0);
        hitsEl.appendChild(newHit);
        item.appendChild(hitsEl);
      }
      const dotCls = flowChangeDotClass(d.status);
      if (dotCls) item.appendChild(el("span", "ccp-rel-flow-dot " + dotCls));
      item.addEventListener("click", function () {
        onSelect(d.name);
      });
      flowListEl.appendChild(item);
    });
  }

  function lineNumberAtIndex(text, index) {
    if (index <= 0) return 1;
    let lines = 1;
    for (let i = 0; i < index && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) lines++;
    }
    return lines;
  }

  function countMatchesInText(text, source, isRegex) {
    const value = String(text || "");
    const needle = String(source || "");
    if (!needle || !value) return { count: 0, lines: [], ranges: [] };
    const lineSet = {};
    const ranges = [];
    let count = 0;

    if (isRegex) {
      let re;
      try {
        re = new RegExp(needle, "gm");
      } catch (_) {
        return { count: 0, lines: [], ranges: [], error: true };
      }
      let match;
      let guard = 0;
      const max = Math.max(value.length * 2, 1000);
      while ((match = re.exec(value)) !== null) {
        guard++;
        if (guard > max) break;
        const start = match.index;
        const matched = match[0] == null ? "" : String(match[0]);
        const end = start + matched.length;
        if (matched.length === 0) {
          if (re.lastIndex === start) re.lastIndex = start + 1;
          continue;
        }
        count++;
        const startLine = lineNumberAtIndex(value, start);
        const endLine = lineNumberAtIndex(value, Math.max(start, end - 1));
        for (let ln = startLine; ln <= endLine; ln++) lineSet[ln] = true;
        const startCol = start - (value.lastIndexOf("\n", start - 1) + 1) + 1;
        const endCol = end - (value.lastIndexOf("\n", end - 1) + 1) + 1;
        ranges.push({
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
        });
      }
    } else {
      const lower = value.toLowerCase();
      const find = needle.toLowerCase();
      let idx = 0;
      while ((idx = lower.indexOf(find, idx)) !== -1) {
        count++;
        const end = idx + find.length;
        const startLine = lineNumberAtIndex(value, idx);
        const endLine = lineNumberAtIndex(value, Math.max(idx, end - 1));
        for (let ln = startLine; ln <= endLine; ln++) lineSet[ln] = true;
        const startCol = idx - (value.lastIndexOf("\n", idx - 1) + 1) + 1;
        const endCol = end - (value.lastIndexOf("\n", end - 1) + 1) + 1;
        ranges.push({
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
        });
        idx += find.length || 1;
      }
    }

    return {
      count: count,
      lines: Object.keys(lineSet)
        .map(Number)
        .sort(function (a, b) {
          return a - b;
        }),
      ranges: ranges,
    };
  }

  function validateDiffSearchRegex(source) {
    try {
      void new RegExp(source, "gm");
      return "";
    } catch (e) {
      return e && e.message ? String(e.message) : "Ungültige Regex";
    }
  }

  function computeDiffSearchHits(ctx) {
    const query = String((ctx && ctx.searchQuery) || "");
    const useRegex = !!(ctx && ctx.searchUseRegex);
    if (!query) {
      return {
        active: false,
        error: "",
        sameSide: false,
        oldTotal: 0,
        newTotal: 0,
        byFlow: {},
      };
    }
    if (useRegex) {
      const err = validateDiffSearchRegex(query);
      if (err) {
        return {
          active: false,
          error: err,
          sameSide: false,
          oldTotal: 0,
          newTotal: 0,
          byFlow: {},
        };
      }
    }

    const sameSide = String(ctx.selectedOldSide || "") === String(ctx.selectedNewSide || "");
    const byFlow = {};
    let oldTotal = 0;
    let newTotal = 0;

    (ctx.diffFlows || []).forEach(function (d) {
      const oldText = d.oldJson || "";
      const newText = d.newJson || "";
      if (sameSide) {
        const once = countMatchesInText(oldText || newText, query, useRegex);
        byFlow[d.name] = {
          old: once.count,
          new: once.count,
          oldLines: once.lines,
          newLines: once.lines,
          oldRanges: once.ranges,
          newRanges: once.ranges,
        };
        oldTotal += once.count;
        newTotal += once.count;
        return;
      }
      const oldHits = countMatchesInText(oldText, query, useRegex);
      const newHits = countMatchesInText(newText, query, useRegex);
      byFlow[d.name] = {
        old: oldHits.count,
        new: newHits.count,
        oldLines: oldHits.lines,
        newLines: newHits.lines,
        oldRanges: oldHits.ranges,
        newRanges: newHits.ranges,
      };
      oldTotal += oldHits.count;
      newTotal += newHits.count;
    });

    return {
      active: true,
      error: "",
      sameSide: sameSide,
      oldTotal: oldTotal,
      newTotal: newTotal,
      byFlow: byFlow,
    };
  }

  function updateDiffSearchMeta(refs, ctx) {
    if (!refs || !refs.searchCounts) return;
    const hits = ctx.searchHits;
    if (ctx.searchError) {
      refs.searchCounts.className = "ccp-rel-diff-search-counts ccp-rel-diff-search-err";
      refs.searchCounts.textContent = "Ungültige Regex";
      refs.searchCounts.title = ctx.searchError;
      return;
    }
    refs.searchCounts.className = "ccp-rel-diff-search-counts";
    refs.searchCounts.title = "";
    if (!hits || !hits.active) {
      refs.searchCounts.textContent = "";
      return;
    }
    refs.searchCounts.innerHTML =
      "Alt <strong>" +
      hits.oldTotal +
      "</strong> · Neu <strong>" +
      hits.newTotal +
      "</strong>";
  }

  function syncDiffSearchInputUi(refs, ctx) {
    if (!refs) return;
    if (refs.searchInput) {
      if (refs.searchInput.value !== ctx.searchQuery) refs.searchInput.value = ctx.searchQuery || "";
      refs.searchInput.classList.toggle("ccp-rel-search-invalid", !!ctx.searchError);
    }
    if (refs.searchRegexBtn) {
      refs.searchRegexBtn.classList.toggle("ccp-on", !!ctx.searchUseRegex);
      refs.searchRegexBtn.setAttribute("aria-pressed", ctx.searchUseRegex ? "true" : "false");
    }
    updateDiffSearchMeta(refs, ctx);
  }

  function buildGhostLineRanges(totalLines, matchLines) {
    const matched = {};
    (matchLines || []).forEach(function (ln) {
      matched[ln] = true;
    });
    const ranges = [];
    let start = null;
    for (let i = 1; i <= totalLines; i++) {
      if (!matched[i]) {
        if (start == null) start = i;
      } else if (start != null) {
        ranges.push({ start: start, end: i - 1 });
        start = null;
      }
    }
    if (start != null) ranges.push({ start: start, end: totalLines });
    return ranges;
  }

  function clearSearchDecorations(ctx) {
    if (!ctx) return;
    if (!ctx.searchDecoIds) ctx.searchDecoIds = { original: [], modified: [], single: [] };
    function clearOnEditor(editor, key) {
      if (!editor || typeof editor.deltaDecorations !== "function") return;
      try {
        ctx.searchDecoIds[key] = editor.deltaDecorations(ctx.searchDecoIds[key] || [], []);
      } catch (_) {
        ctx.searchDecoIds[key] = [];
      }
    }
    if (ctx.diffEditor && typeof ctx.diffEditor.getOriginalEditor === "function") {
      clearOnEditor(ctx.diffEditor.getOriginalEditor(), "original");
      clearOnEditor(ctx.diffEditor.getModifiedEditor(), "modified");
    }
    clearOnEditor(ctx.singleEditor, "single");
  }

  function buildSearchDecorations(monaco, matchRanges, matchLines, totalLines) {
    if (!monaco || !monaco.Range) return [];
    const decorations = [];
    const overviewColor = "#d7ba7d";
    const lane =
      monaco.editor && monaco.editor.OverviewRulerLane
        ? monaco.editor.OverviewRulerLane.Center
        : 2;

    (matchRanges || []).forEach(function (r) {
      decorations.push({
        range: new monaco.Range(
          r.startLineNumber,
          r.startColumn,
          r.endLineNumber,
          r.endColumn
        ),
        options: {
          inlineClassName: "ccp-rel-search-match",
          overviewRuler: {
            color: overviewColor,
            position: lane,
          },
        },
      });
    });

    if ((matchRanges || []).length || (matchLines || []).length) {
      buildGhostLineRanges(totalLines, matchLines).forEach(function (block) {
        decorations.push({
          range: new monaco.Range(block.start, 1, block.end, 1),
          options: {
            isWholeLine: true,
            className: "ccp-rel-search-ghost-line",
          },
        });
      });
    }
    return decorations;
  }

  function applySearchDecorationsToEditor(monaco, editor, key, ctx, matchRanges, matchLines) {
    if (!editor || typeof editor.deltaDecorations !== "function") return;
    if (!ctx.searchDecoIds) ctx.searchDecoIds = { original: [], modified: [], single: [] };
    const model = typeof editor.getModel === "function" ? editor.getModel() : null;
    if (!model || (typeof model.isDisposed === "function" && model.isDisposed())) {
      ctx.searchDecoIds[key] = editor.deltaDecorations(ctx.searchDecoIds[key] || [], []);
      return;
    }
    const totalLines = typeof model.getLineCount === "function" ? model.getLineCount() : 0;
    const decorations = buildSearchDecorations(monaco, matchRanges, matchLines, totalLines);
    try {
      ctx.searchDecoIds[key] = editor.deltaDecorations(ctx.searchDecoIds[key] || [], decorations);
    } catch (_) {
      ctx.searchDecoIds[key] = [];
    }
  }

  function applyDiffSearchToEditor(ctx) {
    clearSearchDecorations(ctx);
    const hits = ctx && ctx.searchHits;
    if (!hits || !hits.active || ctx.searchError) return;
    const monaco = state.monaco;
    if (!monaco) return;
    const flowHits =
      (hits.byFlow && ctx.selectedFlowName && hits.byFlow[ctx.selectedFlowName]) || null;
    if (!flowHits) return;

    if (ctx.singleEditor) {
      applySearchDecorationsToEditor(
        monaco,
        ctx.singleEditor,
        "single",
        ctx,
        flowHits.newRanges || [],
        flowHits.newLines || []
      );
      return;
    }
    if (!ctx.diffEditor) return;
    if (typeof ctx.diffEditor.getOriginalEditor === "function") {
      applySearchDecorationsToEditor(
        monaco,
        ctx.diffEditor.getOriginalEditor(),
        "original",
        ctx,
        flowHits.oldRanges || [],
        flowHits.oldLines || []
      );
    }
    if (typeof ctx.diffEditor.getModifiedEditor === "function") {
      applySearchDecorationsToEditor(
        monaco,
        ctx.diffEditor.getModifiedEditor(),
        "modified",
        ctx,
        flowHits.newRanges || [],
        flowHits.newLines || []
      );
    }
  }

  function refreshDiffSearch(ctx, refs) {
    if (!ctx) return;
    const hits = computeDiffSearchHits(ctx);
    ctx.searchHits = hits;
    ctx.searchError = hits.error || "";
    if (refs) {
      syncDiffSearchInputUi(refs, ctx);
      if (refs.flowList) {
        populateFlowListEl(refs.flowList, ctx.diffFlows, ctx.selectedFlowName, function (flowName) {
          ctx.selectedFlowName = flowName;
          highlightFlowListSelection(refs.flowList, flowName);
          updateDiffEditorModels(ctx, refs.diffHost);
          applyDiffSearchToEditor(ctx);
        }, hits);
      }
    }
    applyDiffSearchToEditor(ctx);
  }

  function setDiffSearchQuery(ctx, refs, query) {
    ctx.searchQuery = String(query || "");
    refreshDiffSearch(ctx, refs);
  }

  function setDiffSearchRegex(ctx, refs, enabled) {
    ctx.searchUseRegex = !!enabled;
    refreshDiffSearch(ctx, refs);
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
      ctx.singleEditor.setValue(sel.newJson || "");
      applyDiffSearchToEditor(ctx);
      return;
    }
    if (!ctx.diffEditor) return;
    const orig = state.monaco.editor.createModel(sel.oldJson || "", "yaml");
    const mod = state.monaco.editor.createModel(sel.newJson || "", "yaml");
    ctx.diffEditor.setModel({ original: orig, modified: mod });
    applyDiffSearchToEditor(ctx);
  }

  async function mountMonacoDiffHost(host, ctx) {
    const monaco = await ensureMonaco();
    if (!host) return false;
    if (!monaco) {
      host.textContent = "Monaco Editor nicht verfügbar.";
      if (CCP.snackbar) CCP.snackbar.error("Monaco Editor nicht verfügbar");
      return false;
    }
    disposeMonacoEditors(ctx.diffEditor, ctx.singleEditor);
    ctx.diffEditor = null;
    ctx.singleEditor = null;
    ctx.searchDecoIds = { original: [], modified: [], single: [] };
    host.innerHTML = "";
    if (typeof monaco.editor.createDiffEditor === "function") {
      ctx.diffEditor = monaco.editor.createDiffEditor(host, {
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        theme: "vs-dark",
        minimap: { enabled: false },
      });
    } else if (typeof monaco.editor.create === "function") {
      ctx.singleEditor = monaco.editor.create(host, {
        value: "",
        language: "yaml",
        readOnly: true,
        automaticLayout: true,
        theme: "vs-dark",
        minimap: { enabled: false },
      });
    } else {
      host.textContent = "Monaco Editor nicht verfügbar.";
      if (CCP.snackbar) CCP.snackbar.error("Monaco Editor nicht verfügbar");
      return false;
    }
    updateDiffEditorModels(ctx, host);
    applyDiffSearchToEditor(ctx);
    requestAnimationFrame(function () {
      try {
        if (ctx.diffEditor && typeof ctx.diffEditor.layout === "function") ctx.diffEditor.layout();
        if (ctx.singleEditor && typeof ctx.singleEditor.layout === "function") ctx.singleEditor.layout();
      } catch (_) {}
    });
    return true;
  }

  function mergeSnapshotsWithLocalReleases(cognigySnapshots, releasesByName) {
    const merged = (cognigySnapshots || []).slice();
    const snapNames = new Set(
      merged.map(function (s) {
        return String(s.name || "");
      })
    );
    Object.keys(releasesByName || {}).forEach(function (name) {
      if (!name || snapNames.has(name)) return;
      const release = releasesByName[name];
      const createdAtMs = Number(release && release.created_at) || 0;
      merged.push({
        name: name,
        _id: null,
        id: null,
        localOnly: true,
        createdAt: createdAtMs ? Math.floor(createdAtMs / 1000) : 0,
        _release: release,
      });
    });
    merged.sort(function (a, b) {
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
    return merged;
  }

  function snapshotReleaseInfo(snap, releasesByName) {
    const name = String((snap && snap.name) || "");
    const release = releasesByName[name];
    if (release) {
      if (snap && snap.localOnly) {
        return {
          ok: true,
          release: release,
          localOnly: true,
          reason: "Nur lokal — Snapshot in Cognigy gelöscht",
        };
      }
      return { ok: true, release: release };
    }
    return { ok: false, reason: "Kein gespeicherter Release lokal" };
  }

  function resolveDiffSideFlows(ctx, sideValue) {
    if (!sideValue || sideValue === DIFF_CURRENT_VALUE) return ctx.currentFlows || [];
    const snap = findSnapshotByName(ctx.snapshots, sideValue);
    const info = snapshotReleaseInfo(snap, ctx.releasesByName);
    return info.ok ? info.release.flows || [] : [];
  }

  function getDiffOldFlows(ctx) {
    return resolveDiffSideFlows(ctx, ctx.selectedOldSide);
  }

  function getDiffNewFlows(ctx) {
    return resolveDiffSideFlows(ctx, ctx.selectedNewSide);
  }

  function applyDiffViewerComparison(ctx) {
    ctx.diffFlows = buildDiffFlowsList(getDiffOldFlows(ctx), getDiffNewFlows(ctx));
    ctx.selectedFlowName = pickDefaultFlowName(ctx.diffFlows);
  }

  function setDiffOldSide(ctx, value) {
    ctx.selectedOldSide = String(value || DIFF_CURRENT_VALUE);
    applyDiffViewerComparison(ctx);
  }

  function setDiffNewSide(ctx, value) {
    ctx.selectedNewSide = String(value || DIFF_CURRENT_VALUE);
    applyDiffViewerComparison(ctx);
  }

  function applyDiffDefaults(ctx) {
    ctx.selectedOldSide = DIFF_CURRENT_VALUE;
    ctx.selectedNewSide = DIFF_CURRENT_VALUE;
    applyDiffViewerComparison(ctx);
  }

  function isValidDiffSideValue(ctx, value) {
    if (!value || value === DIFF_CURRENT_VALUE) return true;
    const snap = findSnapshotByName(ctx.snapshots, value);
    return !!(snap && snapshotReleaseInfo(snap, ctx.releasesByName).ok);
  }

  function resolveDiffSideSelection(ctx, currentValue, fallbackValue) {
    if (isValidDiffSideValue(ctx, currentValue)) return String(currentValue || fallbackValue);
    return String(fallbackValue);
  }

  function syncDiffViewerSelections(ctx, data) {
    if (!ctx || !data) return;
    ctx.releasesByName = data.releasesByName;
    ctx.snapshots = data.snapshots;
    ctx.selectedOldSide = resolveDiffSideSelection(ctx, ctx.selectedOldSide, DIFF_CURRENT_VALUE);
    ctx.selectedNewSide = resolveDiffSideSelection(ctx, ctx.selectedNewSide, DIFF_CURRENT_VALUE);
    applyDiffViewerComparison(ctx);
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
      snapshots: mergeSnapshotsWithLocalReleases(snapshots, releasesByName),
      releasesByName: releasesByName,
      currentFlows: payload.flows || [],
    };
  }

  function createDiffSideToolbar(labelText, selectClass) {
    const toolbar = el("div", "ccp-rel-diff-side-toolbar");
    toolbar.appendChild(el("label", "ccp-rel-label", labelText));
    const row = el("div", "ccp-rel-snap-row");
    const select = el("select", "ccp-rel-snap-select " + selectClass);
    const copyProjectLabel = "Projekt";
    const copyProjectBtn = createCopyIconButton(copyProjectLabel);
    copyProjectBtn.classList.add("ccp-rel-btn-copy-project");
    copyProjectBtn.title = "Gesamtes Projekt dieser Seite kopieren / herunterladen";
    copyProjectBtn.setAttribute("aria-label", "Gesamtes Projekt kopieren");
    const gearBtn = el("button", "ccp-rel-icon-btn ccp-rel-snap-gear", "⚙");
    gearBtn.type = "button";
    gearBtn.title = "Releases & Snapshots verwalten";
    gearBtn.setAttribute("aria-label", "Releases & Snapshots verwalten");
    row.appendChild(select);
    row.appendChild(copyProjectBtn);
    row.appendChild(gearBtn);
    toolbar.appendChild(row);
    return {
      toolbar: toolbar,
      select: select,
      copyProjectBtn: copyProjectBtn,
      copyProjectLabel: copyProjectLabel,
      copyProjectDefaultHtml: copyIconButtonHtml(copyProjectLabel),
      gearBtn: gearBtn,
    };
  }

  function createDiffViewerLayoutDom() {
    const layout = el("div", "ccp-rel-diff-layout");
    const sidebar = el("div", "ccp-rel-diff-sidebar");
    const sidebarHead = el("div", "ccp-rel-diff-sidebar-head");

    const copyRow = el("div", "ccp-rel-annotate-copy-row");
    const copyFlowLabel = "Flow";
    const copyAllLabel = "Projekt";
    const copyFlowBtn = createCopyIconButton(copyFlowLabel);
    const copyAllBtn = createCopyIconButton(copyAllLabel);
    copyRow.appendChild(copyAllBtn);
    copyRow.appendChild(copyFlowBtn);
    sidebarHead.appendChild(copyRow);

    const searchWrap = el("div", "ccp-rel-diff-search");
    const searchRow = el("div", "ccp-rel-diff-search-row");
    const searchInput = el("input", "ccp-rel-diff-search-input");
    searchInput.type = "search";
    searchInput.placeholder = "Suchen (Text oder Regex)";
    searchInput.setAttribute("aria-label", "Diff durchsuchen");
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    const searchRegexBtn = el("button", "ccp-rel-diff-search-regex", ".*");
    searchRegexBtn.type = "button";
    searchRegexBtn.title = "Regex-Suche";
    searchRegexBtn.setAttribute("aria-label", "Regex-Suche umschalten");
    searchRegexBtn.setAttribute("aria-pressed", "false");
    searchRow.appendChild(searchInput);
    searchRow.appendChild(searchRegexBtn);
    searchWrap.appendChild(searchRow);
    const searchMeta = el("div", "ccp-rel-diff-search-meta");
    const searchCounts = el("span", "ccp-rel-diff-search-counts");
    searchMeta.appendChild(searchCounts);
    searchWrap.appendChild(searchMeta);
    sidebarHead.appendChild(searchWrap);

    sidebar.appendChild(sidebarHead);

    const flowList = el("div", "ccp-rel-flow-list");
    sidebar.appendChild(flowList);
    layout.appendChild(sidebar);

    const main = el("div", "ccp-rel-diff-main");
    const editorToolbar = el("div", "ccp-rel-diff-editor-toolbar");
    const oldSide = createDiffSideToolbar("Alt", "ccp-rel-snap-select-old");
    const newSide = createDiffSideToolbar("Neu", "ccp-rel-snap-select-new");
    newSide.toolbar.classList.add("ccp-rel-diff-side-toolbar-new");
    editorToolbar.appendChild(oldSide.toolbar);
    editorToolbar.appendChild(newSide.toolbar);
    main.appendChild(editorToolbar);

    const diffHost = el("div", "ccp-rel-diff-main-editor");
    main.appendChild(diffHost);
    layout.appendChild(main);

    return {
      layout: layout,
      refs: {
        oldSelect: oldSide.select,
        newSelect: newSide.select,
        oldGearBtn: oldSide.gearBtn,
        newGearBtn: newSide.gearBtn,
        oldCopyProjectBtn: oldSide.copyProjectBtn,
        newCopyProjectBtn: newSide.copyProjectBtn,
        oldCopyProjectLabel: oldSide.copyProjectLabel,
        newCopyProjectLabel: newSide.copyProjectLabel,
        oldCopyProjectDefaultHtml: oldSide.copyProjectDefaultHtml,
        newCopyProjectDefaultHtml: newSide.copyProjectDefaultHtml,
        flowList: flowList,
        diffHost: diffHost,
        copyFlowBtn: copyFlowBtn,
        copyAllBtn: copyAllBtn,
        copyFlowLabel: copyFlowLabel,
        copyAllLabel: copyAllLabel,
        copyFlowDefaultHtml: copyIconButtonHtml(copyFlowLabel),
        copyAllDefaultHtml: copyIconButtonHtml(copyAllLabel),
        searchInput: searchInput,
        searchRegexBtn: searchRegexBtn,
        searchCounts: searchCounts,
      },
    };
  }

  function wireDiffViewerEvents(ctx, refs) {
    function onSideChange(value, setter) {
      if (!isValidDiffSideValue(ctx, value)) return;
      setter(ctx, value);
      refreshDiffViewerUi(ctx, refs);
      void mountMonacoDiffHost(refs.diffHost, ctx);
    }

    refs.oldSelect.addEventListener("change", function () {
      onSideChange(refs.oldSelect.value, setDiffOldSide);
    });
    refs.newSelect.addEventListener("change", function () {
      onSideChange(refs.newSelect.value, setDiffNewSide);
    });

    function openManageOverlay() {
      ui.openReleaseManageOverlay({
        onDataChange: function () {
          refreshDiffViewerUi(ctx, refs);
          void mountMonacoDiffHost(refs.diffHost, ctx);
        },
      });
    }

    refs.oldGearBtn.addEventListener("click", openManageOverlay);
    refs.newGearBtn.addEventListener("click", openManageOverlay);

    if (refs.searchInput) {
      let searchTimer = null;
      refs.searchInput.addEventListener("input", function () {
        const value = refs.searchInput.value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          setDiffSearchQuery(ctx, refs, value);
        }, 120);
      });
      refs.searchInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && refs.searchInput.value) {
          ev.preventDefault();
          ev.stopPropagation();
          refs.searchInput.value = "";
          setDiffSearchQuery(ctx, refs, "");
        }
      });
    }
    if (refs.searchRegexBtn) {
      refs.searchRegexBtn.addEventListener("click", function () {
        setDiffSearchRegex(ctx, refs, !ctx.searchUseRegex);
      });
    }

    function wireCopyFullProject(btn, label, defaultHtml, getFlows, sideKey) {
      if (!btn) return;
      btn.addEventListener("click", function () {
        const flows = getFlows(ctx);
        const text = CCP.release.flowsText(flows);
        const sideName = sideKey === "old" ? ctx.selectedOldSide : ctx.selectedNewSide;
        const filename =
          "projekt-" + String(sideName || "current").replace(/[^\w.-]+/g, "_") + ".txt";
        void exportProjectText(text, filename).then(function (result) {
          if (result.copied) showCopyFeedback(btn, label, defaultHtml);
          else if (result.downloaded) {
            if (CCP.snackbar) CCP.snackbar.info("Download", "Projekt als Datei heruntergeladen");
          } else if (CCP.snackbar) CCP.snackbar.error("Kopieren fehlgeschlagen");
        });
      });
    }

    wireCopyFullProject(
      refs.oldCopyProjectBtn,
      refs.oldCopyProjectLabel,
      refs.oldCopyProjectDefaultHtml,
      getDiffOldFlows,
      "old"
    );
    wireCopyFullProject(
      refs.newCopyProjectBtn,
      refs.newCopyProjectLabel,
      refs.newCopyProjectDefaultHtml,
      getDiffNewFlows,
      "new"
    );

    refs.copyFlowBtn.addEventListener("click", function () {
      const text = CCP.release.diffText(getDiffOldFlows(ctx), getDiffNewFlows(ctx), {
        flowName: ctx.selectedFlowName,
      });
      void copyToClipboard(text).then(function (ok) {
        if (ok) showCopyFeedback(refs.copyFlowBtn, refs.copyFlowLabel, refs.copyFlowDefaultHtml);
        else if (CCP.snackbar) CCP.snackbar.error("Kopieren fehlgeschlagen");
      });
    });
    refs.copyAllBtn.addEventListener("click", function () {
      const text = CCP.release.diffText(getDiffOldFlows(ctx), getDiffNewFlows(ctx));
      void copyToClipboard(text).then(function (ok) {
        if (ok) showCopyFeedback(refs.copyAllBtn, refs.copyAllLabel, refs.copyAllDefaultHtml);
        else if (CCP.snackbar) CCP.snackbar.error("Kopieren fehlgeschlagen");
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

  function downloadTextFile(text, filename) {
    try {
      const blob = new Blob([String(text || "")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "projekt.txt";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Prefer clipboard; fall back to file download if copy fails (e.g. large payloads). */
  async function exportProjectText(text, filename) {
    const copied = await copyToClipboard(text);
    if (copied) return { copied: true, downloaded: false };
    const downloaded = downloadTextFile(text, filename);
    return { copied: false, downloaded: downloaded };
  }

  async function renderAnnotateTab(container) {
    container.innerHTML = el("div", "", "Annotate wird vorbereitet…").outerHTML;
    try {
      await prepareAnnotateData();
    } catch (e) {
      container.innerHTML = "";
      container.appendChild(el("div", "ccp-rel-warn", "Fehler beim Laden: " + e.message));
      if (CCP.snackbar) CCP.pushApiError(CCP.snackbar.error, e);
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
        if (CCP.snackbar) {
          CCP.snackbar.warning("Gemini API Key fehlt", "Bitte in den Einstellungen hinterlegen.");
        }
        if (FEATURES.settings) ui.openSettings();
        return;
      }
      target.value = "";
      thoughtsEl.textContent = "";
      thoughtsEl.classList.add("ccp-on");
      const diffText = CCP.release.diffText(getDiffOldFlows(state), getDiffNewFlows(state));
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
        if (CCP.snackbar) CCP.snackbar.error("AI-Fehler", e.message);
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
      void startBuildFlow();
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

  async function startBuildFlow() {
    const projectId = CCP.namingApi.getProjectId();
    let cognigySnapshots = [];
    try {
      cognigySnapshots = await CCP.release.api.listSnapshots(projectId);
    } catch (e) {
      console.warn("[CCP release-ui] listSnapshots before build failed", e);
    }
    if (cognigySnapshots.length >= 10) {
      const proceed = await ui.openReleaseManageOverlay({ mode: "build-cleanup" });
      if (!proceed) return;
    }
    switchTab("build");
    const buildPanel = state.overlay && state.overlay.querySelector('[data-tab-panel="build"]');
    if (buildPanel) void runBuild(buildPanel);
  }

  async function runBuild(buildPanel) {
    const projectId = CCP.namingApi.getProjectId();
    const buildContainer = buildPanel;
    buildContainer.innerHTML = "";
    if (!state.tabsRendered) state.tabsRendered = {};
    state.tabsRendered.build = true;
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
        if (CCP.snackbar) CCP.snackbar.error("Build fehlgeschlagen", id + ": " + e.message);
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
    if (!state.tabsRendered) state.tabsRendered = {};
    if (tabId === "check" && !state.tabsRendered.check) {
      renderCheckTab(panel);
      state.tabsRendered.check = true;
    }
    if (tabId === "annotate" && !state.tabsRendered.annotate) {
      state.tabsRendered.annotate = true;
      void renderAnnotateTab(panel);
    }
    if (
      tabId === "build" &&
      !state.tabsRendered.build &&
      !state.buildRunning &&
      !panel.querySelector(".ccp-rel-step")
    ) {
      panel.innerHTML = el("div", "", 'Wechsle zu Annotate und klicke "Build Release".').outerHTML;
      state.tabsRendered.build = true;
    }
    if (tabId === "annotate" || tabId === "build") {
      requestAnimationFrame(function () {
        try {
          if (state.diffEditor && typeof state.diffEditor.layout === "function") state.diffEditor.layout();
          if (state.singleEditor && typeof state.singleEditor.layout === "function")
            state.singleEditor.layout();
        } catch (_) {}
      });
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
    const minimizeBtn = el("button", "ccp-rel-icon-btn", "−");
    minimizeBtn.type = "button";
    minimizeBtn.title = "Minimieren";
    minimizeBtn.setAttribute("aria-label", "Minimieren");
    minimizeBtn.addEventListener("click", function () {
      ui.closeReleaseOverlay();
    });
    header.appendChild(minimizeBtn);
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
      try {
        await saveSettings();
        if (CCP.snackbar) CCP.snackbar.success("Einstellungen gespeichert");
        ui.closeSettings();
      } catch (e) {
        if (CCP.snackbar) CCP.pushApiError(CCP.snackbar.error, e);
      }
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
    if (state.overlay) {
      state.overlay.style.display = "";
      switchTab(state.activeTab);
      return;
    }
    buildReleaseOverlay();
  };

  ui.closeReleaseOverlay = function closeReleaseOverlay() {
    if (!state.overlay) return;
    state.overlay.style.display = "none";
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

  function populateDiffSideSelect(selectEl, snapshots, releasesByName, selectedValue) {
    selectEl.innerHTML = "";
    const currentOpt = document.createElement("option");
    currentOpt.value = DIFF_CURRENT_VALUE;
    currentOpt.textContent = "Ist-Zustand (aktuell)";
    if (!selectedValue || selectedValue === DIFF_CURRENT_VALUE) currentOpt.selected = true;
    selectEl.appendChild(currentOpt);

    (snapshots || []).forEach(function (snap) {
      const info = snapshotReleaseInfo(snap, releasesByName);
      const opt = document.createElement("option");
      opt.value = String(snap.name || "");
      const dt = formatSnapshotDate(snap);
      opt.textContent = (snap.name || "?") + " — " + dt;
      if (info.localOnly) {
        opt.textContent += " (nur lokal — Snapshot in Cognigy gelöscht)";
      } else if (!info.ok) {
        opt.textContent += " (" + info.reason + ")";
        opt.disabled = true;
      }
      if (selectedValue && opt.value === selectedValue) opt.selected = true;
      selectEl.appendChild(opt);
    });

    if (selectedValue && selectedValue !== DIFF_CURRENT_VALUE) {
      const hasSelected = Array.prototype.some.call(selectEl.options, function (o) {
        return o.value === selectedValue && o.selected;
      });
      if (!hasSelected) currentOpt.selected = true;
    }
  }

  function findSnapshotByName(snapshots, name) {
    return (snapshots || []).find(function (s) {
      return String(s.name || "") === String(name || "");
    });
  }

  function snapshotConfirmPhrase(name) {
    return "snapshot/" + String(name || "");
  }

  function releaseConfirmPhrase(name) {
    return "release/" + String(name || "");
  }

  function showTypedConfirmDialog(opts) {
    const o = opts || {};
    const phrase = String(o.phrase || "");
    return new Promise(function (resolve) {
      const overlay = el("div", "ccp-rel-confirm-overlay");
      overlay.setAttribute("data-ccp-typed-confirm", "1");
      const card = el("div", "ccp-rel-confirm-card");
      const title = el("h3", "ccp-rel-confirm-title", o.title || "Bestätigen");
      const text = el("p", "ccp-rel-confirm-text", o.message || "Gib zur Bestätigung exakt Folgendes ein:");
      const phraseEl = el("code", "ccp-rel-confirm-phrase", phrase);
      const input = el("input", "ccp-rel-input");
      input.type = "text";
      input.placeholder = phrase;
      input.autocomplete = "off";
      input.spellcheck = false;
      const errEl = el("div", "ccp-rel-confirm-err");
      const actions = el("div", "ccp-rel-confirm-actions");
      const cancelBtn = el("button", "ccp-rel-btn", "Abbrechen");
      const confirmBtn = el("button", "ccp-rel-btn ccp-rel-btn-danger", o.confirmLabel || "Löschen");
      cancelBtn.type = "button";
      confirmBtn.type = "button";
      confirmBtn.disabled = true;

      function close(result) {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(!!result);
      }

      function onKey(ev) {
        if (ev.key === "Escape") close(false);
      }

      function syncConfirmBtn() {
        confirmBtn.disabled = input.value !== phrase;
        errEl.textContent = "";
      }

      input.addEventListener("input", syncConfirmBtn);
      cancelBtn.addEventListener("click", function () {
        close(false);
      });
      confirmBtn.addEventListener("click", function () {
        if (input.value !== phrase) {
          errEl.textContent = "Die Eingabe stimmt nicht überein.";
          return;
        }
        close(true);
      });
      overlay.addEventListener("click", function (ev) {
        if (ev.target === overlay) close(false);
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      card.appendChild(title);
      card.appendChild(text);
      card.appendChild(phraseEl);
      card.appendChild(input);
      card.appendChild(errEl);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.documentElement.appendChild(overlay);
      document.addEventListener("keydown", onKey);
      input.focus();
    });
  }

  async function loadReleaseManageData() {
    const projectId = CCP.namingApi.getProjectId();
    let cognigySnapshots = [];
    try {
      cognigySnapshots = await CCP.release.api.listSnapshots(projectId);
    } catch (e) {
      console.warn("[CCP release-ui] loadReleaseManageData listSnapshots failed", e);
    }
    const releases = await CCP.release.loadAllReleases();
    const releasesByName = {};
    (releases || []).forEach(function (r) {
      if (r && r.release_name) releasesByName[String(r.release_name)] = r;
    });
    return {
      projectId: projectId,
      snapshots: mergeSnapshotsWithLocalReleases(cognigySnapshots, releasesByName),
      releasesByName: releasesByName,
      storedReleaseNames: await CCP.release.listReleaseNames(),
    };
  }

  function syncReleaseDataToContexts(data) {
    if (!data) return;
    if (state.releasesByName) {
      state.storedReleaseNames = data.storedReleaseNames || state.storedReleaseNames;
      syncDiffViewerSelections(state, data);
    }
    if (diffViewerState.snapshots) {
      syncDiffViewerSelections(diffViewerState, data);
    }
  }

  function releaseManageItemMeta(snap, releasesByName) {
    const name = String((snap && snap.name) || "");
    const info = snapshotReleaseInfo(snap, releasesByName);
    const parts = [];
    if (snap && snap.localOnly) parts.push(formatSnapshotDate(snap));
    else parts.push(formatSnapshotDate(snap));
    if (info.localOnly) parts.push("Nur lokal — Snapshot in Cognigy gelöscht");
    else if (snap && (snap._id || snap.id)) parts.push("Snapshot in Cognigy");
    else parts.push("Kein Snapshot in Cognigy");
    if (info.ok) parts.push("Lokaler Release vorhanden");
    else parts.push("Kein lokaler Release");
    return parts.join(" · ");
  }

  function showDeleteError(row, err) {
    if (!row) return;
    const main = row.querySelector(".ccp-rel-cleanup-item-main") || row;
    let errNote = row.querySelector("[data-ccp-cleanup-err]");
    if (!errNote) {
      errNote = el("div", "ccp-rel-cleanup-err");
      errNote.setAttribute("data-ccp-cleanup-err", "1");
      main.appendChild(errNote);
    }
    const formatted =
      CCP.formatApiError && typeof CCP.formatApiError === "function"
        ? CCP.formatApiError(err)
        : { title: err instanceof Error ? err.message : String(err), body: "" };
    errNote.textContent = formatted.body || formatted.title;
  }

  async function confirmAndDeleteSnapshotOnly(snap) {
    const name = String((snap && snap.name) || "");
    const snapId = snap && (snap._id || snap.id);
    if (!snapId) {
      if (CCP.snackbar) {
        CCP.snackbar.info("Kein Snapshot", "In Cognigy ist kein Snapshot vorhanden.");
      }
      return false;
    }
    const confirmed = await showTypedConfirmDialog({
      title: "Snapshot löschen",
      message:
        'Der Snapshot "' + name + '" wird in Cognigy gelöscht. Gib zur Bestätigung exakt Folgendes ein:',
      phrase: snapshotConfirmPhrase(name),
      confirmLabel: "Snapshot löschen",
    });
    if (!confirmed) return false;
    await CCP.release.api.waitForDeleteSnapshot(snapId);
    return true;
  }

  async function confirmAndDeleteSnapshotAndRelease(snap, releasesByName) {
    const name = String((snap && snap.name) || "");
    const snapId = snap && (snap._id || snap.id);
    const hasLocal = !!(releasesByName && releasesByName[name]);
    if (!snapId && !hasLocal) {
      if (CCP.snackbar) CCP.snackbar.info("Nichts zu löschen");
      return false;
    }
    const confirmed = await showTypedConfirmDialog({
      title: snapId ? "Snapshot und Release löschen" : "Release löschen",
      message:
        (snapId
          ? 'Snapshot "' + name + '" und der lokale Release werden gelöscht.'
          : 'Der lokale Release "' + name + '" wird gelöscht.') + " Gib zur Bestätigung exakt Folgendes ein:",
      phrase: releaseConfirmPhrase(name),
      confirmLabel: snapId ? "Snapshot und Release löschen" : "Release löschen",
    });
    if (!confirmed) return false;
    if (snapId) await CCP.release.api.waitForDeleteSnapshot(snapId);
    if (hasLocal) await CCP.release.delete(name);
    return true;
  }

  function renderReleaseManageList(listEl, snapshots, releasesByName, onMutate, endpointIndex) {
    listEl.innerHTML = "";
    if (!snapshots.length) {
      listEl.appendChild(el("div", "ccp-rel-cleanup-item-meta", "Keine Releases oder Snapshots vorhanden."));
      return;
    }
    const se = CCP.release && CCP.release.snapshotEndpoints;
    snapshots.forEach(function (snap) {
      const snapName = String(snap.name || "?");
      const snapId = snap._id || snap.id;
      const localRelease = releasesByName[snapName];
      const row = el("div", "ccp-rel-cleanup-item");
      const main = el("div", "ccp-rel-cleanup-item-main");
      const nameRow = el("div", "ccp-rel-cleanup-item-name-row");
      nameRow.appendChild(el("div", "ccp-rel-cleanup-item-name", snapName));
      if (se && snapId && endpointIndex) {
        const chip = se.createEndpointChip(se.getEndpointNamesForSnapshot(endpointIndex, snapId));
        if (chip) nameRow.appendChild(chip);
      }
      main.appendChild(nameRow);
      main.appendChild(el("div", "ccp-rel-cleanup-item-meta", releaseManageItemMeta(snap, releasesByName)));
      const actions = el("div", "ccp-rel-cleanup-item-actions");
      const delSnapBtn = el("button", "ccp-rel-btn", "Delete Only Snapshot");
      const delBothBtn = el("button", "ccp-rel-btn ccp-rel-btn-danger", "Delete Snapshot and Release");
      delSnapBtn.type = "button";
      delBothBtn.type = "button";
      if (!snapId) delSnapBtn.disabled = true;
      if (!localRelease) delBothBtn.disabled = true;

      delSnapBtn.addEventListener("click", function () {
        void (async function () {
          delSnapBtn.disabled = true;
          delBothBtn.disabled = true;
          const prev = delSnapBtn.textContent;
          delSnapBtn.textContent = "Löschen…";
          try {
            const ok = await confirmAndDeleteSnapshotOnly(snap);
            if (ok && typeof onMutate === "function") await onMutate();
            else {
              delSnapBtn.disabled = !snapId;
              delBothBtn.disabled = !localRelease;
            }
          } catch (e) {
            if (CCP.snackbar) CCP.pushApiError(CCP.snackbar.error, e);
            showDeleteError(row, e);
            delSnapBtn.disabled = !snapId;
            delBothBtn.disabled = !localRelease;
          } finally {
            delSnapBtn.textContent = prev;
          }
        })();
      });

      delBothBtn.addEventListener("click", function () {
        void (async function () {
          delSnapBtn.disabled = true;
          delBothBtn.disabled = true;
          const prev = delBothBtn.textContent;
          delBothBtn.textContent = "Löschen…";
          try {
            const ok = await confirmAndDeleteSnapshotAndRelease(snap, releasesByName);
            if (ok && typeof onMutate === "function") await onMutate();
            else {
              delSnapBtn.disabled = !snapId;
              delBothBtn.disabled = !localRelease;
            }
          } catch (e) {
            if (CCP.snackbar) CCP.pushApiError(CCP.snackbar.error, e);
            showDeleteError(row, e);
            delSnapBtn.disabled = !snapId;
            delBothBtn.disabled = !localRelease;
          } finally {
            delBothBtn.textContent = prev;
          }
        })();
      });

      actions.appendChild(delSnapBtn);
      actions.appendChild(delBothBtn);
      row.appendChild(main);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  ui.closeReleaseManageOverlay = function closeReleaseManageOverlay(result) {
    if (state.manageOverlay && state.manageOverlay._escHandler) {
      document.removeEventListener("keydown", state.manageOverlay._escHandler);
    }
    if (state.manageOverlay) {
      if (typeof state.manageOverlay._resolve === "function") {
        const resolve = state.manageOverlay._resolve;
        state.manageOverlay._resolve = null;
        resolve(result);
      }
      state.manageOverlay.remove();
      state.manageOverlay = null;
    }
  };

  ui.openReleaseManageOverlay = async function openReleaseManageOverlay(opts) {
    const o = opts || {};
    if (state.manageOverlay) return o.mode === "build-cleanup" ? false : undefined;
    ensureStyles();

    let data = await loadReleaseManageData();
    let endpointIndex = { bySnapshotId: {}, bySnapshotName: {} };
    const projectId = CCP.namingApi && CCP.namingApi.getProjectId ? CCP.namingApi.getProjectId() : "";
    const se = CCP.release && CCP.release.snapshotEndpoints;
    if (se && projectId) {
      try {
        endpointIndex = await se.fetchSnapshotEndpointIndex(projectId);
      } catch (e) {
        console.warn("[CCP release-ui] fetchSnapshotEndpointIndex failed", e);
      }
    }
    const isBuildCleanup = o.mode === "build-cleanup";

    return new Promise(function (resolve) {
      const overlay = el("div", "ccp-rel-overlay ccp-rel-manage-overlay");
      overlay.setAttribute("data-ccp-release-manage", "1");

      const header = el("div", "ccp-rel-header");
      header.appendChild(el("div", "ccp-rel-title", "Releases & Snapshots"));
      const closeBtn = el("button", "ccp-rel-icon-btn", isBuildCleanup ? "✕" : "−");
      closeBtn.type = "button";
      closeBtn.title = isBuildCleanup ? "Abbrechen" : "Schließen";
      closeBtn.addEventListener("click", function () {
        ui.closeReleaseManageOverlay(isBuildCleanup ? false : undefined);
        if (typeof o.onClose === "function") o.onClose();
      });
      header.appendChild(closeBtn);
      overlay.appendChild(header);

      const body = el("div", "ccp-rel-body ccp-rel-manage-body");
      const inner = el("div", "ccp-rel-manage-list");

      if (isBuildCleanup) {
        const cognigyCount = data.snapshots.filter(function (s) {
          return !!(s._id || s.id);
        }).length;
        inner.appendChild(
          el(
            "div",
            "ccp-rel-warn ccp-rel-cleanup-info",
            "In Cognigy sind bereits " +
              cognigyCount +
              " Snapshots vorhanden. In manchen Setups gilt ein Limit von 10 Snapshots pro Projekt — dann müsstest du alte Snapshots löschen, bevor ein neuer erstellt werden kann. Je nach Cognigy-Konfiguration sind aber auch mehr als 10 Snapshots möglich. Das Aufräumen ist daher optional: Du kannst beliebig viele Einträge löschen oder direkt mit dem Build fortfahren."
          )
        );
      }

      const listEl = el("div", "ccp-rel-cleanup-list");
      inner.appendChild(listEl);
      body.appendChild(inner);
      overlay.appendChild(body);

      async function mutateList() {
        data = await loadReleaseManageData();
        syncReleaseDataToContexts(data);
        renderReleaseManageList(listEl, data.snapshots, data.releasesByName, mutateList, endpointIndex);
        if (typeof o.onDataChange === "function") o.onDataChange(data);
        const annotatePanel = state.overlay && state.overlay.querySelector('[data-tab-panel="annotate"]');
        if (annotatePanel && state.tabsRendered && state.tabsRendered.annotate) {
          const refs = collectDiffViewerRefs(annotatePanel);
          if (refs && refs.oldSelect) refreshDiffViewerUi(state, refs);
        }
        if (diffViewerState.overlay) {
          const refs = collectDiffViewerRefs(diffViewerState.overlay);
          if (refs && refs.oldSelect) refreshDiffViewerUi(diffViewerState, refs);
        }
      }

      renderReleaseManageList(listEl, data.snapshots, data.releasesByName, mutateList, endpointIndex);

      if (isBuildCleanup) {
        const footer = el("div", "ccp-rel-cleanup-footer");
        footer.style.padding = "14px 18px";
        footer.style.borderTop = "1px solid rgba(255,255,255,0.08)";
        const cancelBtn = el("button", "ccp-rel-btn", "Abbrechen");
        const buildBtn = el("button", "ccp-rel-btn ccp-rel-btn-primary", "Build Snapshot");
        cancelBtn.type = "button";
        buildBtn.type = "button";
        cancelBtn.addEventListener("click", function () {
          ui.closeReleaseManageOverlay(false);
        });
        buildBtn.addEventListener("click", function () {
          ui.closeReleaseManageOverlay(true);
        });
        footer.appendChild(cancelBtn);
        footer.appendChild(buildBtn);
        overlay.appendChild(footer);
        overlay._resolve = resolve;
      } else {
        overlay._resolve = null;
        resolve(undefined);
      }

      overlay._escHandler = function (ev) {
        if (ev.key === "Escape") {
          ui.closeReleaseManageOverlay(isBuildCleanup ? false : undefined);
        }
      };
      document.addEventListener("keydown", overlay._escHandler);

      state.manageOverlay = overlay;
      document.documentElement.appendChild(overlay);
    });
  };

  function collectDiffViewerRefs(rootEl) {
    if (!rootEl) return null;
    return {
      oldSelect: rootEl.querySelector(".ccp-rel-snap-select-old"),
      newSelect: rootEl.querySelector(".ccp-rel-snap-select-new"),
      oldGearBtn: rootEl.querySelector(
        ".ccp-rel-diff-side-toolbar:not(.ccp-rel-diff-side-toolbar-new) .ccp-rel-snap-gear"
      ),
      newGearBtn: rootEl.querySelector(".ccp-rel-diff-side-toolbar-new .ccp-rel-snap-gear"),
      flowList: rootEl.querySelector(".ccp-rel-flow-list"),
      diffHost: rootEl.querySelector(".ccp-rel-diff-main-editor"),
      searchInput: rootEl.querySelector(".ccp-rel-diff-search-input"),
      searchRegexBtn: rootEl.querySelector(".ccp-rel-diff-search-regex"),
      searchCounts: rootEl.querySelector(".ccp-rel-diff-search-counts"),
    };
  }

  function refreshDiffViewerUi(ctx, refs) {
    populateDiffSideSelect(refs.oldSelect, ctx.snapshots, ctx.releasesByName, ctx.selectedOldSide);
    populateDiffSideSelect(refs.newSelect, ctx.snapshots, ctx.releasesByName, ctx.selectedNewSide);
    refreshDiffSearch(ctx, refs);
    updateDiffEditorModels(ctx, refs.diffHost);
  }

  ui.closeDiffViewerOverlay = function closeDiffViewerOverlay() {
    if (diffViewerState.escHandler) {
      document.removeEventListener("keydown", diffViewerState.escHandler);
      diffViewerState.escHandler = null;
    }
    clearSearchDecorations(diffViewerState);
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
    ctx.searchQuery = "";
    ctx.searchUseRegex = false;
    ctx.searchError = "";
    ctx.searchHits = null;
    ctx.searchDecoIds = { original: [], modified: [], single: [] };
    applyDiffDefaults(ctx);

    try {
      const loaded = await loadDiffViewerContext();
      ctx.snapshots = loaded.snapshots;
      ctx.releasesByName = loaded.releasesByName;
      ctx.currentFlows = loaded.currentFlows;
      applyDiffDefaults(ctx);
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
    const tools = el("div", "ccp-fc-integrity-head-tools");
    const manageGear = el("button", "ccp-rel-fab-gear", "⚙");
    manageGear.type = "button";
    manageGear.title = "Releases & Snapshots verwalten";
    manageGear.addEventListener("click", function (ev) {
      ev.stopPropagation();
      void ui.openReleaseManageOverlay();
    });
    tools.appendChild(manageGear);
    if (FEATURES.settings) {
      const gear = el("button", "ccp-rel-fab-gear", "⚙");
      gear.type = "button";
      gear.title = "Einstellungen";
      gear.addEventListener("click", function (ev) {
        ev.stopPropagation();
        ui.openSettings();
      });
      tools.appendChild(gear);
    }
    head.appendChild(tools);
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

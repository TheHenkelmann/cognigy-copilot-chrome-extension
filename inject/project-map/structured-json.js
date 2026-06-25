/**
 * Cognigy Project-Map — structured (execution-order) JSON builder.
 *
 * 1:1 JS port of `cognigy_copilot_code/cognigy_to_structured_json.py`'s
 * `CognigyFlowNodesInExecutionOrder`. Builds a hierarchical, execution-order
 * tree from the API flow-node dicts:
 *
 *   - The main spine starts at the unique `start` node, follows
 *     `next_node_id` to the unique `end` node.
 *   - Container nodes (`if`, `switch`, `once`, `optionalQuestion`,
 *     `llmPromptV2`, `triggerFunction`, extension containers) stay on the
 *     spine; their branches go under `children` (array of sub-trees, one
 *     per branch). Inside a branch head, `child_node_ids` are walked first
 *     (recursively), then the head's `next_node_id` spine.
 *   - Per-node config dicts are sparse-stripped (None/""/[]/False removed).
 *   - Sanitize keys (`analytics_label`, `locale_reference`, `mock`,
 *     `conversion_metadata`, `comment_color`, `reference_id`,
 *     `is_entry_point`, …) are removed; `next_node_id` /
 *     `child_node_ids` are stripped after the tree is built — the topology
 *     lives entirely in spine order + `children`.
 *   - Unknown node types fall back to a generic emit with all `children`
 *     branches; the fallback is logged once via `console.warn`.
 *
 * The Chrome extension intercepts raw Cognigy REST responses, which use
 * camelCase. The Python helpers used snake_case. This port reads BOTH on
 * input and emits both spellings on output (we keep whatever was in the
 * raw API response after stripping the sanitize/edge/strip keys).
 */
(function ccpProjectMapStructuredJsonModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const pm = (CCP.projectMap = CCP.projectMap || {});

  if (pm.CognigyFlowNodesInExecutionOrder) {
    return;
  }

  const NO_CONFIG_STRUCTURE_TYPES = new Set([
    "then",
    "else",
    "llmpromptdefault",
    "once",
    "onfirstexecution",
    "afterwards",
    "start",
    "end",
    "onanswer",
    "onquestion",
    "onscheduled",
    "onschedulingerror",
    "stop",
    "default",
    "wait",
  ]);

  const SANITIZE_KEYS = new Set([
    "analytics_label",
    "analyticsLabel",
    "locale_reference",
    "localeReference",
    "mock",
    "conversion_metadata",
    "conversionMetadata",
    "comment_color",
    "commentColor",
  ]);

  const EDGE_KEYS = new Set(["next_node_id", "nextNodeId", "child_node_ids", "childNodeIds"]);

  const STRIP_NODE_KEYS = new Set(["reference_id", "referenceId"]);

  const BUILTIN_KNOWN_TYPES = new Set([
    "say",
    "question",
    "if",
    "then",
    "else",
    "goTo",
    "executeFlow",
    "switch",
    "case",
    "default",
    "once",
    "onFirstExecution",
    "afterwards",
    "optionalQuestion",
    "onQuestion",
    "onAnswer",
    "llmPromptV2",
    "llmPromptDefault",
    "llmPromptTool",
    "aiAgentToolAnswer",
    "stop",
    "wait",
    "addToContext",
    "placeholder",
    "debugMessage",
    "removeFromContext",
    "sleep",
    "checkAgentAvailability",
    "emailNotification",
    "sendEmail",
    "handoverToAgent",
    "code",
    "httpRequest",
    "triggerFunction",
    "onScheduled",
    "onSchedulingError",
  ]);

  const BUILTIN_STANDALONE_TYPES = new Set([
    "say",
    "question",
    "if",
    "goTo",
    "executeFlow",
    "switch",
    "once",
    "optionalQuestion",
    "llmPromptV2",
    "aiAgentToolAnswer",
    "stop",
    "wait",
    "addToContext",
    "placeholder",
    "debugMessage",
    "removeFromContext",
    "sleep",
    "checkAgentAvailability",
    "emailNotification",
    "sendEmail",
    "handoverToAgent",
    "code",
    "httpRequest",
    "triggerFunction",
  ]);

  function deepCopy(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(deepCopy);
    const out = {};
    Object.keys(v).forEach(function (k) {
      out[k] = deepCopy(v[k]);
    });
    return out;
  }

  function idOf(n) {
    if (!n || typeof n !== "object") return "";
    return String(n.id || n._id || "");
  }
  function typeOf(n) {
    if (!n || typeof n !== "object") return "";
    return String(n.type || "");
  }
  function nextNodeIdOf(n) {
    if (!n || typeof n !== "object") return null;
    return n.next_node_id !== undefined ? n.next_node_id : n.nextNodeId;
  }
  function childNodeIdsOf(n) {
    if (!n || typeof n !== "object") return [];
    const v = n.child_node_ids !== undefined ? n.child_node_ids : n.childNodeIds;
    return Array.isArray(v) ? v : [];
  }
  function extensionOfRaw(n) {
    if (!n || typeof n !== "object") return "";
    return String(n.extension || "").trim();
  }
  function normalizeExtension(ext) {
    const e = String(ext || "").trim();
    if (!e || e.startsWith("@cognigy")) return "";
    return e;
  }

  function stripScalarForLlm(val) {
    if (val === null || val === undefined) return true;
    if (val === false) return true;
    if (typeof val === "string" && val.trim() === "") return true;
    if (Array.isArray(val) && val.length === 0) return true;
    return false;
  }

  function stripSparseConfigDict(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return {};
    const keys = Object.keys(d);
    if (!keys.length) return {};
    if (keys.length === 1) {
      const k = keys[0];
      const v = d[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const inner = stripSparseConfigDict(v);
        if (!Object.keys(inner).length) return {};
        const out = {};
        out[k] = inner;
        return out;
      }
      if (stripScalarForLlm(v)) return {};
      const out = {};
      out[k] = v;
      return out;
    }
    const out = {};
    keys.forEach(function (k) {
      const v = d[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const inner = stripSparseConfigDict(v);
        if (Object.keys(inner).length) out[k] = inner;
      } else if (Array.isArray(v)) {
        if (!stripScalarForLlm(v)) out[k] = v;
      } else if (!stripScalarForLlm(v)) {
        out[k] = v;
      }
    });
    return out;
  }

  /**
   * Convert flow nodes (raw API dicts) into a structured execution-order
   * tree. `extensionSpecs` may be a Map keyed by `extension + "\x00" + type`
   * (the same shape the project-map uses internally) or an Array of specs.
   */
  function CognigyFlowNodesInExecutionOrder(opts) {
    const options = opts || {};
    this.nodes = Array.isArray(options.nodes) ? options.nodes : [];
    this._flowContext = String(options.flowContext || "").trim() || "(flow context not set)";
    this._silenceWarnings = Boolean(options.silenceUnknownNodeTypeWarnings);
    this.allowUnreachableNodes = Boolean(options.allowUnreachableNodes);
    this._unknownFallbackEvents = [];
    this._byId = new Map();
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const nid = idOf(n);
      if (nid) this._byId.set(nid, n);
    }
    this._visited = new Set();
    this._flowRefToId = options.flowReferenceToId || new Map();
    this._nodeRefToId = options.nodeReferenceToId || new Map();

    // extensionSpecs: Map keyed by "<extension>\x00<type>" (port of Python's
    // `(extension, type)` tuple). Each spec has at least: `.extension`,
    // `.type`, `.child_types`, `.parent_type`.
    let specs = options.extensionSpecs;
    if (specs instanceof Map) {
      this._extensionSpecs = specs;
    } else if (Array.isArray(specs)) {
      const m = new Map();
      specs.forEach(function (s) {
        if (!s) return;
        const key = String(s.extension || "") + "\x00" + String(s.type || "");
        m.set(key, s);
      });
      this._extensionSpecs = m;
    } else if (specs && typeof specs === "object") {
      this._extensionSpecs = new Map(Object.entries(specs));
    } else {
      this._extensionSpecs = new Map();
    }

    this._extensionSlotKeys = new Set();
    this._knownKeys = new Set();
    this._standaloneKeys = new Set();

    BUILTIN_KNOWN_TYPES.forEach(
      function (t) {
        this._knownKeys.add("" + "\x00" + t);
      }.bind(this)
    );
    BUILTIN_STANDALONE_TYPES.forEach(
      function (t) {
        this._standaloneKeys.add("" + "\x00" + t);
      }.bind(this)
    );

    this._extensionSpecs.forEach(
      function (spec, key) {
        const parts = String(key).split("\x00");
        const extName = parts[0];
        const ntype = parts[1] || "";
        if (!extName) return; // skip ill-formed entries silently
        const parentType = spec && (spec.parent_type !== undefined ? spec.parent_type : spec.parentType);
        if (parentType !== undefined && parentType !== null && String(parentType) !== "") {
          this._extensionSlotKeys.add(key);
        }
        this._knownKeys.add(key);
        const ctypes = (spec && (spec.child_types || spec.childTypes)) || [];
        for (let i = 0; i < ctypes.length; i++) {
          this._knownKeys.add(extName + "\x00" + String(ctypes[i]));
        }
        if (parentType === undefined || parentType === null || String(parentType) === "") {
          this._standaloneKeys.add(key);
        }
      }.bind(this)
    );
  }

  CognigyFlowNodesInExecutionOrder.prototype._nodeKey = function (node) {
    return normalizeExtension(node && node.extension) + "\x00" + (typeOf(node) || "");
  };

  CognigyFlowNodesInExecutionOrder.prototype._noteUnknownFallback = function (node, detail) {
    this._unknownFallbackEvents.push({
      node_id: idOf(node),
      type: typeOf(node),
      extension: extensionOfRaw(node),
      detail: detail,
    });
  };

  CognigyFlowNodesInExecutionOrder.prototype._flushUnknownFallbackWarnings = function () {
    if (this._silenceWarnings) return;
    if (!this._unknownFallbackEvents.length) return;
    const lines = [
      "Cognigy structured JSON — unbekannte / ambivalente Node-Typen (Fallback-Serialisierung)",
      "Flow: " + this._flowContext,
    ];
    for (let i = 0; i < this._unknownFallbackEvents.length; i++) {
      const ev = this._unknownFallbackEvents[i];
      lines.push(
        "  • node id='" + ev.node_id + "'  type='" + ev.type + "'  extension='" + ev.extension + "'"
      );
      lines.push("    → " + ev.detail);
    }
    console.warn(lines.join("\n"));
  };

  CognigyFlowNodesInExecutionOrder.prototype._sanitizeOutputNode = function (node) {
    if (!node || typeof node !== "object") return {};
    const out = {};
    Object.keys(node).forEach(function (k) {
      if (SANITIZE_KEYS.has(k)) return;
      if (EDGE_KEYS.has(k)) return;
      if (STRIP_NODE_KEYS.has(k)) return;
      out[k] = node[k];
    });
    // Drop entry-point / collapsed flags entirely.
    delete out.is_entry_point;
    delete out.isEntryPoint;
    delete out.is_collapsed;
    delete out.isCollapsed;

    const extRaw = String(out.extension || "").trim();
    if (extRaw.startsWith("@cognigy")) delete out.extension;

    const com = out.comment;
    if (com === null || com === undefined || (typeof com === "string" && com.trim() === "")) {
      delete out.comment;
    }

    const isDisabled = out.is_disabled === true || out.isDisabled === true;
    if (!isDisabled) {
      delete out.is_disabled;
      delete out.isDisabled;
    } else {
      delete out.isDisabled;
      out.is_disabled = true;
    }

    const ntypeL = (out.type || "").toString().toLowerCase();

    if (ntypeL === "code") {
      const cfg = out.config;
      if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
        out.config = "code" in cfg ? { code: cfg.code } : {};
      }
      return out;
    }

    if (ntypeL === "goto" || ntypeL === "executeflow") {
      const cfg = out.config;
      if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
        const cfgCopy = deepCopy(cfg);
        const fnRaw = cfgCopy.flow_node || cfgCopy.flowNode;
        if (fnRaw && typeof fnRaw === "object") {
          const nv = Object.assign({}, fnRaw);
          const fs = String(nv.flow || "").trim();
          const ns = String(nv.node || "").trim();
          if (fs && this._flowRefToId.get && this._flowRefToId.get(fs)) {
            nv.flow = this._flowRefToId.get(fs);
          } else if (fs && this._flowRefToId[fs]) {
            nv.flow = this._flowRefToId[fs];
          }
          if (ns && this._nodeRefToId.get && this._nodeRefToId.get(ns)) {
            nv.node = this._nodeRefToId.get(ns);
          } else if (ns && this._nodeRefToId[ns]) {
            nv.node = this._nodeRefToId[ns];
          }
          if ("flowNode" in cfgCopy && !("flow_node" in cfgCopy)) {
            cfgCopy.flowNode = nv;
            delete cfgCopy.flow_node;
          } else {
            cfgCopy.flow_node = nv;
            delete cfgCopy.flowNode;
          }
        }
        out.config = stripSparseConfigDict(cfgCopy);
      }
      return out;
    }

    const extKey = String((node.extension || "") + "").trim();
    const ntypeRaw = String(out.type || "");
    const slotKey = extKey + "\x00" + ntypeRaw;
    if (this._extensionSlotKeys.has(slotKey)) {
      delete out.config;
      return out;
    }

    if (NO_CONFIG_STRUCTURE_TYPES.has(ntypeL)) {
      const cfg = out.config;
      if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
        const cfg2 = stripSparseConfigDict(cfg);
        if (Object.keys(cfg2).length) out.config = cfg2;
        else delete out.config;
      }
      return out;
    }

    const cfg = out.config;
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
      const cfg2 = stripSparseConfigDict(cfg);
      if (Object.keys(cfg2).length) out.config = cfg2;
      else delete out.config;
    }
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._validateFlowTopology = function () {
    const starts = [];
    const ends = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const id = idOf(n);
      if (!id) continue;
      const t = (typeOf(n) || "").toLowerCase();
      if (t === "start") starts.push(id);
      if (t === "end") ends.push(id);
    }
    if (starts.length !== 1) {
      throw new Error(
        "Cognigy flow must have exactly one 'start' node, found " +
          starts.length +
          ": " +
          JSON.stringify(starts)
      );
    }
    if (ends.length !== 1) {
      throw new Error(
        "Cognigy flow must have exactly one 'end' node, found " + ends.length + ": " + JSON.stringify(ends)
      );
    }
    const endId = ends[0];
    let pointsToEnd = false;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (!idOf(n)) continue;
      if (String(nextNodeIdOf(n) || "") === endId) {
        pointsToEnd = true;
        break;
      }
    }
    if (!pointsToEnd) {
      throw new Error("No node has next_node_id pointing to the End node '" + endId + "'");
    }
    return starts[0];
  };

  CognigyFlowNodesInExecutionOrder.prototype._walkTree = function (nodeId) {
    const out = [];
    let cur = nodeId ? String(nodeId) : null;
    while (cur) {
      if (this._visited.has(cur)) return out;
      this._visited.add(cur);
      const node = this._byId.get(cur);
      if (!node) return out;
      const ntype = (typeOf(node) || "").toLowerCase();
      if (ntype === "end") {
        out.push(this._sanitizeOutputNode(node));
        return out;
      }
      if (ntype === "start") {
        const nxt = nextNodeIdOf(node);
        cur = nxt ? String(nxt) : null;
        continue;
      }
      out.push(this._emitNodeTree(node));
      const nxt = nextNodeIdOf(node);
      cur = nxt ? String(nxt) : null;
    }
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._branchHeadToTree = function (head) {
    const hid = idOf(head);
    if (hid && !this._visited.has(hid)) this._visited.add(hid);
    const headOut = this._sanitizeOutputNode(head);
    const branches = [];
    const cids = childNodeIdsOf(head);
    for (let i = 0; i < cids.length; i++) {
      branches.push(this._walkTree(String(cids[i])));
    }
    if (branches.length) headOut.children = branches;
    const tailNext = nextNodeIdOf(head);
    const tail = this._walkTree(tailNext ? String(tailNext) : null);
    return [headOut].concat(tail);
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitGenericChildBranches = function (node) {
    const out = this._sanitizeOutputNode(node);
    const cids = childNodeIdsOf(node);
    const branches = [];
    for (let i = 0; i < cids.length; i++) {
      const head = this._byId.get(String(cids[i]));
      if (!head) continue;
      branches.push(this._branchHeadToTree(head));
    }
    if (branches.length) out.children = branches;
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitUnknownNodeTree = function (node, detail) {
    this._noteUnknownFallback(node, detail);
    const cids = childNodeIdsOf(node);
    if (cids.length) return this._emitGenericChildBranches(node);
    return this._sanitizeOutputNode(node);
  };

  CognigyFlowNodesInExecutionOrder.prototype._pickChildren = function (node, expectedTypes, allowExtra) {
    const cids = childNodeIdsOf(node).map(String);
    const allowExtraLc = new Set(
      (allowExtra || []).map(function (t) {
        return String(t).toLowerCase();
      })
    );
    const expectedLc = expectedTypes.map(function (t) {
      return String(t).toLowerCase();
    });
    const byType = new Map();
    for (let i = 0; i < cids.length; i++) {
      const h = this._byId.get(cids[i]);
      if (!h) continue;
      const t = (typeOf(h) || "").toLowerCase();
      let bucket = byType.get(t);
      if (!bucket) {
        bucket = [];
        byType.set(t, bucket);
      }
      bucket.push(h);
    }
    const picked = [];
    for (let i = 0; i < expectedLc.length; i++) {
      const bucket = byType.get(expectedLc[i]) || [];
      if (!bucket.length) {
        picked.push(null);
        continue;
      }
      const head = bucket.shift();
      const hid = idOf(head);
      if (hid) this._visited.add(hid);
      picked.push(head);
    }
    byType.forEach(function (remaining, t) {
      if (!remaining.length) return;
      if (expectedLc.indexOf(t) !== -1 || allowExtraLc.has(t)) return;
      throw new Error(
        "Node '" +
          idOf(node) +
          "' (type='" +
          typeOf(node) +
          "') has unexpected child type '" +
          t +
          "'; expected one of: " +
          JSON.stringify(expectedTypes.concat(allowExtra || []))
      );
    });
    return picked;
  };

  CognigyFlowNodesInExecutionOrder.prototype._pickChildrenByKey = function (node, expectedKeys) {
    const cids = childNodeIdsOf(node).map(String);
    const byKey = new Map();
    for (let i = 0; i < cids.length; i++) {
      const h = this._byId.get(cids[i]);
      if (!h) continue;
      const k = this._nodeKey(h);
      let bucket = byKey.get(k);
      if (!bucket) {
        bucket = [];
        byKey.set(k, bucket);
      }
      bucket.push(h);
    }
    const picked = [];
    const expectedSet = new Set();
    for (let i = 0; i < expectedKeys.length; i++) {
      const ek = expectedKeys[i];
      const k = String(ek[0]) + "\x00" + String(ek[1]);
      expectedSet.add(k);
      const bucket = byKey.get(k) || [];
      if (!bucket.length) {
        picked.push(null);
        continue;
      }
      const head = bucket.shift();
      const hid = idOf(head);
      if (hid) this._visited.add(hid);
      picked.push(head);
    }
    byKey.forEach(function (remaining, k) {
      if (!remaining.length) return;
      if (expectedSet.has(k)) return;
      const parts = String(k).split("\x00");
      throw new Error(
        "Node '" +
          idOf(node) +
          "' (type='" +
          typeOf(node) +
          "') has unexpected child (extension='" +
          parts[0] +
          "', type='" +
          parts[1] +
          "'); expected one of: " +
          JSON.stringify(expectedKeys)
      );
    });
    return picked;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitIfTree = function (node) {
    const picked = this._pickChildren(node, ["then", "else"]);
    const thenHead = picked[0];
    const elseHead = picked[1];
    if (!thenHead || !elseHead) {
      throw new Error("If node '" + idOf(node) + "' is missing then/else child (both required).");
    }
    const out = this._sanitizeOutputNode(node);
    out.children = [this._branchHeadToTree(thenHead), this._branchHeadToTree(elseHead)];
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitSwitchTree = function (node) {
    const cids = childNodeIdsOf(node).map(String);
    let defaultHead = null;
    const caseHeads = [];
    for (let i = 0; i < cids.length; i++) {
      const h = this._byId.get(cids[i]);
      if (!h) continue;
      const t = (typeOf(h) || "").toLowerCase();
      if (t === "default") {
        if (defaultHead) {
          throw new Error("Switch node '" + idOf(node) + "' has more than one default child.");
        }
        defaultHead = h;
        const hid = idOf(h);
        if (hid) this._visited.add(hid);
      } else if (t === "case") {
        caseHeads.push(h);
        const hid = idOf(h);
        if (hid) this._visited.add(hid);
      } else {
        throw new Error(
          "Switch node '" + idOf(node) + "' has unexpected child type '" + t + "' (expected default/case)."
        );
      }
    }
    if (!defaultHead) {
      throw new Error("Switch node '" + idOf(node) + "' is missing its default child.");
    }
    const out = this._sanitizeOutputNode(node);
    out.children = [this._branchHeadToTree(defaultHead)].concat(
      caseHeads.map(
        function (h) {
          return this._branchHeadToTree(h);
        }.bind(this)
      )
    );
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitOnceTree = function (node) {
    const picked = this._pickChildren(node, ["onFirstExecution", "afterwards"]);
    const first = picked[0];
    const after = picked[1];
    if (!first || !after) {
      throw new Error("Once node '" + idOf(node) + "' is missing onFirstExecution/afterwards child.");
    }
    const out = this._sanitizeOutputNode(node);
    out.children = [this._branchHeadToTree(first), this._branchHeadToTree(after)];
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitOptionalQuestionTree = function (node) {
    const picked = this._pickChildren(node, ["onAnswer", "onQuestion"]);
    const ona = picked[0];
    const onq = picked[1];
    if (!ona || !onq) {
      throw new Error("optionalQuestion '" + idOf(node) + "' is missing onAnswer/onQuestion child.");
    }
    const out = this._sanitizeOutputNode(node);
    out.children = [this._branchHeadToTree(ona), this._branchHeadToTree(onq)];
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitLlmPromptV2Tree = function (node) {
    const cids = childNodeIdsOf(node).map(String);
    let defaultHead = null;
    const toolHeads = [];
    for (let i = 0; i < cids.length; i++) {
      const h = this._byId.get(cids[i]);
      if (!h) continue;
      const t = (typeOf(h) || "").toLowerCase();
      if (t === "llmpromptdefault") {
        if (defaultHead) {
          throw new Error("llmPromptV2 '" + idOf(node) + "' has more than one llmPromptDefault child.");
        }
        defaultHead = h;
        const hid = idOf(h);
        if (hid) this._visited.add(hid);
      } else if (t === "llmprompttool") {
        toolHeads.push(h);
        const hid = idOf(h);
        if (hid) this._visited.add(hid);
      } else {
        throw new Error(
          "llmPromptV2 '" +
            idOf(node) +
            "' has unexpected child type '" +
            t +
            "' (expected llmPromptDefault/llmPromptTool)."
        );
      }
    }
    if (!defaultHead) {
      throw new Error("llmPromptV2 '" + idOf(node) + "' is missing its llmPromptDefault child.");
    }
    const out = this._sanitizeOutputNode(node);
    out.children = [this._branchHeadToTree(defaultHead)].concat(
      toolHeads.map(
        function (h) {
          return this._branchHeadToTree(h);
        }.bind(this)
      )
    );
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitTriggerFunctionTree = function (node) {
    const picked = this._pickChildren(node, ["onScheduled", "onSchedulingError"]);
    const onScheduled = picked[0];
    const onError = picked[1];
    if (!onScheduled || !onError) {
      throw new Error(
        "triggerFunction '" + idOf(node) + "' is missing onScheduled/onSchedulingError child (both required)."
      );
    }
    const out = this._sanitizeOutputNode(node);
    out.children = [this._branchHeadToTree(onScheduled), this._branchHeadToTree(onError)];
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitCodeTree = function (node) {
    if (childNodeIdsOf(node).length) {
      throw new Error(
        "Code node '" + idOf(node) + "' has child_node_ids but code nodes have no API children."
      );
    }
    return this._sanitizeOutputNode(node);
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitExtensionContainerTree = function (node, spec) {
    const childTypes = (spec && (spec.child_types || spec.childTypes)) || [];
    if (!childTypes.length) {
      if (childNodeIdsOf(node).length) {
        throw new Error(
          "Extension node id='" +
            idOf(node) +
            "' (extension='" +
            (spec && spec.extension) +
            "', type='" +
            (spec && spec.type) +
            "') has child_node_ids but declares no child slots."
        );
      }
      return this._sanitizeOutputNode(node);
    }
    const expected = childTypes.map(function (t) {
      return [spec.extension, t];
    });
    const picked = this._pickChildrenByKey(node, expected);
    const missing = [];
    for (let i = 0; i < picked.length; i++) {
      if (picked[i] === null) missing.push(childTypes[i]);
    }
    if (missing.length) {
      throw new Error(
        "Extension node id='" +
          idOf(node) +
          "' (extension='" +
          spec.extension +
          "', type='" +
          spec.type +
          "') is missing required child slot(s): " +
          JSON.stringify(missing) +
          "."
      );
    }
    const out = this._sanitizeOutputNode(node);
    out.children = picked.map(
      function (h) {
        return this._branchHeadToTree(h);
      }.bind(this)
    );
    return out;
  };

  CognigyFlowNodesInExecutionOrder.prototype._emitNodeTree = function (node) {
    const ntype = typeOf(node) || "";
    const ext = normalizeExtension(node && node.extension);
    const key = ext + "\x00" + ntype;
    if (!this._knownKeys.has(key)) {
      return this._emitUnknownNodeTree(
        node,
        "Type is neither built-in nor registered in extension_specs; generic fallback (config + optional children from child_node_ids)."
      );
    }
    if (!this._standaloneKeys.has(key)) {
      return this._emitUnknownNodeTree(
        node,
        "Node is only declared as a child-slot of a container but appears on the main spine; generic fallback as above."
      );
    }
    if (ext === "") {
      const handlers = {
        if: this._emitIfTree,
        switch: this._emitSwitchTree,
        once: this._emitOnceTree,
        optionalQuestion: this._emitOptionalQuestionTree,
        llmPromptV2: this._emitLlmPromptV2Tree,
        triggerFunction: this._emitTriggerFunctionTree,
        code: this._emitCodeTree,
      };
      const h = handlers[ntype];
      if (h) return h.call(this, node);
      return this._sanitizeOutputNode(node);
    }
    const spec = this._extensionSpecs.get(key);
    if (!spec) return this._sanitizeOutputNode(node);
    return this._emitExtensionContainerTree(node, spec);
  };

  CognigyFlowNodesInExecutionOrder.prototype.build = function () {
    this._visited = new Set();
    const startId = this._validateFlowTopology();
    const startNode = this._byId.get(startId);
    this._visited.add(startId);
    const nxt = nextNodeIdOf(startNode);
    const rest = this._walkTree(nxt ? String(nxt) : null);
    const allIds = new Set(this._byId.keys());
    const missing = [];
    allIds.forEach(
      function (id) {
        if (!this._visited.has(id)) missing.push(id);
      }.bind(this)
    );
    if (missing.length && !this.allowUnreachableNodes) {
      throw new Error(
        "Flow has nodes not reached by traversal from Start (orphan or disconnected): " +
          JSON.stringify(missing.sort())
      );
    }
    const tree = [this._sanitizeOutputNode(startNode)].concat(rest);
    if (missing.length && this.allowUnreachableNodes) {
      for (let i = 0; i < missing.length; i++) {
        const orphan = this._byId.get(missing[i]);
        if (orphan) tree.push(this._sanitizeOutputNode(orphan));
      }
    }
    this._flushUnknownFallbackWarnings();
    return tree;
  };

  pm.CognigyFlowNodesInExecutionOrder = CognigyFlowNodesInExecutionOrder;
  pm.structuredJsonHelpers = {
    NO_CONFIG_STRUCTURE_TYPES,
    BUILTIN_KNOWN_TYPES,
    BUILTIN_STANDALONE_TYPES,
    stripSparseConfigDict,
    normalizeExtension,
  };
})();

/**
 * Cognigy Project-Map — issue detection.
 *
 * 1:1 JS port of the issue-detection helpers from
 * `cognigy_copilot_code/cognigy_project_map.py`. Every helper is a pure
 * function over plain objects so the project-map class can call them
 * directly without caring about API shape variants.
 *
 * The Python source talks the SDK's `model_dump()` shape (snake_case), but
 * the Chrome extension intercepts raw Cognigy REST responses (camelCase).
 * All helpers therefore look up both spellings (`node.id || node._id`,
 * `is_disabled || isDisabled`, etc.).
 *
 * Each issue object matches `CognigyFlowNodeIssue` in Python:
 *   { type, message, severity, flow?, node?, llm?, dead_node_ids? }
 *
 * The class wires the helpers together in `findFlowNodeIssues()` and
 * delivers them via the `issues-changed` event.
 */
(function ccpProjectMapIssuesModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  const pm = (CCP.projectMap = CCP.projectMap || {});

  if (pm.issues) {
    return;
  }

  const constants = pm.constants;
  if (!constants) {
    console.warn("[CCP project-map issues] node-constants module not loaded yet; constants required.");
    return;
  }

  const DEAD_PATH_TERMINATOR_TYPES = constants.DEAD_PATH_TERMINATOR_TYPES;
  const DEAD_PATH_GUARDED_TYPES = constants.DEAD_PATH_GUARDED_TYPES;
  const NODE_LLM_REFERENCE_FIELDS = constants.NODE_LLM_REFERENCE_FIELDS;
  const LLM_DEFAULT_TOKEN = constants.LLM_DEFAULT_TOKEN;
  const HTTP_AUTH_FIELD_BY_TYPE = constants.HTTP_AUTH_FIELD_BY_TYPE;

  // ---------------------------------------------------------------------
  // Shape adapters (`*Of(node)` → camelCase- and snake_case-compatible)
  // ---------------------------------------------------------------------

  function idOf(obj) {
    if (!obj || typeof obj !== "object") return "";
    return String(obj.id || obj._id || "");
  }

  function referenceIdOf(obj) {
    if (!obj || typeof obj !== "object") return "";
    return String(obj.reference_id || obj.referenceId || "");
  }

  function typeOf(obj) {
    if (!obj || typeof obj !== "object") return "";
    return String(obj.type || "");
  }

  function nameOf(obj) {
    if (!obj || typeof obj !== "object") return "";
    return String(obj.name || "");
  }

  function labelOf(node) {
    if (!node || typeof node !== "object") return "";
    return String(node.label || "");
  }

  function nextNodeIdOf(node) {
    if (!node || typeof node !== "object") return null;
    return node.next_node_id !== undefined ? node.next_node_id : node.nextNodeId;
  }

  function childNodeIdsOf(node) {
    if (!node || typeof node !== "object") return [];
    const v = node.child_node_ids !== undefined ? node.child_node_ids : node.childNodeIds;
    return Array.isArray(v) ? v : [];
  }

  function isDisabledOf(node) {
    if (!node || typeof node !== "object") return false;
    return Boolean(node.is_disabled || node.isDisabled);
  }

  function isDefaultOf(llm) {
    if (!llm || typeof llm !== "object") return false;
    return Boolean(llm.is_default || llm.isDefault);
  }

  function isDeprecatedOf(conn) {
    if (!conn || typeof conn !== "object") return false;
    return Boolean(conn.is_deprecated || conn.isDeprecated);
  }

  function resourceLevelOf(llm) {
    if (!llm || typeof llm !== "object") return "";
    return String(llm.resource_level || llm.resourceLevel || "");
  }

  function connectionIdOf(llm) {
    if (!llm || typeof llm !== "object") return "";
    return String(llm.connection_id || llm.connectionId || "");
  }

  function connectionTestOf(llm) {
    if (!llm || typeof llm !== "object") return null;
    const ct = llm.connection_test || llm.connectionTest;
    return ct && typeof ct === "object" ? ct : null;
  }

  function fallbacksOf(llm) {
    if (!llm || typeof llm !== "object") return [];
    const v = llm.fallbacks;
    return Array.isArray(v) ? v : [];
  }

  function isCredsValidOf(test) {
    if (!test || typeof test !== "object") return undefined;
    if ("is_credentials_valid" in test) return test.is_credentials_valid;
    if ("isCredentialsValid" in test) return test.isCredentialsValid;
    return undefined;
  }

  function msgErrOf(test) {
    if (!test || typeof test !== "object") return null;
    return test.msg_err !== undefined ? test.msg_err : test.msgErr;
  }

  function extensionOf(obj) {
    if (!obj || typeof obj !== "object") return "";
    return String(obj.extension || "");
  }

  // ---------------------------------------------------------------------
  // Lookup builders
  // ---------------------------------------------------------------------

  function nodesById(nodes) {
    const out = new Map();
    if (!Array.isArray(nodes)) return out;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n || typeof n !== "object") continue;
      const id = idOf(n);
      if (id) out.set(id, n);
    }
    return out;
  }

  function nodesByReferenceId(nodes) {
    const out = new Map();
    if (!Array.isArray(nodes)) return out;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n || typeof n !== "object") continue;
      const r = referenceIdOf(n);
      if (r) out.set(r, n);
    }
    return out;
  }

  function flowsByReferenceId(flows) {
    const out = new Map();
    if (!Array.isArray(flows)) return out;
    for (let i = 0; i < flows.length; i++) {
      const f = flows[i];
      if (!f || typeof f !== "object") continue;
      const r = referenceIdOf(f);
      if (r) out.set(r, f);
    }
    return out;
  }

  function nodeExtTypeKey(node) {
    const ext = extensionOf(node).trim();
    if (!ext || ext.startsWith("@cognigy")) return ["", typeOf(node)];
    return [ext, typeOf(node)];
  }

  // ---------------------------------------------------------------------
  // Tiny utilities
  // ---------------------------------------------------------------------

  function configOf(node) {
    if (!node || typeof node !== "object") return {};
    return node.config && typeof node.config === "object" ? node.config : {};
  }

  function configFlowNode(cfg) {
    if (!cfg || typeof cfg !== "object") return null;
    const fn = cfg.flow_node || cfg.flowNode;
    return fn && typeof fn === "object" ? fn : null;
  }

  function isBlankStr(v) {
    if (v === null || v === undefined) return true;
    if (typeof v !== "string") return true;
    return v.trim() === "";
  }

  function isValidJsonString(s) {
    if (typeof s !== "string") return false;
    if (s.trim() === "") return false;
    try {
      JSON.parse(s);
      return true;
    } catch (_) {
      return false;
    }
  }

  function configValueEmptyForRequired(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === "string" && val.trim() === "") return true;
    if (Array.isArray(val) && val.length === 0) return true;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val).length === 0;
    }
    return false;
  }

  function repr(s) {
    if (s === null || s === undefined) return "None";
    if (typeof s === "string") return "'" + s + "'";
    if (Array.isArray(s)) return "[" + s.map(repr).join(", ") + "]";
    return String(s);
  }

  function makeIssue(t, opts) {
    const o = opts || {};
    const issue = { type: t, severity: o.severity, message: o.message || null };
    if (o.flow) issue.flow = o.flow;
    if (o.node) issue.node = o.node;
    if (o.llm) issue.llm = o.llm;
    if (o.dead_node_ids) issue.dead_node_ids = o.dead_node_ids;
    if (o.fixable === true) issue.fixable = true;
    return issue;
  }

  // ---------------------------------------------------------------------
  // Adjacency + reachability (port of _flow_adjacency / _collect_reachable)
  // ---------------------------------------------------------------------

  function flowAdjacency(nodes) {
    const byId = nodesById(nodes);
    const adj = new Map();
    if (!Array.isArray(nodes)) return adj;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n || typeof n !== "object") continue;
      const sid = idOf(n);
      if (!sid) continue;
      const targets = [];
      const seen = new Set();
      const nxt = nextNodeIdOf(n);
      if (nxt) {
        const sn = String(nxt);
        if (byId.has(sn) && !seen.has(sn)) {
          targets.push(sn);
          seen.add(sn);
        }
      }
      const children = childNodeIdsOf(n);
      for (let j = 0; j < children.length; j++) {
        const c = children[j];
        if (!c) continue;
        const sc = String(c);
        if (byId.has(sc) && !seen.has(sc)) {
          targets.push(sc);
          seen.add(sc);
        }
      }
      adj.set(sid, targets);
    }
    return adj;
  }

  function collectReachable(adj, starts, terminators) {
    const reached = new Set();
    const stack = [];
    for (let i = 0; i < (starts || []).length; i++) {
      if (starts[i]) stack.push(String(starts[i]));
    }
    while (stack.length) {
      const nid = stack.pop();
      if (reached.has(nid)) continue;
      reached.add(nid);
      if (terminators && terminators.has(nid)) continue;
      const next = adj.get(nid) || [];
      for (let i = 0; i < next.length; i++) {
        const t = next[i];
        if (!reached.has(t)) stack.push(t);
      }
    }
    return reached;
  }

  // ---------------------------------------------------------------------
  // Dead-path issues (port of _dead_path_issues_for_flow)
  // ---------------------------------------------------------------------

  function deadPathIssuesForFlow(flow) {
    const nodes = (flow && flow.nodes) || [];
    if (!nodes.length) return [];
    const byId = nodesById(nodes);
    const adj = flowAdjacency(nodes);
    const starts = [];
    const terminators = new Set();
    const guarded = new Set();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n || typeof n !== "object") continue;
      const sid = idOf(n);
      if (!sid) continue;
      const t = typeOf(n);
      if (t === "start") starts.push(sid);
      if (DEAD_PATH_GUARDED_TYPES.has(t)) guarded.add(sid);
      if (DEAD_PATH_TERMINATOR_TYPES.has(t) && !isDisabledOf(n)) {
        terminators.add(sid);
      }
    }
    if (!starts.length || !terminators.size) return [];
    const effective = collectReachable(adj, starts, terminators);

    const issues = [];
    const activeTerminators = [];
    terminators.forEach(function (t) {
      if (effective.has(t)) activeTerminators.push(t);
    });
    activeTerminators.sort();

    for (let i = 0; i < activeTerminators.length; i++) {
      const tid = activeTerminators[i];
      const dead = new Set();
      const stack = (adj.get(tid) || []).slice();
      while (stack.length) {
        const nid = stack.pop();
        if (dead.has(nid) || effective.has(nid) || guarded.has(nid)) continue;
        dead.add(nid);
        const nxt = adj.get(nid) || [];
        for (let j = 0; j < nxt.length; j++) {
          if (!dead.has(nxt[j])) stack.push(nxt[j]);
        }
      }
      if (!dead.size) continue;
      const terminatorNode = byId.get(tid);
      if (!terminatorNode) continue;
      const label = labelOf(terminatorNode) || idOf(terminatorNode);
      const ntype = typeOf(terminatorNode);
      const deadIds = Array.from(dead).sort();
      issues.push(
        makeIssue("dead_path", {
          severity: 2,
          message:
            "Terminator " +
            repr(label) +
            " (" +
            ntype +
            ") makes " +
            dead.size +
            " downstream node(s) unreachable at runtime.",
          flow: flow,
          node: terminatorNode,
          dead_node_ids: deadIds,
        })
      );
    }
    return issues;
  }

  // ---------------------------------------------------------------------
  // Per-node builtin checks (port of _builtin_per_node_issues)
  // ---------------------------------------------------------------------

  function builtinPerNodeIssues(flow, node) {
    const issues = [];
    const cfg = configOf(node);
    const ntype = typeOf(node);

    if (ntype === "if") {
      const cond = cfg.condition && typeof cfg.condition === "object" ? cfg.condition : {};
      const rule = cond.rule && typeof cond.rule === "object" ? cond.rule : {};
      const condStrBlank = isBlankStr(cond.condition);
      const ruleBlank = isBlankStr(rule.left) && isBlankStr(rule.operand) && isBlankStr(rule.right);
      if (condStrBlank && ruleBlank) {
        issues.push(
          makeIssue("if_condition_empty", {
            severity: 2,
            message:
              "config.condition.condition is empty and config.condition.rule carries the default empty (left, operand, right) comparison.",
            flow: flow,
            node: node,
          })
        );
      }
    } else if (ntype === "say") {
      const say = cfg.say && typeof cfg.say === "object" ? cfg.say : {};
      const text = say.text;
      const textBlank =
        text === undefined ||
        text === null ||
        (Array.isArray(text) && text.every(isBlankStr)) ||
        (typeof text === "string" && isBlankStr(text));
      const dataBlank = isBlankStr(say.data);
      const cog = say._cognigy;
      const cogBlank =
        cog === undefined ||
        cog === null ||
        (cog && typeof cog === "object" && Object.keys(cog).length === 0);
      if (textBlank && dataBlank && cogBlank) {
        issues.push(
          makeIssue("say_node_empty_payload", {
            severity: 2,
            message:
              "config.say has no text, no data, and no channel-specific _cognigy payload — the say node would output nothing.",
            flow: flow,
            node: node,
          })
        );
      }
    } else if (ntype === "code") {
      if (!isDisabledOf(node) && isBlankStr(cfg.code)) {
        issues.push(
          makeIssue("code_node_empty", {
            severity: 2,
            message: "config.code is missing, null, or only whitespace.",
            flow: flow,
            node: node,
          })
        );
      }
    } else if (ntype === "addToContext") {
      if (isBlankStr(cfg.key)) {
        issues.push(
          makeIssue("add_to_context_missing_key", {
            severity: 3,
            message: "config.key is missing, null, or only whitespace.",
            flow: flow,
            node: node,
          })
        );
      }
    } else if (ntype === "removeFromContext") {
      if (isBlankStr(cfg.key)) {
        issues.push(
          makeIssue("remove_from_context_missing_key", {
            severity: 3,
            message: "config.key is missing, null, or only whitespace.",
            flow: flow,
            node: node,
          })
        );
      }
    } else if (ntype === "httpRequest") {
      if (isBlankStr(cfg.url)) {
        issues.push(
          makeIssue("http_request_missing_url", {
            severity: 3,
            message: "config.url is missing, null, or only whitespace.",
            flow: flow,
            node: node,
          })
        );
      }
      const payloadType = String(cfg.payloadType || "")
        .trim()
        .toLowerCase();
      if (payloadType === "json" && !isValidJsonString(cfg.payloadJSON)) {
        issues.push(
          makeIssue("http_request_invalid_payload_json", {
            severity: 3,
            message: "config.payloadType is 'json' but config.payloadJSON is empty or not parseable as JSON.",
            flow: flow,
            node: node,
          })
        );
      }
      const headers = cfg.headers;
      if (typeof headers === "string" && headers.trim() !== "" && !isValidJsonString(headers)) {
        issues.push(
          makeIssue("http_request_invalid_headers_json", {
            severity: 3,
            message: "config.headers is set but not parseable as JSON.",
            flow: flow,
            node: node,
          })
        );
      }
      const authType = String(cfg.authType || "")
        .trim()
        .toLowerCase();
      const authField = HTTP_AUTH_FIELD_BY_TYPE[authType];
      if (authField && isBlankStr(cfg[authField])) {
        issues.push(
          makeIssue("http_request_missing_auth_connection", {
            severity: 3,
            message:
              "config.authType=" +
              repr(authType) +
              " requires config." +
              authField +
              ", but the connection reference is empty.",
            flow: flow,
            node: node,
          })
        );
      }
    } else if (ntype === "triggerFunction") {
      const params = cfg.parameters;
      if (typeof params === "string" && params.trim() !== "" && !isValidJsonString(params)) {
        issues.push(
          makeIssue("trigger_function_invalid_parameters_json", {
            severity: 3,
            message: "config.parameters is set but not parseable as JSON.",
            flow: flow,
            node: node,
          })
        );
      }
    }
    return issues;
  }

  // ---------------------------------------------------------------------
  // Switch duplicate-case checks (port of _switch_duplicate_case_issues)
  // ---------------------------------------------------------------------

  function switchDuplicateCaseIssues(flow, switchNode, byId) {
    const cids = childNodeIdsOf(switchNode).map(function (c) {
      return String(c);
    });
    const byValue = new Map();
    for (let i = 0; i < cids.length; i++) {
      const child = byId.get(cids[i]);
      if (!child || typeof child !== "object") continue;
      if (typeOf(child) !== "case") continue;
      const cfg = configOf(child);
      const caseObj = cfg.case && typeof cfg.case === "object" ? cfg.case : {};
      const value = caseObj.value;
      if (value === null || value === undefined) continue;
      const k = String(value);
      let bucket = byValue.get(k);
      if (!bucket) {
        bucket = [];
        byValue.set(k, bucket);
      }
      bucket.push(child);
    }
    const issues = [];
    byValue.forEach(function (dupes, value) {
      if (dupes.length < 2) return;
      const ids = dupes.map(function (d) {
        return idOf(d);
      });
      issues.push(
        makeIssue("switch_duplicate_case_value", {
          severity: 2,
          message:
            "Switch has " +
            dupes.length +
            " case children with the same value " +
            repr(value) +
            "; only the first will ever match (case ids: " +
            repr(ids) +
            ").",
          flow: flow,
          node: switchNode,
        })
      );
    });
    return issues;
  }

  // ---------------------------------------------------------------------
  // Duplicate label checks (port of _duplicate_label_issues)
  // ---------------------------------------------------------------------

  function duplicateLabelIssues(flow) {
    const nodes = (flow && flow.nodes) || [];
    const byLabel = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n || typeof n !== "object") continue;
      const label = n.label;
      if (typeof label !== "string") continue;
      const norm = label.trim();
      if (!norm) continue;
      let bucket = byLabel.get(norm);
      if (!bucket) {
        bucket = [];
        byLabel.set(norm, bucket);
      }
      bucket.push(n);
    }
    const issues = [];
    byLabel.forEach(function (group, label) {
      if (group.length < 2) return;
      // Duplicates are only flagged when the shared label contains at least
      // one underscore — labels without an underscore are treated as plain
      // free-form names where duplicates are intentional.
      if (label.indexOf("_") < 0) return;
      const ids = group.map(function (g) {
        return idOf(g);
      });
      for (let i = 0; i < group.length; i++) {
        issues.push(
          makeIssue("duplicate_node_label_in_flow", {
            severity: 1,
            message:
              "Label " +
              repr(label) +
              " is used by " +
              group.length +
              " nodes in this flow (ids: " +
              repr(ids) +
              ").",
            flow: flow,
            node: group[i],
          })
        );
      }
    });
    return issues;
  }

  // ---------------------------------------------------------------------
  // Extension spec structure checks (port of _extension_spec_structure_issues)
  // ---------------------------------------------------------------------

  function extensionSpecFieldList(spec) {
    if (!spec || typeof spec !== "object") return [];
    const v = spec.fields;
    return Array.isArray(v) ? v : [];
  }

  function extensionSpecChildTypes(spec) {
    if (!spec || typeof spec !== "object") return [];
    const v = spec.child_types || spec.childTypes;
    return Array.isArray(v) ? v : [];
  }

  function extensionSpecExtension(spec) {
    return String((spec && spec.extension) || "");
  }

  function extensionSpecStructureIssues(flow, node, spec, byId) {
    const issues = [];
    const cfg = configOf(node);
    const fields = extensionSpecFieldList(spec);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field || typeof field !== "object") continue;
      const key = field.key;
      if (!key) continue;
      const params = field.params && typeof field.params === "object" ? field.params : {};
      if (!params.required) continue;
      if (!(key in cfg) || configValueEmptyForRequired(cfg[key])) {
        const label = String(field.label || "").trim();
        let msg = "Required extension config field " + repr(key) + " is missing or empty.";
        if (label) msg += " (" + label + ")";
        issues.push(
          makeIssue("extension_missing_required_config_field", {
            severity: 3,
            message: msg,
            flow: flow,
            node: node,
          })
        );
      }
    }

    const cids = childNodeIdsOf(node).map(function (c) {
      return String(c);
    });
    const childTypes = extensionSpecChildTypes(spec);
    const specExtension = extensionSpecExtension(spec);
    const expectedKeys = childTypes.map(function (t) {
      return [specExtension, String(t)];
    });

    if (!childTypes.length) {
      if (cids.length) {
        issues.push(
          makeIssue("extension_unexpected_child_slots", {
            severity: 2,
            message:
              "Flow node has child_node_ids but the extension type declares no child slots in the current API definition.",
            flow: flow,
            node: node,
          })
        );
      }
      return issues;
    }

    const byKey = new Map();
    for (let i = 0; i < cids.length; i++) {
      const head = byId.get(cids[i]);
      if (!head) continue;
      const key = nodeExtTypeKey(head);
      const k = key[0] + "\x00" + key[1];
      let bucket = byKey.get(k);
      if (!bucket) {
        bucket = [];
        byKey.set(k, bucket);
      }
      bucket.push(head);
    }

    const picked = [];
    for (let i = 0; i < expectedKeys.length; i++) {
      const ek = expectedKeys[i];
      const k = ek[0] + "\x00" + ek[1];
      const bucket = byKey.get(k) || [];
      if (!bucket.length) {
        picked.push(null);
      } else {
        picked.push(bucket.shift());
      }
    }

    for (let i = 0; i < picked.length; i++) {
      const head = picked[i];
      const ek = expectedKeys[i];
      if (head === null) {
        issues.push(
          makeIssue("extension_missing_child_slot", {
            severity: 2,
            message:
              "Missing child slot at position " +
              i +
              ": expected extension=" +
              repr(ek[0]) +
              ", type=" +
              repr(ek[1]) +
              ".",
            flow: flow,
            node: node,
          })
        );
      }
    }

    const expectedSet = new Set(
      expectedKeys.map(function (k) {
        return k[0] + "\x00" + k[1];
      })
    );
    byKey.forEach(function (remaining, k) {
      if (!remaining.length) return;
      const parts = k.split("\x00");
      const key = [parts[0], parts[1]];
      if (expectedSet.has(k)) {
        for (let i = 0; i < remaining.length; i++) {
          const extra = remaining[i];
          issues.push(
            makeIssue("extension_surplus_child_node", {
              severity: 2,
              message:
                "More child nodes of type extension=" +
                repr(key[0]) +
                ", type=" +
                repr(key[1]) +
                " than declared slots (surplus id=" +
                repr(idOf(extra)) +
                ").",
              flow: flow,
              node: node,
            })
          );
        }
        return;
      }
      issues.push(
        makeIssue("extension_unexpected_child_node", {
          severity: 2,
          message:
            "Unexpected child node(s) for this extension container: extension=" +
            repr(key[0]) +
            ", type=" +
            repr(key[1]) +
            " (not used by declared slots).",
          flow: flow,
          node: node,
        })
      );
    });

    return issues;
  }

  function childNodeIdSet(nodes) {
    const out = new Set();
    if (!Array.isArray(nodes)) return out;
    for (let i = 0; i < nodes.length; i++) {
      const cids = childNodeIdsOf(nodes[i]);
      for (let j = 0; j < cids.length; j++) {
        if (cids[j]) out.add(String(cids[j]));
      }
    }
    return out;
  }

  function forceChildConfigValue(cfg) {
    if (!cfg || typeof cfg !== "object") return { present: false, value: undefined };
    if ("forceChild" in cfg) return { present: true, value: cfg.forceChild };
    if ("force_child" in cfg) return { present: true, value: cfg.force_child };
    return { present: false, value: undefined };
  }

  function extensionForceChildIssues(flow, nodes) {
    const issues = [];
    const childIds = childNodeIdSet(nodes);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || typeof node !== "object") continue;
      const ext = extensionOf(node).trim();
      if (!ext || ext.startsWith("@cognigy")) continue;
      const nid = idOf(node);
      if (nid && childIds.has(nid)) continue;

      const fc = forceChildConfigValue(configOf(node));
      if (!fc.present) continue;
      if (fc.value === null || fc.value === undefined) continue;
      if (typeof fc.value === "string" && fc.value.trim().toLowerCase() === "none") {
        continue;
      }

      issues.push(
        makeIssue("extension_force_child_active", {
          severity: 2,
          message:
            "config.forceChild is set to " + repr(fc.value) + " (Force Child testing override is active).",
          flow: flow,
          node: node,
        })
      );
    }
    return issues;
  }

  // ---------------------------------------------------------------------
  // LLM helpers + checks (port of _llm_issues / _llm_connection_issues)
  // ---------------------------------------------------------------------

  function llmsByReferenceId(llms) {
    const out = new Map();
    if (!Array.isArray(llms)) return out;
    for (let i = 0; i < llms.length; i++) {
      const r = referenceIdOf(llms[i]);
      if (r) out.set(r, llms[i]);
    }
    return out;
  }

  function defaultLlm(llms) {
    if (!Array.isArray(llms)) return null;
    for (let i = 0; i < llms.length; i++) {
      if (isDefaultOf(llms[i])) return llms[i];
    }
    return null;
  }

  function nodeLlmReferences(node) {
    const cfg = configOf(node);
    const out = [];
    for (let i = 0; i < NODE_LLM_REFERENCE_FIELDS.length; i++) {
      const key = NODE_LLM_REFERENCE_FIELDS[i];
      if (!(key in cfg)) continue;
      const v = cfg[key];
      out.push([key, typeof v === "string" ? v : null]);
    }
    return out;
  }

  function llmTestStatus(llm) {
    const ct = connectionTestOf(llm);
    if (!ct) return "inconclusive";
    if (ct.error) return "inconclusive";
    const valid = isCredsValidOf(ct);
    if (valid === true) return "ok";
    if (valid === false) return "failed";
    return "inconclusive";
  }

  function llmLabel(llm) {
    const name = nameOf(llm).trim();
    const ref = referenceIdOf(llm).trim();
    if (name && ref) return repr(name) + " (" + ref + ")";
    return name ? repr(name) : ref ? ref : "<unnamed LLM>";
  }

  function llmTestMessage(llm) {
    const ct = connectionTestOf(llm) || {};
    const parts = [];
    const me = msgErrOf(ct);
    if (me) parts.push("msg_err=" + repr(me));
    if (ct.msg) parts.push("msg=" + repr(ct.msg));
    if (ct.error) parts.push("error=" + repr(ct.error));
    return parts.length ? parts.join(", ") : "no detail";
  }

  function llmIssueIdentityKey(target) {
    if (!target) return "";
    const ref = referenceIdOf(target).trim();
    if (ref) return ref;
    const id = idOf(target);
    if (id) return id;
    return llmLabel(target);
  }

  function llmIssues(flows, llms) {
    const issues = [];
    const byRef = llmsByReferenceId(llms);
    const def = defaultLlm(llms);
    const defaultRef = def ? referenceIdOf(def) : "";
    const usedRefs = new Set();
    const usedLlmTestProblems = new Map();
    let anyLlmCapableNode = false;

    function trackUsedLlmTestProblem(target, status, field) {
      const key = llmIssueIdentityKey(target);
      if (!key) return;
      let entry = usedLlmTestProblems.get(key);
      if (!entry) {
        entry = { target: target, status: status, nodeCount: 0, fields: new Set() };
        usedLlmTestProblems.set(key, entry);
      }
      entry.nodeCount += 1;
      if (field) entry.fields.add(field);
    }

    for (let fi = 0; fi < (flows || []).length; fi++) {
      const flow = flows[fi];
      const nodes = (flow && flow.nodes) || [];
      for (let ni = 0; ni < nodes.length; ni++) {
        const node = nodes[ni];
        if (!node || typeof node !== "object") continue;
        const refs = nodeLlmReferences(node);
        if (!refs.length) continue;
        anyLlmCapableNode = true;
        for (let ri = 0; ri < refs.length; ri++) {
          const field = refs[ri][0];
          const raw = refs[ri][1];
          const val = (raw || "").trim();
          if (!val) {
            issues.push(
              makeIssue("llm_reference_missing", {
                severity: 3,
                message: "config." + field + " is missing, null, or only whitespace.",
                flow: flow,
                node: node,
              })
            );
            continue;
          }
          let target;
          if (val === LLM_DEFAULT_TOKEN) {
            if (def === null) {
              issues.push(
                makeIssue("llm_reference_not_found", {
                  severity: 3,
                  message:
                    "config." +
                    field +
                    "=" +
                    repr(LLM_DEFAULT_TOKEN) +
                    " but no LLM has isDefault=True in this project.",
                  flow: flow,
                  node: node,
                })
              );
              continue;
            }
            if (defaultRef) usedRefs.add(defaultRef);
            target = def;
          } else {
            target = byRef.get(val);
            if (!target) {
              issues.push(
                makeIssue("llm_reference_not_found", {
                  severity: 3,
                  message:
                    "config." +
                    field +
                    "=" +
                    repr(val) +
                    " does not match any LLM reference_id available to this project.",
                  flow: flow,
                  node: node,
                })
              );
              continue;
            }
            usedRefs.add(val);
          }
          const status = llmTestStatus(target);
          if (status === "failed") {
            trackUsedLlmTestProblem(target, "failed", field);
          } else if (status === "inconclusive") {
            trackUsedLlmTestProblem(target, "inconclusive", field);
          }
        }
      }
    }

    usedLlmTestProblems.forEach(function (entry) {
      const target = entry.target;
      const count = Math.max(1, Number(entry.nodeCount || 0));
      const issueType = entry.status === "failed" ? "llm_used_test_failed" : "llm_used_test_inconclusive";
      const message =
        entry.status === "failed"
          ? "LLM " + llmLabel(target) + " failed its connection test (" + llmTestMessage(target) + ")."
          : "LLM " + llmLabel(target) + " could not be verified (" + llmTestMessage(target) + ").";
      for (let i = 0; i < count; i++) {
        issues.push(
          makeIssue(issueType, {
            severity: 3,
            message: message,
            llm: target,
          })
        );
      }
    });

    if (anyLlmCapableNode && def === null) {
      issues.push(
        makeIssue("llm_default_missing", {
          severity: 3,
          message:
            "At least one flow node exposes an LLM reference slot, but no LLM in this project has isDefault=True. Nodes that fall back to the project default will error at runtime.",
        })
      );
    }

    for (let li = 0; li < (llms || []).length; li++) {
      const llm = llms[li];
      const ref = referenceIdOf(llm).trim();
      if (ref && !usedRefs.has(ref)) {
        const status = llmTestStatus(llm);
        if (status === "ok") {
          issues.push(
            makeIssue("llm_unused", {
              severity: 1,
              message:
                "LLM " + llmLabel(llm) + " is available to this project but not referenced by any flow node.",
              llm: llm,
            })
          );
        } else if (status === "failed") {
          issues.push(
            makeIssue("llm_unused_test_failed", {
              severity: 2,
              message:
                "LLM " +
                llmLabel(llm) +
                " is unused and failed its connection test (" +
                llmTestMessage(llm) +
                ").",
              llm: llm,
            })
          );
        } else {
          issues.push(
            makeIssue("llm_unused_test_inconclusive", {
              severity: 2,
              message:
                "LLM " +
                llmLabel(llm) +
                " is unused and its connection test was inconclusive (" +
                llmTestMessage(llm) +
                ").",
              llm: llm,
            })
          );
        }
      }
      const fallbacks = fallbacksOf(llm);
      for (let idx = 0; idx < fallbacks.length; idx++) {
        const fb = fallbacks[idx];
        if (!fb || typeof fb !== "object") continue;
        if (!fb.isFallbackEnabled) continue;
        const fbRef = fb.fallbackLLMReferenceId;
        const fbRefStr = typeof fbRef === "string" ? fbRef.trim() : "";
        if (!fbRefStr) {
          issues.push(
            makeIssue("llm_fallback_reference_missing", {
              severity: 3,
              message:
                "LLM " +
                llmLabel(llm) +
                " has fallback[" +
                idx +
                "] enabled but fallbackLLMReferenceId is missing or blank.",
              llm: llm,
            })
          );
          continue;
        }
        const fbTarget = byRef.get(fbRefStr);
        if (!fbTarget) {
          issues.push(
            makeIssue("llm_fallback_reference_not_found", {
              severity: 3,
              message:
                "LLM " +
                llmLabel(llm) +
                " fallback[" +
                idx +
                "] references " +
                repr(fbRefStr) +
                ", which does not match any LLM in this project.",
              llm: llm,
            })
          );
          continue;
        }
        const status = llmTestStatus(fbTarget);
        if (status === "failed") {
          issues.push(
            makeIssue("llm_fallback_test_failed", {
              severity: 2,
              message:
                "LLM " +
                llmLabel(llm) +
                " fallback[" +
                idx +
                "] points at " +
                llmLabel(fbTarget) +
                ", which failed its connection test (" +
                llmTestMessage(fbTarget) +
                ").",
              llm: llm,
            })
          );
        } else if (status === "inconclusive") {
          issues.push(
            makeIssue("llm_fallback_test_inconclusive", {
              severity: 1,
              message:
                "LLM " +
                llmLabel(llm) +
                " fallback[" +
                idx +
                "] points at " +
                llmLabel(fbTarget) +
                ", whose connection test was inconclusive (" +
                llmTestMessage(fbTarget) +
                ").",
              llm: llm,
            })
          );
        }
      }
    }

    return issues;
  }

  function llmConnectionIssues(llms, connectionsByRef) {
    const issues = [];
    for (let i = 0; i < (llms || []).length; i++) {
      const llm = llms[i];
      if (resourceLevelOf(llm) !== "project") continue;
      const cid = connectionIdOf(llm);
      if (!cid || !cid.trim()) continue;
      const conn = connectionsByRef && connectionsByRef.get(cid);
      if (!conn) {
        issues.push(
          makeIssue("llm_connection_not_found", {
            severity: 3,
            message:
              "LLM " +
              llmLabel(llm) +
              " references connection reference_id " +
              repr(cid) +
              ", which is not available to this project.",
            llm: llm,
          })
        );
        continue;
      }
      if (isDeprecatedOf(conn)) {
        const name = nameOf(conn).trim() || cid;
        issues.push(
          makeIssue("llm_connection_deprecated", {
            severity: 3,
            message:
              "LLM " +
              llmLabel(llm) +
              " references connection " +
              repr(name) +
              " (reference_id=" +
              repr(cid) +
              "), which is marked is_deprecated=True.",
            llm: llm,
          })
        );
      }
    }
    return issues;
  }

  // ---------------------------------------------------------------------
  // Extension connection checks (port of _extension_connection_issues)
  // ---------------------------------------------------------------------

  function connectionFieldDescriptors(spec) {
    const out = [];
    const fields = extensionSpecFieldList(spec);
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f || typeof f !== "object") continue;
      if (f.type !== "connection") continue;
      const key = f.key;
      if (typeof key !== "string" || !key) continue;
      const params = f.params && typeof f.params === "object" ? f.params : {};
      const ctype = params.connectionType;
      if (typeof ctype !== "string" || !ctype) continue;
      const required = Boolean(params.required);
      out.push([key, ctype, required]);
    }
    return out;
  }

  function extensionConnectionIssues(flows, extensionSpecs, connections, connectionsByRef) {
    const issues = [];
    const byExtType = new Map();
    for (let i = 0; i < (connections || []).length; i++) {
      const conn = connections[i];
      const ext = extensionOf(conn).trim();
      const ctype = typeOf(conn).trim();
      if (!ext || !ctype) continue;
      const k = ext + "\x00" + ctype;
      let bucket = byExtType.get(k);
      if (!bucket) {
        bucket = [];
        byExtType.set(k, bucket);
      }
      bucket.push(conn);
    }

    for (let fi = 0; fi < (flows || []).length; fi++) {
      const flow = flows[fi];
      const nodes = (flow && flow.nodes) || [];
      for (let ni = 0; ni < nodes.length; ni++) {
        const node = nodes[ni];
        if (!node || typeof node !== "object") continue;
        const nodeExt = extensionOf(node).trim();
        if (!nodeExt || nodeExt.startsWith("@cognigy")) continue;
        const specKey = nodeExt + "\x00" + typeOf(node);
        const spec = extensionSpecs.get(specKey);
        if (!spec) continue;
        const fields = connectionFieldDescriptors(spec);
        if (!fields.length) continue;
        const cfg = configOf(node);
        for (let i = 0; i < fields.length; i++) {
          const cfgKey = fields[i][0];
          const expectedType = fields[i][1];
          const required = fields[i][2];
          const raw = cfg[cfgKey];
          const val = typeof raw === "string" ? raw.trim() : "";
          if (!val) {
            if (required && !byExtType.get(nodeExt + "\x00" + expectedType)) {
              issues.push(
                makeIssue("extension_connection_type_unavailable", {
                  severity: 3,
                  message:
                    "config." +
                    cfgKey +
                    " expects a connection of type " +
                    repr(expectedType) +
                    " provided by extension " +
                    repr(nodeExt) +
                    ", but no such connection is configured in this project. Create the connection first, then reference it here.",
                  flow: flow,
                  node: node,
                })
              );
            }
            continue;
          }
          const conn = connectionsByRef && connectionsByRef.get(val);
          if (!conn) {
            issues.push(
              makeIssue("extension_connection_removed", {
                severity: 3,
                message:
                  "config." +
                  cfgKey +
                  "=" +
                  repr(val) +
                  " does not match any connection available to this project (the connection was removed or the reference is stale).",
                flow: flow,
                node: node,
              })
            );
            continue;
          }
          if (isDeprecatedOf(conn)) {
            const connName = nameOf(conn).trim() || val;
            issues.push(
              makeIssue("extension_connection_deprecated", {
                severity: 3,
                message:
                  "config." +
                  cfgKey +
                  " references connection " +
                  repr(connName) +
                  " (reference_id=" +
                  repr(val) +
                  "), which is marked is_deprecated=True.",
                flow: flow,
                node: node,
              })
            );
          }
          const connExt = extensionOf(conn).trim();
          const connType = typeOf(conn).trim();
          if (connExt !== nodeExt || connType !== expectedType) {
            const connName = nameOf(conn).trim() || val;
            issues.push(
              makeIssue("extension_connection_type_mismatch", {
                severity: 3,
                message:
                  "config." +
                  cfgKey +
                  " expects (extension=" +
                  repr(nodeExt) +
                  ", type=" +
                  repr(expectedType) +
                  ") but references connection " +
                  repr(connName) +
                  " (extension=" +
                  repr(connExt) +
                  ", type=" +
                  repr(connType) +
                  ", reference_id=" +
                  repr(val) +
                  ").",
                flow: flow,
                node: node,
              })
            );
          }
        }
      }
    }
    return issues;
  }

  // ---------------------------------------------------------------------
  // Per-node goTo / executeFlow / aiAgentToolAnswer checks
  // ---------------------------------------------------------------------

  function gotoExecuteIssuesForNode(flow, node, byFlowRef) {
    const ntype = typeOf(node);
    if (ntype !== "goTo" && ntype !== "executeFlow") return [];
    const prefix = ntype === "goTo" ? "goto" : "execute_flow";
    const issues = [];
    const cfg = configOf(node);
    const fn = configFlowNode(cfg);
    if (fn === null) {
      issues.push(
        makeIssue(prefix + "_missing_flow_node_config", {
          severity: 3,
          message: "Missing config.flowNode (target flow/node references).",
          flow: flow,
          node: node,
        })
      );
      return issues;
    }
    const flowRef = String(fn.flow || "").trim();
    const nodeRef = String(fn.node || "").trim();
    if (!flowRef) {
      issues.push(
        makeIssue(prefix + "_empty_target_flow_reference", {
          severity: 3,
          message: "flowNode.flow is empty (expected a flow reference_id UUID).",
          flow: flow,
          node: node,
        })
      );
      return issues;
    }
    const targetFlow = byFlowRef.get(flowRef);
    if (!targetFlow) {
      issues.push(
        makeIssue(prefix + "_target_flow_not_found", {
          severity: 3,
          message: "No flow with reference_id=" + repr(flowRef) + " in this project map.",
          flow: flow,
          node: node,
        })
      );
      return issues;
    }
    if (!nodeRef) {
      issues.push(
        makeIssue(prefix + "_empty_target_node_reference", {
          severity: 3,
          message: "flowNode.node is empty (expected a target node reference_id UUID).",
          flow: flow,
          node: node,
        })
      );
      return issues;
    }
    const tNodes = (targetFlow && targetFlow.nodes) || [];
    const byNodeRef = nodesByReferenceId(tNodes);
    const targetNode = byNodeRef.get(nodeRef);
    if (!targetNode) {
      issues.push(
        makeIssue(prefix + "_target_node_not_found", {
          severity: 3,
          message:
            "No node with reference_id=" +
            repr(nodeRef) +
            " in flow " +
            repr(nameOf(targetFlow) || idOf(targetFlow)) +
            ".",
          flow: flow,
          node: node,
        })
      );
      return issues;
    }
    const flowId = idOf(flow);
    const sameFlow = flowId && idOf(targetFlow) === flowId;
    const sameNode = idOf(targetNode) && idOf(targetNode) === idOf(node);
    if (sameFlow && sameNode) {
      issues.push(
        makeIssue(prefix + "_self_reference", {
          severity: 3,
          message: ntype + " target points at itself (same flow, same node).",
          flow: flow,
          node: node,
        })
      );
    }
    if (isDisabledOf(targetNode)) {
      issues.push(
        makeIssue(prefix + "_target_disabled", {
          severity: 3,
          message:
            "Target node " +
            repr(labelOf(targetNode) || idOf(targetNode)) +
            " is disabled (is_disabled=True).",
          flow: flow,
          node: node,
        })
      );
    }
    return issues;
  }

  function aiAgentToolAnswerIssues(flow, node) {
    if (typeOf(node) !== "aiAgentToolAnswer") return [];
    const cfg = configOf(node);
    const ans = cfg.answer;
    const missing =
      !("answer" in cfg) ||
      ans === null ||
      ans === undefined ||
      (typeof ans === "string" && ans.trim() === "");
    if (!missing) return [];
    return [
      makeIssue("ai_agent_tool_answer_missing_or_empty", {
        severity: 3,
        message: "config.answer is missing, null, or only whitespace.",
        flow: flow,
        node: node,
      }),
    ];
  }

  // ---------------------------------------------------------------------
  // Top-level scan (port of find_flow_node_issues body, minus class state)
  // ---------------------------------------------------------------------

  function scanProject(args) {
    const flows = args.flows || [];
    const llms = args.llms || [];
    const connections = args.connections || [];
    const connectionsByRef = args.connectionsByRef || new Map();
    const extensionSpecs = args.extensionSpecs || new Map();
    const byFlowRef = flowsByReferenceId(flows);
    const issues = [];

    for (let fi = 0; fi < flows.length; fi++) {
      const flow = flows[fi];
      const nodes = (flow && flow.nodes) || [];
      const byId = nodesById(nodes);
      for (let ni = 0; ni < nodes.length; ni++) {
        const node = nodes[ni];
        if (!node || typeof node !== "object") continue;
        const ntype = typeOf(node);

        if (ntype === "goTo" || ntype === "executeFlow") {
          const subIssues = gotoExecuteIssuesForNode(flow, node, byFlowRef);
          for (let k = 0; k < subIssues.length; k++) issues.push(subIssues[k]);
        }
        const aiIssues = aiAgentToolAnswerIssues(flow, node);
        for (let k = 0; k < aiIssues.length; k++) issues.push(aiIssues[k]);
        if (ntype === "switch") {
          const sw = switchDuplicateCaseIssues(flow, node, byId);
          for (let k = 0; k < sw.length; k++) issues.push(sw[k]);
        }
        const bi = builtinPerNodeIssues(flow, node);
        for (let k = 0; k < bi.length; k++) issues.push(bi[k]);
        const ext = extensionOf(node).trim();
        if (ext && !ext.startsWith("@cognigy")) {
          const specKey = ext + "\x00" + ntype;
          const spec = extensionSpecs.get(specKey);
          if (!spec) {
            issues.push(
              makeIssue("extension_node_type_not_registered", {
                severity: 3,
                message:
                  "Extension " +
                  repr(ext) +
                  " does not provide node type " +
                  repr(ntype) +
                  " in the current API catalogue for this project.",
                flow: flow,
                node: node,
              })
            );
          } else {
            const ei = extensionSpecStructureIssues(flow, node, spec, byId);
            for (let k = 0; k < ei.length; k++) issues.push(ei[k]);
          }
        }
      }
      const dp = deadPathIssuesForFlow(flow);
      for (let k = 0; k < dp.length; k++) issues.push(dp[k]);
      const dl = duplicateLabelIssues(flow);
      for (let k = 0; k < dl.length; k++) issues.push(dl[k]);
      const fci = extensionForceChildIssues(flow, nodes);
      for (let k = 0; k < fci.length; k++) issues.push(fci[k]);
    }

    const li = llmIssues(flows, llms);
    for (let k = 0; k < li.length; k++) issues.push(li[k]);
    const lci = llmConnectionIssues(llms, connectionsByRef);
    for (let k = 0; k < lci.length; k++) issues.push(lci[k]);
    const eci = extensionConnectionIssues(flows, extensionSpecs, connections, connectionsByRef);
    for (let k = 0; k < eci.length; k++) issues.push(eci[k]);

    // Match Python ordering: severity desc, then flow name asc.
    issues.sort(function (a, b) {
      const an = (a.flow && nameOf(a.flow)) || "";
      const bn = (b.flow && nameOf(b.flow)) || "";
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    issues.sort(function (a, b) {
      return (b.severity || 0) - (a.severity || 0);
    });
    return issues;
  }

  pm.issues = {
    // shape adapters
    idOf,
    referenceIdOf,
    typeOf,
    nameOf,
    labelOf,
    nextNodeIdOf,
    childNodeIdsOf,
    isDisabledOf,
    isDefaultOf,
    isDeprecatedOf,
    resourceLevelOf,
    connectionIdOf,
    connectionTestOf,
    extensionOf,
    // lookups
    nodesById,
    nodesByReferenceId,
    flowsByReferenceId,
    nodeExtTypeKey,
    // helpers
    isBlankStr,
    isValidJsonString,
    configValueEmptyForRequired,
    flowAdjacency,
    collectReachable,
    // checks
    deadPathIssuesForFlow,
    builtinPerNodeIssues,
    switchDuplicateCaseIssues,
    duplicateLabelIssues,
    extensionSpecStructureIssues,
    extensionForceChildIssues,
    llmIssues,
    llmConnectionIssues,
    extensionConnectionIssues,
    gotoExecuteIssuesForNode,
    aiAgentToolAnswerIssues,
    // entry point
    scanProject,
  };
})();

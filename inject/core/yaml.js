/**
 * Cognigy Copilot — YAML emit helpers for flow display and diffing.
 */
(function ccpYamlModule() {
  const CCP = (window.__CCP__ = window.__CCP__ || {});
  if (CCP.yaml && CCP.yaml.__bootstrapped) return;

  const yaml = (CCP.yaml = CCP.yaml || {});
  yaml.__bootstrapped = true;

  const DIFF_KEY_ORDER = ["_id", "id", "type", "label", "preview", "config", "children"];
  const DIFF_KEY_ORDER_SET = new Set(DIFF_KEY_ORDER);

  function canonicalizeForDiff(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map(canonicalizeForDiff);
    }
    if (typeof value !== "object") return value;
    const keys = Object.keys(value);
    const ordered = [];
    DIFF_KEY_ORDER.forEach(function (k) {
      if (keys.indexOf(k) >= 0) ordered.push(k);
    });
    keys
      .filter(function (k) {
        return !DIFF_KEY_ORDER_SET.has(k);
      })
      .sort(function (a, b) {
        return a.localeCompare(b);
      })
      .forEach(function (k) {
        ordered.push(k);
      });
    const out = {};
    ordered.forEach(function (k) {
      out[k] = canonicalizeForDiff(value[k]);
    });
    return out;
  }

  function getJsYaml() {
    return CCP.__jsyaml || null;
  }

  function emit(value, opts) {
    const o = opts || {};
    const jsyaml = getJsYaml();
    if (!jsyaml || typeof jsyaml.dump !== "function") {
      throw new Error("js-yaml not available");
    }
    const prepared = o.canonicalize ? canonicalizeForDiff(value) : value;
    return jsyaml.dump(prepared, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });
  }

  yaml.canonicalizeForDiff = canonicalizeForDiff;
  yaml.emit = emit;
})();

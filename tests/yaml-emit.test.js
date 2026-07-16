import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import jsyaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, "..");

function loadScript(relativePath) {
  const code = readFileSync(join(extRoot, relativePath), "utf8");
  new Function(code)();
}

function loadYamlModule() {
  vi.resetModules();
  window.__CCP__ = {};
  window.__CCP__.__jsyaml = jsyaml;
  loadScript("inject/core/yaml.js");
  return window.__CCP__;
}

describe("CCP.yaml.emit", () => {
  beforeEach(() => {
    loadYamlModule();
  });

  it("renders multiline config.code as a literal block scalar", () => {
    const CCP = window.__CCP__;
    const node = {
      _id: "node-1",
      type: "code",
      label: "Load profile",
      config: {
        code: "const x = 1;\nif (x) {\n  return true;\n}\n",
      },
    };
    const text = CCP.yaml.emit(node, { canonicalize: true });
    expect(text).toContain("code: |");
    expect(text).toContain("const x = 1;");
    expect(text).toContain("if (x) {");
    expect(text).not.toContain("\\n");
  });

  it("quotes extension values starting with @cognigy", () => {
    const CCP = window.__CCP__;
    const node = {
      _id: "node-2",
      type: "extension",
      extension: "@cognigy/basic-nodes",
      label: "Say",
    };
    const text = CCP.yaml.emit(node, { canonicalize: true });
    expect(text).toMatch(/extension:\s*['"]@cognigy\/basic-nodes['"]/);
  });

  it("quotes Norway-problem strings like no", () => {
    const CCP = window.__CCP__;
    const node = {
      _id: "node-3",
      type: "say",
      label: "no",
      config: { text: "no" },
    };
    const text = CCP.yaml.emit(node, { canonicalize: true });
    expect(text).toMatch(/label:\s*['"]no['"]/);
    expect(text).toMatch(/text:\s*['"]no['"]/);
  });

  it("emits stable key order with _id first", () => {
    const CCP = window.__CCP__;
    const node = {
      children: [],
      config: {},
      label: "X",
      type: "say",
      _id: "abc",
    };
    const text = CCP.yaml.emit(node, { canonicalize: true });
    const idIdx = text.indexOf("_id:");
    const typeIdx = text.indexOf("type:");
    const childrenIdx = text.indexOf("children:");
    expect(idIdx).toBeGreaterThanOrEqual(0);
    expect(typeIdx).toBeGreaterThan(idIdx);
    expect(childrenIdx).toBeGreaterThan(typeIdx);
  });

  it("round-trips through js-yaml load after canonicalize", () => {
    const CCP = window.__CCP__;
    const flow = [
      {
        _id: "n1",
        type: "code",
        label: "Step",
        config: {
          code: "api.log('ok');\n",
        },
        children: [],
      },
      {
        _id: "n2",
        type: "say",
        label: "no",
        config: { text: "08" },
        children: [],
      },
    ];
    const canonical = CCP.yaml.canonicalizeForDiff(flow);
    const text = CCP.yaml.emit(flow, { canonicalize: true });
    const parsed = jsyaml.load(text);
    expect(parsed).toEqual(canonical);
  });
});

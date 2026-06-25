import { beforeEach, describe, expect, it } from "vitest";
import { loadIifeModule } from "./helpers/load-iife.js";

describe("naming-engine", () => {
  beforeEach(async () => {
    window.__CCP__ = {};
    await loadIifeModule("inject/naming/naming-engine.js");
  });

  it("sanitizes forbidden analytics characters", () => {
    const { naming } = window.__CCP__;
    const sanitized = naming.sanitizeAnalyticsLabel('bad/label: "test"');
    expect(sanitized).not.toMatch(/[/:"]/);
    expect(sanitized.length).toBeLessThanOrEqual(128);
  });

  it("computes expected labels via createEngine rules", async () => {
    const engine = window.__CCP__.naming.createEngine();
    const result = await engine.computeLabel("code", "@cognigy/basic-nodes", {}, "flow-1", "", {});
    expect(result.label).toContain("Code");
  });

  it("detects emit code nodes", () => {
    expect(window.__CCP__.naming.isEmitCodeNode("code", "Emit")).toBe(true);
    expect(window.__CCP__.naming.isEmitCodeNode("code", "Other")).toBe(false);
  });

  it("reports naming violations for non-compliant labels", async () => {
    const engine = window.__CCP__.naming.createEngine();
    const evaluation = await engine.evaluateNodeNaming(
      {
        id: "node-1",
        type: "code",
        label: "TotallyWrong",
        analyticsLabel: "",
      },
      "flow-1"
    );

    expect(evaluation).not.toBeNull();
    expect(evaluation.labelViolation).toBe(true);
    expect(evaluation.expectedLabel).toContain("Code");
    expect(evaluation.message).toContain("Naming convention");
  });

  it("builds a fix patch for naming violations", async () => {
    const engine = window.__CCP__.naming.createEngine();
    const patch = await engine.buildNamingFixPatch(
      {
        id: "node-2",
        type: "code",
        label: "TotallyWrong",
        analyticsLabel: "",
      },
      "flow-1"
    );

    expect(patch).not.toBeNull();
    expect(patch.label).toContain("Code");
    expect(patch.analyticsLabel).toBeTruthy();
  });

  it("returns null when node naming is already compliant", async () => {
    const engine = window.__CCP__.naming.createEngine();
    const computed = await engine.computeLabel("code", "@cognigy/basic-nodes", {}, "flow-1", "", {});
    const evaluation = await engine.evaluateNodeNaming(
      {
        id: "node-3",
        type: "code",
        label: computed.label,
        analyticsLabel: computed.analyticsLabel || "",
      },
      "flow-1"
    );

    expect(evaluation).toBeNull();
  });
});

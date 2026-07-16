import { beforeEach, describe, expect, it } from "vitest";
import { loadIifeModule } from "./helpers/load-iife.js";

function createBranchEngine(parentType, parentLabel) {
  const parentId = "parent-1";
  const childId = "child-1";
  const chart = {
    parentByChildId: new Map([[childId, parentId]]),
    nodesById: new Map([
      [parentId, { id: parentId, type: parentType, label: parentLabel }],
      [childId, { id: childId, type: "child", label: "" }],
    ]),
  };
  return window.__CCP__.naming.createEngine({
    getChart: () => chart,
    getNodeDetails: (_flowId, nodeId) =>
      Promise.resolve(nodeId === parentId ? { id: parentId, type: parentType, label: parentLabel } : null),
  });
}

function createBranchEngineFromChildIds(parentType, parentLabel, childType) {
  const parentId = "parent-1";
  const childId = "child-1";
  const chart = {
    parentByChildId: new Map(),
    nodes: [
      {
        id: parentId,
        type: parentType,
        label: parentLabel,
        childNodeIds: [childId],
      },
      { id: childId, type: childType, label: "" },
    ],
    nodesById: new Map([
      [
        parentId,
        {
          id: parentId,
          type: parentType,
          label: parentLabel,
          childNodeIds: [childId],
        },
      ],
      [childId, { id: childId, type: childType, label: "" }],
    ]),
  };
  return window.__CCP__.naming.createEngine({
    getChart: () => chart,
    getNodeDetails: (_flowId, nodeId) =>
      Promise.resolve(nodeId === parentId ? { id: parentId, type: parentType, label: parentLabel } : null),
  });
}

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

  it("derives Then/Else analytics from parent If label", async () => {
    const engine = createBranchEngine("if", "If_user.isVIP");
    const then = await engine.computeLabel("then", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });
    const elseBranch = await engine.computeLabel("else", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });

    expect(then.label).toBe("Then");
    expect(then.analyticsLabel).toBe("node_Then_user-isVIP");
    expect(elseBranch.label).toBe("Else");
    expect(elseBranch.analyticsLabel).toBe("node_Else_user-isVIP");
  });

  it("resolves branch parent via child_node_ids when parentByChildId is empty", async () => {
    const engine = createBranchEngineFromChildIds("if", "If_checkVIP", "then");
    const then = await engine.computeLabel("then", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });

    expect(then.label).toBe("Then");
    expect(then.analyticsLabel).toBe("node_Then_checkVIP");
  });

  it("does not flag compliant then/else nodes during evaluation", async () => {
    const engine = createBranchEngine("if", "If_checkVIP");
    const computed = await engine.computeLabel("then", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });
    const evaluation = await engine.evaluateNodeNaming(
      {
        id: "child-1",
        type: "then",
        label: computed.label,
        analyticsLabel: computed.analyticsLabel || "",
      },
      "flow-1"
    );

    expect(evaluation).toBeNull();
  });

  it("skips then/else evaluation when parent context cannot be resolved", async () => {
    const engine = window.__CCP__.naming.createEngine({
      getChart: () => null,
      getFlowNodes: () => [],
    });
    const evaluation = await engine.evaluateNodeNaming(
      {
        id: "child-1",
        type: "then",
        label: "Then",
        analyticsLabel: "node_Then_checkVIP",
      },
      "flow-1"
    );

    expect(evaluation).toBeNull();
  });

  it("resolves then parent from flowNodes when chart cache is empty", async () => {
    const parentId = "parent-1";
    const childId = "child-1";
    const flowNodes = [
      {
        id: parentId,
        type: "if",
        label: "If_checkVIP",
        childNodeIds: [childId],
      },
      { id: childId, type: "then", label: "Then", analyticsLabel: "node_Then_checkVIP" },
    ];
    const engine = window.__CCP__.naming.createEngine({
      getChart: () => null,
      getFlowNodes: () => flowNodes,
      getNodeDetails: () => Promise.resolve(null),
    });
    const evaluation = await engine.evaluateNodeNaming(
      {
        id: childId,
        type: "then",
        label: "Then",
        analyticsLabel: "node_Then_checkVIP",
      },
      "flow-1",
      null,
      { flowNodes: flowNodes }
    );

    expect(evaluation).toBeNull();
  });

  it("derives Once branch analytics from parent Once label", async () => {
    const engine = createBranchEngine("once", "Once_checkVIP");
    const onFirst = await engine.computeLabel("onFirstExecution", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });
    const after = await engine.computeLabel("afterwards", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });

    expect(onFirst.label).toBe("On First Time");
    expect(onFirst.analyticsLabel).toBe("node_On First Time_checkVIP");
    expect(after.label).toBe("Afterwards");
    expect(after.analyticsLabel).toBe("node_Afterwards_checkVIP");
  });

  it("uses branch label only when Once parent has no suffix", async () => {
    const engine = createBranchEngine("once", "Once");
    const after = await engine.computeLabel("afterwards", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });

    expect(after.label).toBe("Afterwards");
    expect(after.analyticsLabel).toBe("node_Afterwards");
  });

  it("derives Optional Question branch analytics from parent OQ label", async () => {
    const engine = createBranchEngine("optionalQuestion", "OQ_askEmail");
    const onAnswer = await engine.computeLabel("onAnswer", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });
    const onQuestion = await engine.computeLabel("onQuestion", "@cognigy/basic-nodes", {}, "flow-1", "", {
      nodeId: "child-1",
    });

    expect(onAnswer.label).toBe("On Answer");
    expect(onAnswer.analyticsLabel).toBe("node_On Answer_askEmail");
    expect(onQuestion.label).toBe("On Question");
    expect(onQuestion.analyticsLabel).toBe("node_On Question_askEmail");
  });
});

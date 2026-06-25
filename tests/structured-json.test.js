import { beforeEach, describe, expect, it } from "vitest";
import { loadIifeModule } from "./helpers/load-iife.js";

const MINIMAL_FLOW = [
  {
    id: "start-1",
    type: "start",
    nextNodeId: "say-1",
  },
  {
    id: "say-1",
    type: "say",
    label: "Greeting",
    config: { text: "Hello" },
    nextNodeId: "end-1",
  },
  {
    id: "end-1",
    type: "end",
  },
];

const IF_FLOW = [
  { id: "start-1", type: "start", nextNodeId: "if-1" },
  {
    id: "if-1",
    type: "if",
    label: "Branch",
    childNodeIds: ["then-1", "else-1"],
    nextNodeId: "end-1",
  },
  { id: "then-1", type: "then", nextNodeId: "end-1" },
  { id: "else-1", type: "else", nextNodeId: "end-1" },
  { id: "end-1", type: "end" },
];

const SWITCH_FLOW = [
  { id: "start-1", type: "start", nextNodeId: "switch-1" },
  {
    id: "switch-1",
    type: "switch",
    label: "Route",
    childNodeIds: ["default-1", "case-1"],
    nextNodeId: "end-1",
  },
  { id: "default-1", type: "default", nextNodeId: "end-1" },
  { id: "case-1", type: "case", label: "A", nextNodeId: "end-1" },
  { id: "end-1", type: "end" },
];

describe("structured-json", () => {
  /** @type {new (opts: object) => { build: () => object[] }} */
  let Builder;

  beforeEach(async () => {
    window.__CCP__ = { projectMap: {} };
    await loadIifeModule("inject/project-map/structured-json.js");
    Builder = window.__CCP__.projectMap.CognigyFlowNodesInExecutionOrder;
  });

  it("builds execution-order tree from start to end", () => {
    const builder = new Builder({ nodes: MINIMAL_FLOW, flowContext: "test-flow" });
    const tree = builder.build();

    expect(tree).toHaveLength(3);
    expect(tree[0].type).toBe("start");
    expect(tree[1].type).toBe("say");
    expect(tree[2].type).toBe("end");
  });

  it("builds if branches with then and else children", () => {
    const builder = new Builder({ nodes: IF_FLOW, flowContext: "if-flow" });
    const tree = builder.build();

    const ifNode = tree.find((node) => node.type === "if");
    expect(ifNode).toBeTruthy();
    expect(ifNode.children).toHaveLength(2);
    expect(ifNode.children[0][0].type).toBe("then");
    expect(ifNode.children[1][0].type).toBe("else");
  });

  it("builds switch branches with default and case children", () => {
    const builder = new Builder({ nodes: SWITCH_FLOW, flowContext: "switch-flow" });
    const tree = builder.build();

    const switchNode = tree.find((node) => node.type === "switch");
    expect(switchNode).toBeTruthy();
    expect(switchNode.children).toHaveLength(2);
    expect(switchNode.children[0][0].type).toBe("default");
    expect(switchNode.children[1][0].type).toBe("case");
  });

  it("includes unreachable nodes when allowUnreachableNodes is enabled", () => {
    const nodes = MINIMAL_FLOW.concat([
      { id: "orphan-1", type: "say", label: "Unreachable", config: { text: "orphan" } },
    ]);
    const builder = new Builder({
      nodes,
      flowContext: "orphan-flow",
      allowUnreachableNodes: true,
    });
    const tree = builder.build();

    expect(tree.length).toBeGreaterThan(3);
    expect(tree.some((node) => node.label === "Unreachable")).toBe(true);
  });

  it("throws when unreachable nodes exist and allowUnreachableNodes is false", () => {
    const nodes = MINIMAL_FLOW.concat([
      { id: "orphan-1", type: "say", label: "Unreachable", config: { text: "orphan" } },
    ]);
    const builder = new Builder({ nodes, flowContext: "orphan-flow" });

    expect(() => builder.build()).toThrow(/not reached by traversal/);
  });

  it("strips sparse empty config values", () => {
    const { structuredJsonHelpers } = window.__CCP__.projectMap;
    const stripped = structuredJsonHelpers.stripSparseConfigDict({
      text: "ok",
      empty: "",
      none: null,
      flag: false,
      list: [],
    });
    expect(stripped).toEqual({ text: "ok" });
  });
});

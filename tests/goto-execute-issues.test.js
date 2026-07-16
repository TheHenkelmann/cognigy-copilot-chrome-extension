import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadIssuesModule() {
  window.__CCP__ = {};
  vi.resetModules();
  await import("../inject/project-map/node-constants.js");
  vi.resetModules();
  await import("../inject/project-map/issues.js");
  return window.__CCP__.projectMap.issues;
}

describe("goto execute issues", () => {
  let issuesMod;

  beforeEach(async () => {
    issuesMod = await loadIssuesModule();
  });

  it("skips target node check when the target flow index is not ready", () => {
    const flowRef = "flow-ref-target";
    const nodeRef = "node-ref-target";
    const sourceFlow = {
      id: "source-flow",
      referenceId: "source-ref",
      name: "Source",
      nodes: [
        {
          id: "goto-1",
          type: "goTo",
          label: "GT_test",
          config: {
            flowNode: {
              flow: flowRef,
              node: nodeRef,
            },
          },
        },
      ],
    };
    const targetFlow = {
      id: "target-flow",
      referenceId: flowRef,
      name: "Target",
      nodes: [],
    };
    const result = issuesMod.scanProject({
      flows: [sourceFlow, targetFlow],
      llms: [],
      connections: [],
      connectionsByRef: new Map(),
      extensionSpecs: new Map(),
      projectIndexReady: true,
      isFlowNodesIndexReady: function () {
        return false;
      },
    });

    expect(result).toEqual([]);
  });

  it("resolves target node from chart cache fallback", () => {
    const flowRef = "flow-ref-target";
    const nodeRef = "node-ref-target";
    const sourceFlow = {
      id: "source-flow",
      referenceId: "source-ref",
      name: "Source",
      nodes: [
        {
          id: "goto-1",
          type: "goTo",
          label: "GT_test",
          config: {
            flowNode: {
              flow: flowRef,
              node: nodeRef,
            },
          },
        },
      ],
    };
    const targetFlow = {
      id: "target-flow",
      referenceId: flowRef,
      name: "Target",
      nodes: [],
    };
    const chartEntries = new Map([
      [
        "target-flow",
        {
          nodesByRefId: new Map([
            [
              nodeRef,
              {
                id: "target-node",
                referenceId: nodeRef,
                type: "say",
                label: "Hello",
              },
            ],
          ]),
        },
      ],
    ]);

    const result = issuesMod.scanProject({
      flows: [sourceFlow, targetFlow],
      llms: [],
      connections: [],
      connectionsByRef: new Map(),
      extensionSpecs: new Map(),
      chartEntriesByFlowId: chartEntries,
      isFlowNodesIndexReady: function (flow) {
        return flow && flow.id === "target-flow";
      },
    });

    expect(result.some((issue) => issue.type === "goto_target_node_not_found")).toBe(false);
  });

  it("reports target node not found once the target flow index is ready", () => {
    const flowRef = "flow-ref-target";
    const nodeRef = "node-ref-missing";
    const sourceFlow = {
      id: "source-flow",
      referenceId: "source-ref",
      name: "Source",
      nodes: [
        {
          id: "goto-1",
          type: "goTo",
          label: "GT_test",
          config: {
            flowNode: {
              flow: flowRef,
              node: nodeRef,
            },
          },
        },
      ],
    };
    const targetFlow = {
      id: "target-flow",
      referenceId: flowRef,
      name: "Target",
      nodes: [
        {
          id: "other-node",
          referenceId: "other-ref",
          type: "say",
          label: "Other",
        },
      ],
    };

    const result = issuesMod.scanProject({
      flows: [sourceFlow, targetFlow],
      llms: [],
      connections: [],
      connectionsByRef: new Map(),
      extensionSpecs: new Map(),
      isFlowNodesIndexReady: function () {
        return true;
      },
    });

    expect(result.some((issue) => issue.type === "goto_target_node_not_found")).toBe(true);
  });

  it("skips goto checks while source node config is still hydrating", () => {
    const sourceFlow = {
      id: "source-flow",
      referenceId: "source-ref",
      name: "Source",
      nodes: [
        {
          id: "goto-1",
          type: "goTo",
          label: "GT_test",
        },
      ],
    };

    const result = issuesMod.scanProject({
      flows: [sourceFlow],
      llms: [],
      connections: [],
      connectionsByRef: new Map(),
      extensionSpecs: new Map(),
    });

    expect(result).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { loadIifeModule } from "./helpers/load-iife.js";

describe("node-create-defaults", () => {
  beforeEach(async () => {
    window.__CCP__ = {};
    await loadIifeModule("inject/naming/node-create-defaults.js");
  });

  it("applies executeFlow defaults and overrides Cognigy studio defaults", () => {
    const { applyNodeCreateDefaults } = window.__CCP__.naming;
    const result = applyNodeCreateDefaults("executeFlow", {
      parseIntents: true,
      parseKeyphrases: true,
      absorbContext: false,
      flowNode: { flow: "abc", node: "def" },
    });
    expect(result).toEqual({
      parseIntents: false,
      parseKeyphrases: false,
      absorbContext: true,
      flowNode: { flow: "abc", node: "def" },
    });
  });

  it("applies the same defaults for goTo", () => {
    const { applyNodeCreateDefaults } = window.__CCP__.naming;
    const result = applyNodeCreateDefaults("goTo", {
      parseIntents: true,
      parseKeyphrases: true,
      absorbContext: "",
      executionMode: "continue",
    });
    expect(result.parseIntents).toBe(false);
    expect(result.parseKeyphrases).toBe(false);
    expect(result.absorbContext).toBe(true);
    expect(result.executionMode).toBe("continue");
  });

  it("applies llmPromptV2 debug, input storage, and stop sequence defaults", () => {
    const { applyNodeCreateDefaults } = window.__CCP__.naming;
    const result = applyNodeCreateDefaults("llmPromptV2", {
      llmProviderReferenceId: "default",
      debugLogTokenCount: false,
      advancedLogging: true,
      loggingWebhookUrl: "https://example.com/hook",
      storeLocation: "stream",
      streamStoreCopyInInput: false,
      streamStopTokens: [".", "!", "?", "\\n"],
      prompt: "hello",
    });
    expect(result.debugLogTokenCount).toBe(true);
    expect(result.debugLogRequestAndCompletion).toBe(true);
    expect(result.debugLogLLMLatency).toBe(true);
    expect(result.debugLogToolDefinitions).toBe(true);
    expect(result.advancedLogging).toBe(false);
    expect(result.loggingWebhookUrl).toBe("");
    expect(result.loggingCustomData).toBe("{}");
    expect(result.loggingHeaders).toBe("{}");
    expect(result.conditionForLogging).toBe("");
    expect(result.storeLocation).toBe("input");
    expect(result.streamStoreCopyInInput).toBe(true);
    expect(result.streamStopTokens).toEqual(["\\n\\n", "<p>"]);
    expect(result.llmProviderReferenceId).toBe("default");
    expect(result.prompt).toBe("hello");
  });

  it("enables debug for aiAgentToolAnswer", () => {
    const { applyNodeCreateDefaults } = window.__CCP__.naming;
    const result = applyNodeCreateDefaults("aiAgentToolAnswer", {
      answer: "",
      debugToolAnswer: false,
    });
    expect(result.answer).toBe("");
    expect(result.debugToolAnswer).toBe(true);
  });

  it("returns config unchanged for unknown node types", () => {
    const { applyNodeCreateDefaults } = window.__CCP__.naming;
    const config = { foo: "bar" };
    expect(applyNodeCreateDefaults("code", config)).toEqual(config);
    expect(applyNodeCreateDefaults("say", config)).toEqual(config);
  });

  it("handles missing config", () => {
    const { applyNodeCreateDefaults } = window.__CCP__.naming;
    expect(applyNodeCreateDefaults("executeFlow")).toEqual({
      parseIntents: false,
      parseKeyphrases: false,
      absorbContext: true,
    });
  });
});

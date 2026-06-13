import { describe, it, expect } from "vitest";
import { llmBreakdown } from "./breakdown.js";
import type { ParseClient } from "./client.js";
import type { BreakdownRequest } from "../breakdown/index.js";

function fakeClient(parsed_output: unknown): ParseClient {
  return { messages: { parse: async () => ({ parsed_output }) } };
}

const baseReq: BreakdownRequest = {
  title: "build a thing",
  useLlm: true,
  model: "claude-opus-4-8",
  effort: "medium",
};

describe("llmBreakdown", () => {
  it("keeps a well-formed feature breakdown and ensures 'self' in delegatable_to", async () => {
    const client = fakeClient({
      title: "Build login screen",
      type: "feature",
      effort: "large",
      stages: [
        { name: "Planning", kind: "planning", effort: "small", delegatable_to: ["ai_agent"] },
        { name: "Implementation", kind: "implementation", effort: "large", delegatable_to: ["ai_agent"] },
        { name: "Testing", kind: "testing", effort: "medium", delegatable_to: ["ci"] },
        { name: "Stage Testing", kind: "stage_testing", effort: "small", delegatable_to: ["teammate"] },
      ],
    });
    const res = await llmBreakdown(baseReq, client);
    expect(res).not.toBeNull();
    expect(res!.type).toBe("feature");
    expect(res!.stages.map((s) => s.kind)).toEqual(["planning", "implementation", "testing", "stage_testing"]);
    expect(res!.stages[0].delegatable_to).toContain("self");
    expect(res!.stages[0].delegatable_to).toContain("ai_agent");
    expect(res!.source).toBe("llm");
  });

  it("repairs a feature whose stages don't match the 4-stage shape", async () => {
    const client = fakeClient({
      title: "Build X",
      type: "feature",
      effort: "large",
      stages: [{ name: "Just do it", kind: "generic", effort: "large", delegatable_to: ["self"] }],
    });
    const res = await llmBreakdown(baseReq, client);
    expect(res!.stages.map((s) => s.name)).toEqual(["Planning", "Implementation", "Testing", "Stage Testing"]);
  });

  it("uses the LLM's stages for a non-feature task", async () => {
    const client = fakeClient({
      title: "Fix flaky login test",
      type: "bug",
      effort: "medium",
      stages: [
        { name: "Reproduce", kind: "generic", effort: "small", delegatable_to: ["self"] },
        { name: "Fix", kind: "implementation", effort: "medium", delegatable_to: ["ai_agent"] },
        { name: "Verify", kind: "testing", effort: "small", delegatable_to: ["ci"] },
      ],
    });
    const res = await llmBreakdown(baseReq, client);
    expect(res!.type).toBe("bug");
    expect(res!.stages.map((s) => s.name)).toEqual(["Reproduce", "Fix", "Verify"]);
    expect(res!.stages[2].delegatable_to).toEqual(["self", "ci"]);
  });

  it("returns null when the model yields no parsed output", async () => {
    const res = await llmBreakdown(baseReq, fakeClient(null));
    expect(res).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { llmBreakdown, buildPrompt } from "./breakdown.js";

const req = { title: "Fix login bug", model: "m", effort: "medium" as const };

describe("llmBreakdown", () => {
  it("normalizes CLI output: keeps stages + priority and ensures 'self' is delegatable", async () => {
    const run = async () => ({
      title: "Fix login",
      type: "bug",
      priority: "high",
      effort: "small",
      stages: [{ name: "Repro", kind: "generic", effort: "small", delegatable_to: ["ai_agent"] }],
    });
    const res = await llmBreakdown(req, run);
    expect(res.title).toBe("Fix login");
    expect(res.type).toBe("bug");
    expect(res.suggestedPriority).toBe("high");
    expect(res.stages[0].delegatable_to).toContain("self");
  });

  it("falls back to a single generic stage when the model returns none", async () => {
    const run = async () => ({ title: "Quick note", type: "chore", priority: "low", effort: "small", stages: [] });
    const res = await llmBreakdown(req, run);
    expect(res.stages).toHaveLength(1);
    expect(res.stages[0].kind).toBe("generic");
  });

  it("honors a forced type over the model's classification", async () => {
    const run = async () => ({ title: "T", type: "bug", priority: "medium", effort: "small", stages: [{ name: "s", kind: "generic", effort: "small", delegatable_to: ["self"] }] });
    const res = await llmBreakdown({ ...req, forcedType: "chore" }, run);
    expect(res.type).toBe("chore");
  });
});

describe("intent handling", () => {
  const stages = [{ name: "s", kind: "generic", effort: "small", delegatable_to: ["self"] }];

  it("forces type=feature when intent is feature", async () => {
    const run = async () => ({ title: "T", type: "chore", priority: "medium", effort: "small", stages });
    const res = await llmBreakdown({ ...req, intent: "feature" }, run);
    expect(res.type).toBe("feature");
  });

  it("coerces a feature classification to chore when intent is task", async () => {
    const run = async () => ({ title: "T", type: "feature", priority: "medium", effort: "small", stages });
    const res = await llmBreakdown({ ...req, intent: "task" }, run);
    expect(res.type).toBe("chore");
  });

  it("buildPrompt asks for the 3-stage feature flow and the feature intent line", () => {
    const p = buildPrompt({ ...req, intent: "feature" });
    expect(p).toMatch(/Planning/);
    expect(p).toMatch(/Implementation/);
    expect(p).toMatch(/Testing/);
    expect(p).toMatch(/FEATURE/);
  });

  it("buildPrompt marks a task-intent capture as a simple task", () => {
    const p = buildPrompt({ ...req, intent: "task" });
    expect(p).toMatch(/simple TASK/);
  });
});

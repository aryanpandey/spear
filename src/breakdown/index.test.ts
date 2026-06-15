import { describe, it, expect } from "vitest";
import { breakdownForAdd } from "./index.js";

const base = { model: "m", effort: "medium" as const };

// Fake Claude CLI runner returning a canned breakdown JSON.
const fakeRun = async () => ({
  title: "Cleaned title",
  type: "bug",
  priority: "high",
  effort: "small",
  stages: [{ name: "Repro", kind: "generic", effort: "small", delegatable_to: ["self"] }],
});

describe("breakdownForAdd priority resolution", () => {
  it("explicit priority always wins", async () => {
    const r = await breakdownForAdd({ title: "Fix prod outage", explicitPriority: "low", ...base }, fakeRun);
    expect(r.priority).toBe("low");
    expect(r.priorityReason).toMatch(/explicit/);
  });

  it("uses the LLM's suggested priority when none is explicit", async () => {
    const r = await breakdownForAdd({ title: "Fix prod outage", ...base }, fakeRun);
    expect(r.priority).toBe("high");
    expect(r.priorityReason).toMatch(/LLM/);
  });

  it("passes the LLM's cleaned title, type and stages through", async () => {
    const r = await breakdownForAdd({ title: "raw title", ...base }, fakeRun);
    expect(r.title).toBe("Cleaned title");
    expect(r.type).toBe("bug");
    expect(r.stages).toHaveLength(1);
  });
});

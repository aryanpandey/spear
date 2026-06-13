import { describe, it, expect } from "vitest";
import { breakdownForAdd } from "./index.js";

const base = { useLlm: false, model: "m", effort: "medium" as const };

describe("breakdownForAdd priority resolution", () => {
  it("explicit priority always wins", async () => {
    const r = await breakdownForAdd({ title: "Fix prod outage", explicitPriority: "low", ...base });
    expect(r.priority).toBe("low");
    expect(r.priorityReason).toMatch(/explicit/);
  });

  it("falls back to the heuristic when no explicit / no LLM", async () => {
    const r = await breakdownForAdd({ title: "Fix prod outage", ...base });
    expect(r.priority).toBe("critical");
    expect(r.source).toBe("deterministic");
  });

  it("a forced feature gets 4 stages + a heuristic priority", async () => {
    const r = await breakdownForAdd({ title: "Build dark mode toggle", forcedType: "feature", ...base });
    expect(r.stages).toHaveLength(4);
    expect(r.priority).toBe("medium");
  });
});

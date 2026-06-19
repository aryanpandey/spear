import { describe, it, expect } from "vitest";
import { compareLaneItems, type LaneSortable } from "./laneSort.js";

// `status` is the STAGE status (what the float keys on); the task is assumed open.
const mk = (status: string, priority: string, due: string | null): LaneSortable => ({
  task: { status: "todo", priority },
  stage: { status },
  due,
});

describe("compareLaneItems", () => {
  it("floats an in-progress stage to the top", () => {
    expect(compareLaneItems(mk("todo", "low", "2026-01-01"), mk("in_progress", "low", null))).toBeGreaterThan(0);
  });
  it("orders by due date (soonest first, undated last) among non-in-progress", () => {
    expect(compareLaneItems(mk("todo", "low", "2026-06-10"), mk("todo", "low", "2026-06-20"))).toBeLessThan(0);
    expect(compareLaneItems(mk("todo", "low", null), mk("todo", "low", "2026-06-20"))).toBeGreaterThan(0); // undated after dated
  });
  it("breaks ties by priority", () => {
    expect(compareLaneItems(mk("todo", "critical", "2026-06-10"), mk("todo", "low", "2026-06-10"))).toBeLessThan(0);
    expect(compareLaneItems(mk("todo", "high", null), mk("todo", "medium", null))).toBeLessThan(0);
  });
});

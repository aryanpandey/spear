import { describe, it, expect } from "vitest";
import { replanDatesForLane, type LaneForDating } from "./replanDates.js";

const opts = { model: "m", effort: "medium" as const };
const lane: LaneForDating = {
  lane: 0,
  tasks: [
    { task_id: 1, title: "a", type: "chore", priority: "high", effort: "small" },
    { task_id: 2, title: "b", type: "feature", priority: "medium", effort: "large" },
  ],
};

describe("replanDatesForLane", () => {
  it("returns validated dates keyed by task id", async () => {
    const run = async () => ({ dates: [{ task_id: 1, date: "2026-06-17" }, { task_id: 2, date: "2026-06-19" }] });
    const out = await replanDatesForLane("2026-06-17", lane, opts, run);
    expect(out).toEqual([{ taskId: 1, date: "2026-06-17" }, { taskId: 2, date: "2026-06-19" }]);
  });

  it("drops unparseable and past dates", async () => {
    const run = async () => ({ dates: [{ task_id: 1, date: "nope" }, { task_id: 2, date: "2026-06-10" }] });
    const out = await replanDatesForLane("2026-06-17", lane, opts, run);
    expect(out).toHaveLength(0);
  });
});

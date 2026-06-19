import { describe, it, expect } from "vitest";
import { replanDatesGlobal, type StageForDating } from "./replanDates.js";

const opts = { model: "m", effort: "medium" as const };
const stages: StageForDating[] = [
  { stage_id: 10, task_id: 1, task_title: "a", stage_name: "Plan", type: "chore", priority: "high", effort: "small", seq: 0 },
  { stage_id: 11, task_id: 1, task_title: "a", stage_name: "Impl", type: "chore", priority: "high", effort: "large", seq: 1 },
];

describe("replanDatesGlobal", () => {
  it("returns validated dates keyed by stage id", async () => {
    const run = async () => ({ dates: [{ stage_id: 10, date: "2026-06-17" }, { stage_id: 11, date: "2026-06-19" }] });
    const out = await replanDatesGlobal("2026-06-17", stages, 3, opts, run);
    expect(out).toEqual([{ stageId: 10, date: "2026-06-17" }, { stageId: 11, date: "2026-06-19" }]);
  });

  it("drops unparseable and past dates", async () => {
    const run = async () => ({ dates: [{ stage_id: 10, date: "nope" }, { stage_id: 11, date: "2026-06-10" }] });
    const out = await replanDatesGlobal("2026-06-17", stages, 3, opts, run);
    expect(out).toHaveLength(0);
  });

  it("passes the capacity into the prompt", async () => {
    let seen = "";
    const run = async (prompt: string) => {
      seen = prompt;
      return { dates: [] };
    };
    await replanDatesGlobal("2026-06-17", stages, 5, opts, run);
    expect(seen).toContain("about 5 steps per day");
  });
});

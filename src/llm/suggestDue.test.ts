import { describe, it, expect } from "vitest";
import { suggestDueDates, type DueSnapshotTask } from "./suggestDue.js";

const opts = { model: "m", effort: "low" as const };
const tasks: DueSnapshotTask[] = [
  { id: 1, title: "ship", type: "feature", priority: "high", status: "todo", effort: "large", due: null, stageCount: 3 },
  { id: 2, title: "note", type: "chore", priority: "low", status: "todo", effort: "small", due: null, stageCount: 1 },
];

describe("suggestDueDates", () => {
  it("returns valid future-dated suggestions keyed by task id", async () => {
    const run = async () => ({
      suggestions: [
        { task_id: 1, date: "2026-06-18", reason: "high priority feature" },
        { task_id: 2, date: "2026-06-25", reason: "low priority, defer" },
      ],
    });
    const out = await suggestDueDates("2026-06-16", tasks, opts, run);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ taskId: 1, date: "2026-06-18", reason: "high priority feature" });
  });

  it("drops malformed, past, and unknown-task suggestions", async () => {
    const run = async () => ({
      suggestions: [
        { task_id: 1, date: "not-a-date", reason: "bad" },
        { task_id: 2, date: "2026-06-01", reason: "in the past" },
        { task_id: 99, date: "2026-06-20", reason: "unknown task" },
      ],
    });
    const out = await suggestDueDates("2026-06-16", tasks, opts, run);
    expect(out).toHaveLength(0);
  });

  it("accepts a same-day (today) suggestion", async () => {
    const run = async () => ({ suggestions: [{ task_id: 1, date: "2026-06-16", reason: "do today" }] });
    const out = await suggestDueDates("2026-06-16", tasks, opts, run);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-06-16");
  });
});

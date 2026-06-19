import { describe, it, expect } from "vitest";
import { replanDatesGlobal, type TaskForDating } from "./replanDates.js";

const opts = { model: "m", effort: "medium" as const };
const tasks: TaskForDating[] = [
  { task_id: 1, title: "a", type: "chore", priority: "high", effort: "small" },
  { task_id: 2, title: "b", type: "feature", priority: "medium", effort: "large" },
];

describe("replanDatesGlobal", () => {
  it("returns validated dates keyed by task id", async () => {
    const run = async () => ({ dates: [{ task_id: 1, date: "2026-06-17" }, { task_id: 2, date: "2026-06-19" }] });
    const out = await replanDatesGlobal("2026-06-17", tasks, 3, opts, run);
    expect(out).toEqual([{ taskId: 1, date: "2026-06-17" }, { taskId: 2, date: "2026-06-19" }]);
  });

  it("drops unparseable and past dates", async () => {
    const run = async () => ({ dates: [{ task_id: 1, date: "nope" }, { task_id: 2, date: "2026-06-10" }] });
    const out = await replanDatesGlobal("2026-06-17", tasks, 3, opts, run);
    expect(out).toHaveLength(0);
  });

  it("passes the capacity into the prompt", async () => {
    let seen = "";
    const run = async (prompt: string) => {
      seen = prompt;
      return { dates: [] };
    };
    await replanDatesGlobal("2026-06-17", tasks, 5, opts, run);
    expect(seen).toContain("about 5 tasks per day");
  });
});

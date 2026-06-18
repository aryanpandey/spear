import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { addTask } from "../service.js";
import { redateCurrentPlan } from "./redatePass.js";

function makeStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}
function planItem(task_id: number, stage_id: number, lane: number, order: number) {
  return { task_id, stage_id, lane, order_in_lane: order, executor_id: null, is_delegation_candidate: false, scheduled_state: "start_now" as const, rationale: "" };
}

describe("redateCurrentPlan", () => {
  it("clamps within-lane dates non-decreasing, skips done, reports progress", async () => {
    const store = makeStore();
    const a = addTask(store, { title: "a", stages: [{ name: "s", kind: "generic" }] });
    const b = addTask(store, { title: "b", stages: [{ name: "s", kind: "generic" }] });
    const c = addTask(store, { title: "c", stages: [{ name: "s", kind: "generic" }] });
    const done = addTask(store, { title: "done", stages: [{ name: "s", kind: "generic" }] });
    store.updateTask(done.task.id, { status: "done" });
    store.savePlan(
      { plan_date: "2026-06-17", trigger: "manual", narrative: "", model: "m" },
      [
        planItem(a.task.id, a.stages[0].id, 0, 0),
        planItem(b.task.id, b.stages[0].id, 0, 1),
        planItem(done.task.id, done.stages[0].id, 0, 2),
        planItem(c.task.id, c.stages[0].id, 1, 0),
      ],
    );
    // out-of-order: lane-0 second task (b) earlier than first (a) → must clamp up to a's date
    const planned: Record<number, string> = { [a.task.id]: "2026-06-20", [b.task.id]: "2026-06-18", [c.task.id]: "2026-06-19" };
    const run = async (prompt: string) => ({
      dates: Object.entries(planned)
        .filter(([id]) => prompt.includes(`"task_id":${id}`))
        .map(([id, date]) => ({ task_id: Number(id), date })),
    });
    const progress: Array<[number, number]> = [];
    const n = await redateCurrentPlan(store, DEFAULT_CONFIG, (d, t) => progress.push([d, t]), run);

    expect(store.getTask(a.task.id)!.due).toBe("2026-06-20");
    expect(store.getTask(b.task.id)!.due).toBe("2026-06-20"); // clamped, not 2026-06-18
    expect(store.getTask(c.task.id)!.due).toBe("2026-06-19");
    expect(store.getTask(done.task.id)!.due).toBeNull(); // done task skipped
    expect(n).toBe(3);
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]); // (0,total) then per-lane
  });

  it("returns 0 when there is no current plan", async () => {
    const store = makeStore();
    const run = async () => ({ dates: [] });
    expect(await redateCurrentPlan(store, DEFAULT_CONFIG, undefined, run)).toBe(0);
  });

  it("dates higher-priority tasks earlier within a lane, regardless of plan order", async () => {
    const store = makeStore();
    const low = addTask(store, { title: "low", priority: "low", stages: [{ name: "s", kind: "generic" }] });
    const high = addTask(store, { title: "high", priority: "critical", stages: [{ name: "s", kind: "generic" }] });
    store.savePlan(
      { plan_date: "2026-06-18", trigger: "manual", narrative: "", model: "m" },
      [planItem(low.task.id, low.stages[0].id, 0, 0), planItem(high.task.id, high.stages[0].id, 0, 1)],
    );
    const planned: Record<number, string> = { [low.task.id]: "2026-06-22", [high.task.id]: "2026-06-19" };
    const run = async (prompt: string) => ({
      dates: Object.entries(planned)
        .filter(([id]) => prompt.includes(`"task_id":${id}`))
        .map(([id, date]) => ({ task_id: Number(id), date })),
    });
    await redateCurrentPlan(store, DEFAULT_CONFIG, undefined, run);
    expect(store.getTask(high.task.id)!.due).toBe("2026-06-19"); // critical sorted first → its date
    expect(store.getTask(low.task.id)!.due).toBe("2026-06-22"); // clamped ≥ the critical date
    expect(store.getTask(high.task.id)!.due! <= store.getTask(low.task.id)!.due!).toBe(true);
  });
});

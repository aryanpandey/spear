import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { addTask } from "../service.js";
import { todayLocal, addDaysLocal } from "../util/time.js";
import { redateCurrentPlan } from "./redatePass.js";

function makeStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}
function planItem(task_id: number, stage_id: number, lane: number, order: number) {
  return { task_id, stage_id, lane, order_in_lane: order, executor_id: null, is_delegation_candidate: false, scheduled_state: "start_now" as const, rationale: "" };
}
// A fake runner that echoes a fixed id→date map, only for the tasks present in the prompt.
function runnerFor(planned: Record<number, string>) {
  return async (prompt: string) => ({
    dates: Object.entries(planned)
      .filter(([id]) => prompt.includes(`"task_id":${id}`))
      .map(([id, date]) => ({ task_id: Number(id), date })),
  });
}

describe("redateCurrentPlan", () => {
  const today = todayLocal();

  it("clamps dates globally non-decreasing, skips done, reports start/end progress", async () => {
    const store = makeStore();
    const a = addTask(store, { title: "a", stages: [{ name: "s", kind: "generic" }] });
    const b = addTask(store, { title: "b", stages: [{ name: "s", kind: "generic" }] });
    const c = addTask(store, { title: "c", stages: [{ name: "s", kind: "generic" }] });
    const done = addTask(store, { title: "done", stages: [{ name: "s", kind: "generic" }] });
    store.updateTask(done.task.id, { status: "done" });
    store.savePlan(
      { plan_date: today, trigger: "manual", narrative: "", model: "m" },
      [
        planItem(a.task.id, a.stages[0].id, 0, 0),
        planItem(b.task.id, b.stages[0].id, 0, 1),
        planItem(done.task.id, done.stages[0].id, 0, 2),
        planItem(c.task.id, c.stages[0].id, 1, 0),
      ],
    );
    // Equal priority → global order is plan order a, b, c. b earlier than a → clamps up; c kept.
    const planned = { [a.task.id]: addDaysLocal(today, 1), [b.task.id]: today, [c.task.id]: addDaysLocal(today, 3) };
    const progress: Array<[number, number]> = [];
    const n = await redateCurrentPlan(store, DEFAULT_CONFIG, (d, t) => progress.push([d, t]), runnerFor(planned));

    expect(store.getTask(a.task.id)!.due).toBe(addDaysLocal(today, 1));
    expect(store.getTask(b.task.id)!.due).toBe(addDaysLocal(today, 1)); // clamped up, not `today`
    expect(store.getTask(c.task.id)!.due).toBe(addDaysLocal(today, 3));
    expect(store.getTask(done.task.id)!.due).toBeNull(); // done task skipped
    expect(n).toBe(3);
    expect(progress).toEqual([[0, 1], [1, 1]]); // single global call: start then end
  });

  it("returns 0 when there is no current plan", async () => {
    const store = makeStore();
    expect(await redateCurrentPlan(store, DEFAULT_CONFIG, undefined, runnerFor({}))).toBe(0);
  });

  it("dates higher-priority tasks earlier ACROSS lanes (global, not per-lane)", async () => {
    const store = makeStore();
    const low = addTask(store, { title: "low", priority: "low", stages: [{ name: "s", kind: "generic" }] });
    const high = addTask(store, { title: "high", priority: "critical", stages: [{ name: "s", kind: "generic" }] });
    store.savePlan(
      { plan_date: today, trigger: "manual", narrative: "", model: "m" },
      [planItem(low.task.id, low.stages[0].id, 0, 0), planItem(high.task.id, high.stages[0].id, 1, 0)],
    );
    const planned = { [low.task.id]: addDaysLocal(today, 3), [high.task.id]: today };
    await redateCurrentPlan(store, DEFAULT_CONFIG, undefined, runnerFor(planned));
    expect(store.getTask(high.task.id)!.due).toBe(today); // critical sorted first → its early date
    expect(store.getTask(low.task.id)!.due).toBe(addDaysLocal(today, 3));
    expect(store.getTask(high.task.id)!.due! <= store.getTask(low.task.id)!.due!).toBe(true);
  });

  it("falls back to a deterministic capacity schedule when the LLM call throws", async () => {
    const store = makeStore();
    const t0 = addTask(store, { title: "t0", stages: [{ name: "s", kind: "generic" }] });
    const t1 = addTask(store, { title: "t1", stages: [{ name: "s", kind: "generic" }] });
    const t2 = addTask(store, { title: "t2", stages: [{ name: "s", kind: "generic" }] });
    store.savePlan(
      { plan_date: today, trigger: "manual", narrative: "", model: "m" },
      [
        planItem(t0.task.id, t0.stages[0].id, 0, 0),
        planItem(t1.task.id, t1.stages[0].id, 0, 1),
        planItem(t2.task.id, t2.stages[0].id, 0, 2),
      ],
    );
    const cfg = { ...DEFAULT_CONFIG, dailyTaskCapacity: 1 }; // one task per day
    const boom = async () => {
      throw new Error("llm down");
    };
    const n = await redateCurrentPlan(store, cfg, undefined, boom);
    expect(n).toBe(3);
    expect(store.getTask(t0.task.id)!.due).toBe(today);
    expect(store.getTask(t1.task.id)!.due).toBe(addDaysLocal(today, 1));
    expect(store.getTask(t2.task.id)!.due).toBe(addDaysLocal(today, 2));
  });
});

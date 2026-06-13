import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { addTask, blockTask } from "../service.js";
import { buildAndSavePlan } from "./build.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}

describe("buildAndSavePlan (deterministic, no API key)", () => {
  it("persists a current plan with lanes for each open flow", async () => {
    const store = freshStore();
    const a = addTask(store, { title: "Build login", type: "feature", priority: "high" }).task;
    const b = addTask(store, { title: "Renew cert", type: "chore", priority: "low" }).task;
    blockTask(store, b.id, a.id);

    const { plan, usedLlm } = await buildAndSavePlan(store, {
      trigger: "manual",
      useLlm: false,
      model: "claude-opus-4-8",
      effort: "high",
      maxLanes: 8,
    });

    expect(usedLlm).toBe(false);
    expect(plan.is_current).toBe(true);
    expect(store.getCurrentPlan()!.id).toBe(plan.id);

    const items = store.getPlanItems(plan.id);
    const lanes = new Set(items.map((i) => i.lane));
    expect(lanes.size).toBe(2); // one lane per open flow

    const aFirst = items.find((i) => i.task_id === a.id && i.order_in_lane === 0)!;
    const bFirst = items.find((i) => i.task_id === b.id && i.order_in_lane === 0)!;
    expect(aFirst.scheduled_state).toBe("start_now");
    expect(bFirst.scheduled_state).toBe("waiting");
  });

  it("regenerating replaces the current plan", async () => {
    const store = freshStore();
    addTask(store, { title: "T1", type: "chore" });
    const first = await buildAndSavePlan(store, { trigger: "manual", useLlm: false, model: "m", effort: "high", maxLanes: 8 });
    const second = await buildAndSavePlan(store, { trigger: "manual", useLlm: false, model: "m", effort: "high", maxLanes: 8 });
    expect(second.plan.id).not.toBe(first.plan.id);
    expect(store.getCurrentPlan()!.id).toBe(second.plan.id);
    expect(store.getPlan(first.plan.id)!.is_current).toBe(false);
  });
});

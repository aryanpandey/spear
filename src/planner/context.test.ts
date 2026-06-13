import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { addTask, blockTask } from "../service.js";
import { buildPlannerInput, plannerExecutors } from "./context.js";
import { deterministicPlan } from "./graph.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}

describe("buildPlannerInput + deterministicPlan integration", () => {
  it("turns a live board into a deterministic plan with the Me executor", () => {
    const store = freshStore();
    const a = addTask(store, { title: "Build login", type: "feature", priority: "high" }).task;
    const b = addTask(store, { title: "Polish copy", type: "chore", priority: "low" }).task;
    blockTask(store, b.id, a.id); // b waits on a

    const planInput = buildPlannerInput(store);
    const execs = plannerExecutors(store);
    expect(execs[0].kind).toBe("self");

    const { items, narrative } = deterministicPlan(planInput, execs);
    // a's first stage (Planning) starts now; b is blocked → not start_now
    const aFirst = items.find((i) => i.task_id === a.id && i.order_in_lane === 0)!;
    const bFirst = items.find((i) => i.task_id === b.id && i.order_in_lane === 0)!;
    expect(aFirst.scheduled_state).toBe("start_now");
    expect(bFirst.scheduled_state).toBe("waiting");
    // every item assigned to the seeded Me executor
    expect(items.every((i) => i.executor_id === execs[0].id)).toBe(true);
    // feature stages include delegatable ones
    expect(items.some((i) => i.is_delegation_candidate)).toBe(true);
    expect(narrative).toMatch(/open flow/);
  });
});

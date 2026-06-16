import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "./index.js";
import { Store } from "./store.js";

function freshStore(): Store {
  return new Store(openDb(":memory:"));
}

describe("Store", () => {
  let store: Store;
  beforeEach(() => {
    store = freshStore();
  });

  it("creates and reads back a task", () => {
    const t = store.createTask({ title: "Build feature X", priority: "high", type: "feature" });
    expect(t.id).toBeGreaterThan(0);
    expect(t.priority).toBe("high");
    expect(t.status).toBe("todo");
    const fetched = store.getTask(t.id);
    expect(fetched?.title).toBe("Build feature X");
  });

  it("stores and parses stage JSON fields in seq order", () => {
    const t = store.createTask({ title: "F", type: "feature" });
    store.addStage({ task_id: t.id, name: "Implementation", kind: "implementation", seq: 1, delegatable_to: ["ai_agent", "self"] });
    store.addStage({ task_id: t.id, name: "Planning", kind: "planning", seq: 0 });
    const stages = store.getStages(t.id);
    expect(stages.map((s) => s.name)).toEqual(["Planning", "Implementation"]);
    expect(stages[1].delegatable_to).toEqual(["ai_agent", "self"]);
  });

  it("seeds the Me executor only once", () => {
    store.seedDefaults();
    store.seedDefaults();
    const execs = store.listExecutors();
    expect(execs).toHaveLength(1);
    expect(execs[0]).toMatchObject({ name: "Me", kind: "self", active: true });
    expect(execs[0].handles).toContain("implementation");
  });

  it("records and reads task dependencies, ignoring duplicates", () => {
    const a = store.createTask({ title: "A" });
    const b = store.createTask({ title: "B" });
    store.addDependency(b.id, a.id);
    store.addDependency(b.id, a.id); // dup
    expect(store.blockedBy(b.id)).toEqual([a.id]);
    expect(store.listDependencies()).toHaveLength(1);
  });

  it("saves a plan with items and marks it current", () => {
    const t = store.createTask({ title: "F", type: "feature" });
    const s = store.addStage({ task_id: t.id, name: "Planning", kind: "planning", seq: 0 });
    const plan = store.savePlan(
      { plan_date: "2026-06-13", trigger: "manual", narrative: "do it", model: "claude-opus-4-8" },
      [
        {
          task_id: t.id,
          stage_id: s.id,
          lane: 0,
          order_in_lane: 0,
          executor_id: null,
          is_delegation_candidate: true,
          scheduled_state: "start_now",
          rationale: "top priority",
        },
      ],
    );
    expect(plan.is_current).toBe(true);
    const current = store.getCurrentPlan();
    expect(current?.id).toBe(plan.id);
    const items = store.getPlanItems(plan.id);
    expect(items).toHaveLength(1);
    expect(items[0].is_delegation_candidate).toBe(true);
    expect(items[0].scheduled_state).toBe("start_now");
  });
});

describe("suggested due", () => {
  it("stores and returns a suggested due date + reason", () => {
    const store = freshStore();
    const t = store.createTask({ title: "x" });
    store.setSuggestedDue(t.id, "2026-06-20", "high priority, light load that day");
    const got = store.getTask(t.id)!;
    expect(got.suggested_due).toBe("2026-06-20");
    expect(got.suggested_due_reason).toBe("high priority, light load that day");
  });

  it("defaults to null for a fresh task", () => {
    const store = freshStore();
    const t = store.createTask({ title: "y" });
    expect(store.getTask(t.id)!.suggested_due).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { addTask } from "../service.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { buildAndSavePlan } from "./build.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}

describe("buildAndSavePlan", () => {
  it("persists the plan the LLM (CLI) returns", async () => {
    const store = freshStore();
    const { task, stages } = addTask(store, { title: "Build login", stages: [{ name: "Impl", kind: "implementation" }] });
    const exec = store.listExecutors(true)[0];
    const run = async () => ({
      narrative: "Go.",
      lanes: [
        {
          lane: 0,
          executor_id: exec.id,
          items: [{ task_id: task.id, stage_id: stages[0].id, order: 0, is_delegation_candidate: false, scheduled_state: "start_now", rationale: "r" }],
        },
      ],
    });
    const { plan, error } = await buildAndSavePlan(store, DEFAULT_CONFIG, "manual", run);
    expect(error).toBeUndefined();
    expect(plan).not.toBeNull();
    const items = store.getPlanItems(plan!.id);
    expect(items).toHaveLength(1);
    expect(items[0].scheduled_state).toBe("start_now");
  });

  it("keeps a ready flow the LLM dropped (no vanishing tasks on re-plan)", async () => {
    const store = freshStore();
    const kept = addTask(store, { title: "Planned", stages: [{ name: "Impl", kind: "implementation" }] });
    const dropped = addTask(store, { title: "In progress work", stages: [{ name: "Impl", kind: "implementation" }] });
    store.updateTask(dropped.task.id, { status: "in_progress" });
    const exec = store.listExecutors(true)[0];
    // The LLM places only the first task, omitting the in-progress one.
    const run = async () => ({
      narrative: "n",
      lanes: [
        {
          lane: 0,
          executor_id: exec.id,
          items: [{ task_id: kept.task.id, stage_id: kept.stages[0].id, order: 0, is_delegation_candidate: false, scheduled_state: "start_now", rationale: "r" }],
        },
      ],
    });
    const { plan } = await buildAndSavePlan(store, DEFAULT_CONFIG, "manual", run);
    const items = store.getPlanItems(plan!.id);
    const stageIds = items.map((it) => it.stage_id);
    expect(stageIds).toContain(kept.stages[0].id);
    expect(stageIds).toContain(dropped.stages[0].id); // backfilled, not lost
    const backfilled = items.find((it) => it.stage_id === dropped.stages[0].id)!;
    expect(backfilled.scheduled_state).toBe("start_now"); // its task is in_progress
  });

  it("does not overwrite the current plan when the LLM fails", async () => {
    const store = freshStore();
    addTask(store, { title: "X", stages: [{ name: "s", kind: "generic" }] });
    const failing = async () => {
      throw new Error("cli down");
    };
    const { plan, error } = await buildAndSavePlan(store, DEFAULT_CONFIG, "manual", failing);
    expect(error).toMatch(/cli down/);
    expect(plan).toBeNull(); // no prior plan existed
    expect(store.getCurrentPlan()).toBeUndefined();
  });
});

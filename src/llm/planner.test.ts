import { describe, it, expect } from "vitest";
import { llmPlan } from "./planner.js";
import type { PlanContext } from "../planner/context.js";

const ctx: PlanContext = {
  date: "2026-06-15",
  executors: [{ id: 1, name: "Me", kind: "self", capacity: 1, handles: [] }],
  flows: [
    {
      taskId: 1,
      title: "Build login",
      type: "feature",
      priority: "high",
      status: "todo",
      due: null,
      openBlockers: [],
      stages: [{ stageId: 10, name: "Impl", kind: "implementation", effort: "medium", status: "todo", delegatable_to: ["self"] }],
    },
  ],
};

describe("llmPlan", () => {
  it("maps lanes to plan items and drops items with invalid stage ids", async () => {
    const run = async () => ({
      narrative: "Do login.",
      lanes: [
        {
          lane: 0,
          executor_id: 1,
          items: [
            { task_id: 1, stage_id: 10, order: 0, is_delegation_candidate: false, scheduled_state: "start_now", rationale: "first" },
            { task_id: 1, stage_id: 999, order: 1, is_delegation_candidate: false, scheduled_state: "waiting", rationale: "bad id" },
          ],
        },
      ],
    });
    const res = await llmPlan(ctx, { model: "m" }, new Set([10]), run);
    expect(res).not.toBeNull();
    expect(res!.narrative).toBe("Do login.");
    expect(res!.items).toHaveLength(1); // stage 999 filtered out
    expect(res!.items[0]).toMatchObject({ task_id: 1, stage_id: 10, lane: 0, scheduled_state: "start_now" });
  });

  it("returns null when no valid items remain", async () => {
    const run = async () => ({
      narrative: "x",
      lanes: [{ lane: 0, executor_id: null, items: [{ task_id: 1, stage_id: 999, order: 0, is_delegation_candidate: false, scheduled_state: "waiting", rationale: "r" }] }],
    });
    const res = await llmPlan(ctx, { model: "m" }, new Set([10]), run);
    expect(res).toBeNull();
  });
});

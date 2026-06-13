import { describe, it, expect } from "vitest";
import { llmPlan } from "./planner.js";
import type { ParseClient } from "./client.js";
import type { PlanContext } from "../planner/context.js";

function fakeClient(parsed_output: unknown): ParseClient {
  return { messages: { parse: async () => ({ parsed_output }) } };
}

const ctx: PlanContext = {
  date: "2026-06-13",
  executors: [{ id: 1, name: "Me", kind: "self", capacity: 1, handles: ["implementation"] }],
  flows: [
    {
      taskId: 10,
      title: "Build login",
      type: "feature",
      priority: "high",
      status: "todo",
      ready: true,
      criticalPath: 12,
      openBlockers: [],
      stages: [{ stageId: 100, name: "Planning", kind: "planning", effort: "small", status: "todo", delegatable_to: ["self", "ai_agent"] }],
    },
  ],
};

describe("llmPlan", () => {
  it("flattens lanes to plan items, keeping only valid stage ids", async () => {
    const client = fakeClient({
      narrative: "Kick off planning; delegate impl to an agent.",
      lanes: [
        {
          lane: 0,
          executor_id: 1,
          items: [
            { task_id: 10, stage_id: 100, order: 0, is_delegation_candidate: true, scheduled_state: "start_now", rationale: "highest priority" },
            { task_id: 10, stage_id: 999, order: 1, is_delegation_candidate: false, scheduled_state: "waiting", rationale: "stale" },
          ],
        },
      ],
    });
    const res = await llmPlan(ctx, { model: "claude-opus-4-8", effort: "high" }, client, new Set([100]));
    expect(res).not.toBeNull();
    expect(res!.items).toHaveLength(1); // 999 filtered out
    expect(res!.items[0]).toMatchObject({ task_id: 10, stage_id: 100, lane: 0, order_in_lane: 0, executor_id: 1, is_delegation_candidate: true, scheduled_state: "start_now" });
    expect(res!.narrative).toMatch(/delegate/i);
  });

  it("returns null when no items survive validation", async () => {
    const client = fakeClient({ narrative: "x", lanes: [{ lane: 0, executor_id: 1, items: [{ task_id: 10, stage_id: 999, order: 0, is_delegation_candidate: false, scheduled_state: "start_now", rationale: "" }] }] });
    const res = await llmPlan(ctx, { model: "claude-opus-4-8", effort: "high" }, client, new Set([100]));
    expect(res).toBeNull();
  });
});

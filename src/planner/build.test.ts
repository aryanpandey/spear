import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { addTask } from "../service.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { buildAndSavePlan, separateCriticalLanes } from "./build.js";
import type { PlanItemInput } from "../db/store.js";

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

// ---- helpers for separateCriticalLanes ----
let sid = 0;
function item(task_id: number, lane: number, order_in_lane: number, extra: Partial<PlanItemInput> = {}): PlanItemInput {
  return {
    task_id,
    stage_id: ++sid,
    lane,
    order_in_lane,
    executor_id: null,
    is_delegation_candidate: false,
    scheduled_state: "waiting",
    rationale: "r",
    ...extra,
  };
}
const laneOf = (out: PlanItemInput[], taskId: number) => out.find((i) => i.task_id === taskId)!.lane;
function maxCriticalsPerLane(out: PlanItemInput[], crit: Set<number>): number {
  const m = new Map<number, Set<number>>();
  for (const i of out) {
    if (!crit.has(i.task_id)) continue;
    if (!m.has(i.lane)) m.set(i.lane, new Set());
    m.get(i.lane)!.add(i.task_id);
  }
  return Math.max(0, ...[...m.values()].map((s) => s.size));
}

describe("separateCriticalLanes", () => {
  it("splits two distinct critical tasks sharing a lane when capacity exists", () => {
    const out = separateCriticalLanes([item(1, 0, 0), item(2, 0, 1)], new Set([1, 2]), 6);
    expect(laneOf(out, 1)).not.toBe(laneOf(out, 2));
    expect(maxCriticalsPerLane(out, new Set([1, 2]))).toBe(1);
  });

  it("leaves a single critical task's multiple stages in one lane (sub-tasks allowed)", () => {
    const input = [item(1, 0, 0), item(1, 0, 1), item(1, 0, 2)];
    const out = separateCriticalLanes(input, new Set([1]), 6);
    expect(out).toHaveLength(3);
    expect(out.every((i) => i.lane === 0)).toBe(true);
  });

  it("separates criticals but never moves non-critical work", () => {
    const out = separateCriticalLanes(
      [item(1, 0, 0), item(2, 0, 1), item(3, 0, 2)],
      new Set([1, 2]),
      6,
    );
    expect(laneOf(out, 1)).not.toBe(laneOf(out, 2));
    expect(laneOf(out, 3)).toBe(0); // non-critical stays put
    expect(maxCriticalsPerLane(out, new Set([1, 2]))).toBe(1);
  });

  it("distributes evenly when there are more criticals than lanes", () => {
    const crit = new Set([1, 2, 3, 4, 5]);
    const input = [item(1, 0, 0), item(2, 0, 1), item(3, 0, 2), item(4, 0, 3), item(5, 0, 4)];
    const out = separateCriticalLanes(input, crit, 2);
    const lanesUsed = new Set(out.map((i) => i.lane));
    expect(lanesUsed.size).toBeLessThanOrEqual(2);
    expect(maxCriticalsPerLane(out, crit)).toBeLessThanOrEqual(Math.ceil(5 / 2)); // 3
  });

  it("is a no-op on an already-compliant plan (idempotent)", () => {
    const crit = new Set([1, 2]);
    const input = [item(1, 0, 0), item(2, 1, 0)];
    const once = separateCriticalLanes(input, crit, 6);
    const twice = separateCriticalLanes(once, crit, 6);
    expect(laneOf(once, 1)).toBe(0);
    expect(laneOf(once, 2)).toBe(1);
    expect(twice).toEqual(once);
  });

  it("consolidates a critical task the LLM split across two lanes", () => {
    const crit = new Set([1, 2]);
    const out = separateCriticalLanes(
      [item(1, 0, 0), item(1, 1, 0), item(2, 1, 1)],
      crit,
      6,
    );
    expect(new Set(out.filter((i) => i.task_id === 1).map((i) => i.lane)).size).toBe(1);
    expect(maxCriticalsPerLane(out, crit)).toBe(1);
  });

  it("renumbers order_in_lane contiguously per lane with critical blocks at the head", () => {
    const crit = new Set([1, 2]);
    // task 1 (critical, 2 stages) + task 3 (non-critical) start in lane 0; task 2 (critical) also in lane 0.
    const out = separateCriticalLanes(
      [item(1, 0, 0), item(1, 0, 1), item(3, 0, 2), item(2, 0, 3)],
      crit,
      6,
    );
    for (const lane of new Set(out.map((i) => i.lane))) {
      const orders = out
        .filter((i) => i.lane === lane)
        .map((i) => i.order_in_lane)
        .sort((a, b) => a - b);
      expect(orders).toEqual(orders.map((_, idx) => idx)); // contiguous 0..n-1, no gaps/dupes
      if (out.some((i) => i.lane === lane && crit.has(i.task_id))) {
        const head = out.find((i) => i.lane === lane && i.order_in_lane === 0)!;
        expect(crit.has(head.task_id)).toBe(true); // a lane with a critical has a critical at its head
      }
    }
    const t1 = out.filter((i) => i.task_id === 1).sort((a, b) => a.order_in_lane - b.order_in_lane);
    expect(t1.map((i) => i.order_in_lane)).toEqual([0, 1]); // stages contiguous at the head
    expect(new Set(t1.map((i) => i.lane)).size).toBe(1); // and in one lane
  });

  it("doubles criticals into the single lane when maxLanes is 1", () => {
    const out = separateCriticalLanes([item(1, 0, 0), item(2, 0, 1)], new Set([1, 2]), 1);
    expect(out.every((i) => i.lane === 0)).toBe(true);
    expect(out.map((i) => i.order_in_lane).sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it("pulls a critical whose lane is out of range back into [0, maxLanes)", () => {
    const crit = new Set([1, 2]);
    const out = separateCriticalLanes([item(1, 0, 0), item(2, 5, 0)], crit, 2);
    expect(out.every((i) => i.lane < 2)).toBe(true);
    expect(laneOf(out, 1)).not.toBe(laneOf(out, 2));
  });
});

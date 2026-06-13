import { describe, it, expect } from "vitest";
import { buildPlannerGraph, deterministicPlan, type PlannerInput, type PlannerStage } from "./graph.js";
import type { Effort, ExecutorKind, Priority } from "../types.js";

let stageId = 0;
function stage(
  effort: Effort,
  opts: { status?: string; delegatable_to?: ExecutorKind[]; seq?: number } = {},
): PlannerStage {
  return {
    id: ++stageId,
    seq: opts.seq ?? 0,
    status: opts.status ?? "todo",
    effort,
    kind: "generic",
    delegatable_to: opts.delegatable_to ?? ["self"],
  };
}

function input(
  tasks: { id: number; priority?: Priority; status?: string; title?: string; due?: string | null; stages: PlannerStage[] }[],
  deps: [number, number][] = [],
): PlannerInput {
  const stages = new Map<number, PlannerStage[]>();
  for (const t of tasks) stages.set(t.id, t.stages);
  return {
    tasks: tasks.map((t) => ({ id: t.id, priority: t.priority ?? "medium", status: (t.status ?? "todo") as any, title: t.title, due: t.due })),
    stages,
    deps: deps.map(([task_id, blocked_by_task_id]) => ({ task_id, blocked_by_task_id })),
  };
}

function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("buildPlannerGraph", () => {
  it("marks tasks with no open blockers ready and others waiting", () => {
    const g = buildPlannerGraph(
      input(
        [
          { id: 1, stages: [stage("small")] },
          { id: 2, stages: [stage("medium")] },
          { id: 3, stages: [stage("small")] },
        ],
        [[2, 1]], // 2 blocked-by 1
      ),
    );
    expect(g.ready).toContain(1);
    expect(g.ready).toContain(3);
    expect(g.waiting).toEqual([2]);
    expect(g.nodes.get(2)!.openBlockers).toEqual([1]);
  });

  it("treats blockers that are done as satisfied", () => {
    const g = buildPlannerGraph(
      input(
        [
          { id: 1, status: "done", stages: [stage("small", { status: "done" })] },
          { id: 2, stages: [stage("medium")] },
        ],
        [[2, 1]],
      ),
    );
    // task 1 is done so excluded; task 2 has no *open* blockers → ready
    expect(g.nodes.has(1)).toBe(false);
    expect(g.ready).toEqual([2]);
  });

  it("topologically orders blockers before dependents", () => {
    const g = buildPlannerGraph(
      input(
        [
          { id: 1, stages: [stage("small")] },
          { id: 2, stages: [stage("small")] },
          { id: 3, stages: [stage("small")] },
        ],
        [
          [2, 1],
          [3, 2],
        ],
      ),
    );
    expect(g.cycle).toBeNull();
    expect(g.topoOrder.indexOf(1)).toBeLessThan(g.topoOrder.indexOf(2));
    expect(g.topoOrder.indexOf(2)).toBeLessThan(g.topoOrder.indexOf(3));
  });

  it("detects a dependency cycle", () => {
    const g = buildPlannerGraph(
      input(
        [
          { id: 1, stages: [stage("small")] },
          { id: 2, stages: [stage("small")] },
        ],
        [
          [1, 2],
          [2, 1],
        ],
      ),
    );
    expect(g.cycle).not.toBeNull();
    expect(g.cycle).toEqual([1, 2]);
  });

  it("computes critical path as remaining effort plus the worst blocker chain", () => {
    // 1(small=1) blocks 2(large=8); 2's critical path = 8 + 1 = 9
    const g = buildPlannerGraph(
      input(
        [
          { id: 1, stages: [stage("small")] },
          { id: 2, stages: [stage("large")] },
        ],
        [[2, 1]],
      ),
    );
    expect(g.nodes.get(1)!.criticalPath).toBe(1);
    expect(g.nodes.get(2)!.criticalPath).toBe(9);
  });

  it("orders ready tasks by priority then critical path", () => {
    const g = buildPlannerGraph(
      input([
        { id: 1, priority: "low", stages: [stage("small")] },
        { id: 2, priority: "critical", stages: [stage("small")] },
        { id: 3, priority: "high", stages: [stage("large")] },
        { id: 4, priority: "high", stages: [stage("small")] },
      ]),
    );
    // critical first; then the two highs ordered by longer critical path (3 before 4); low last
    expect(g.ready).toEqual([2, 3, 4, 1]);
  });
});

describe("deterministicPlan", () => {
  const execs = [{ id: 1, kind: "self" as ExecutorKind }];

  it("makes one lane per open flow with the next stage start_now", () => {
    const planInput = input([
      { id: 1, priority: "high", stages: [stage("small", { seq: 0 }), stage("medium", { seq: 1 })] },
    ]);
    const { items } = deterministicPlan(planInput, execs);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ lane: 0, order_in_lane: 0, scheduled_state: "start_now", executor_id: 1 });
    expect(items[1]).toMatchObject({ lane: 0, order_in_lane: 1, scheduled_state: "waiting" });
  });

  it("groups similar-titled flows into one lane, ordered design → implementation", () => {
    const { items } = deterministicPlan(
      input([
        { id: 1, priority: "high", title: "Collection Brain Implementation", stages: [stage("medium")] },
        { id: 2, priority: "high", title: "Collection Brain Design", stages: [stage("small")] },
        { id: 3, priority: "high", title: "Unrelated billing fix", stages: [stage("small")] },
      ]),
      execs,
    );
    // Two lanes: the Collection Brain pair + the unrelated singleton.
    expect(new Set(items.map((i) => i.lane)).size).toBe(2);
    // Within the grouped lane, Design (#2) precedes Implementation (#1).
    const grouped = items.filter((i) => i.task_id === 1 || i.task_id === 2).sort((a, b) => a.order_in_lane - b.order_in_lane);
    expect(grouped[0].task_id).toBe(2);
    expect(grouped[1].task_id).toBe(1);
    expect(grouped[0].lane).toBe(grouped[1].lane);
  });

  it("floats overdue / due-today tasks to the top of their lane", () => {
    const { items } = deterministicPlan(
      input([
        { id: 1, title: "Search Ranking", due: dayOffset(30), stages: [stage("small")] }, // far
        { id: 2, title: "Search Indexing", due: dayOffset(-1), stages: [stage("small")] }, // overdue
        { id: 3, title: "Search Relevance", due: dayOffset(0), stages: [stage("small")] }, // today
        { id: 4, title: "Alpha unrelated one", stages: [stage("small")] },
        { id: 5, title: "Beta unrelated two", stages: [stage("small")] },
        { id: 6, title: "Gamma unrelated three", stages: [stage("small")] },
      ]),
      execs,
    );
    const searchItems = items
      .filter((i) => [1, 2, 3].includes(i.task_id))
      .sort((a, b) => a.order_in_lane - b.order_in_lane);
    expect(new Set(searchItems.map((i) => i.lane)).size).toBe(1); // one Search lane
    expect(searchItems.map((i) => i.task_id)).toEqual([2, 3, 1]); // overdue, today, then far
  });

  it("flags delegatable stages and marks blocked flows waiting", () => {
    const planInput = input(
      [
        { id: 1, priority: "high", stages: [stage("small", { delegatable_to: ["self", "ai_agent"] })] },
        { id: 2, priority: "high", stages: [stage("small", { delegatable_to: ["self"] })] },
      ],
      [[2, 1]],
    );
    const { items, narrative } = deterministicPlan(planInput, execs);
    const lane0 = items.filter((i) => i.task_id === 1);
    const lane1 = items.filter((i) => i.task_id === 2);
    expect(lane0[0].is_delegation_candidate).toBe(true);
    expect(lane0[0].scheduled_state).toBe("start_now");
    // task 2 is blocked → its first stage is not start_now
    expect(lane1[0].scheduled_state).toBe("waiting");
    expect(narrative).toMatch(/could be delegated/);
  });
});

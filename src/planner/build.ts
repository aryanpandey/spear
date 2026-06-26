import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { DailyPlan, PlanTrigger } from "../types.js";
import { todayLocal } from "../util/time.js";
import { buildPlanContext, openStageIds, type PlanContext } from "./context.js";
import { llmPlan } from "../llm/planner.js";
import type { PlanItemInput } from "../db/store.js";
import type { ClaudeRunner } from "../llm/cli.js";

export interface BuildResult {
  /** The new plan, or the previous current plan when the LLM failed. */
  plan: DailyPlan | null;
  /** Set when the LLM planner failed; the current plan was left untouched. */
  error?: string;
}

/**
 * Re-planning must never silently lose work: when the LLM squeezes flows into
 * fewer lanes it can drop some, which makes those tasks vanish from the board even
 * though they still exist. This appends any ready flow's open stages the planner
 * omitted into an existing lane (a sibling stage's lane, else the least-loaded one),
 * so every ready, unblocked task stays on Today. Blocked flows may be left out.
 */
export function backfillReadyStages(context: PlanContext, items: PlanItemInput[]): PlanItemInput[] {
  const expected: { stageId: number; taskId: number; inProgress: boolean }[] = [];
  for (const f of context.flows) {
    if (f.openBlockers.length > 0) continue; // blocked flows legitimately wait
    for (const s of f.stages) expected.push({ stageId: s.stageId, taskId: f.taskId, inProgress: f.status === "in_progress" });
  }
  const placed = new Set(items.map((it) => it.stage_id));
  const missing = expected.filter((e) => !placed.has(e.stageId));
  if (missing.length === 0) return items;

  const laneByTask = new Map<number, number>();
  const laneCounts = new Map<number, number>();
  for (const it of items) {
    laneByTask.set(it.task_id, it.lane);
    laneCounts.set(it.lane, (laneCounts.get(it.lane) ?? 0) + 1);
  }
  const leastLoadedLane = (): number => {
    let best = 0;
    let bestCount = Infinity;
    for (const [lane, count] of laneCounts) if (count < bestCount) ((best = lane), (bestCount = count));
    return best;
  };

  const out = [...items];
  for (const { stageId, taskId, inProgress } of missing) {
    const lane = laneByTask.get(taskId) ?? leastLoadedLane();
    const order = laneCounts.get(lane) ?? 0;
    laneCounts.set(lane, order + 1);
    laneByTask.set(taskId, lane);
    out.push({
      task_id: taskId,
      stage_id: stageId,
      lane,
      order_in_lane: order,
      executor_id: null,
      is_delegation_candidate: false,
      scheduled_state: inProgress ? "start_now" : "waiting",
      rationale: "(kept on the board — not placed by the planner)",
    });
  }
  return out;
}

/**
 * Hard rule: no two DISTINCT critical tasks may share a lane. The multiple stages
 * of a single critical task (its "sub-tasks") may share a lane freely. When there
 * are more critical tasks than lanes (`maxLanes`), doubling up is unavoidable, so
 * criticals are spread across the available lanes as evenly as possible.
 *
 * Pure and idempotent (f(f(x)) == f(x)): an already-separated, head-ordered plan is returned with identical values; never drops or duplicates items.
 */
export function separateCriticalLanes(
  items: PlanItemInput[],
  criticalTaskIds: Set<number>,
  maxLanes: number,
): PlanItemInput[] {
  const isCritical = (taskId: number) => criticalTaskIds.has(taskId);

  const presentCritical = [...new Set(items.filter((it) => isCritical(it.task_id)).map((it) => it.task_id))];
  if (presentCritical.length <= 1) return items; // 0 or 1 critical task — nothing to separate
  if (maxLanes < 1) return items; // degenerate: no lanes to assign into

  // Original position of each item (stage_id is unique) — for stable ordering after moves.
  const origPos = new Map<number, { lane: number; order: number }>();
  for (const it of items) origPos.set(it.stage_id, { lane: it.lane, order: it.order_in_lane });

  // Each critical task's current head (lowest lane, then lowest order).
  const head = new Map<number, { lane: number; order: number }>();
  for (const it of items) {
    if (!isCritical(it.task_id)) continue;
    const cur = head.get(it.task_id);
    if (!cur || it.lane < cur.lane || (it.lane === cur.lane && it.order_in_lane < cur.order)) {
      head.set(it.task_id, { lane: it.lane, order: it.order_in_lane });
    }
  }

  // Assign each critical task one target lane, most-prominent (lowest head) first.
  const assignOrder = [...presentCritical].sort((a, b) => {
    const ha = head.get(a)!;
    const hb = head.get(b)!;
    return ha.lane - hb.lane || ha.order - hb.order || a - b;
  });
  const criticalsInLane = new Map<number, number>();
  for (let l = 0; l < maxLanes; l++) criticalsInLane.set(l, 0);
  const target = new Map<number, number>();
  for (const taskId of assignOrder) {
    const cur = head.get(taskId)!.lane;
    let lane: number;
    if (cur < maxLanes && criticalsInLane.get(cur) === 0) {
      lane = cur; // keep it where it is — no churn
    } else {
      lane = 0;
      let fewest = Infinity;
      for (let l = 0; l < maxLanes; l++) {
        const c = criticalsInLane.get(l)!;
        if (c < fewest) {
          fewest = c;
          lane = l;
        }
      }
    }
    target.set(taskId, lane);
    criticalsInLane.set(lane, criticalsInLane.get(lane)! + 1);
  }

  // Move every critical task's items to its target lane; non-critical items stay.
  const moved = items.map((it) =>
    target.has(it.task_id) ? { ...it, lane: target.get(it.task_id)! } : it,
  );

  // Renumber order_in_lane per lane: critical blocks at the head, each task kept
  // contiguous, ordered stably by original position.
  const byLane = new Map<number, PlanItemInput[]>();
  for (const it of moved) {
    const arr = byLane.get(it.lane) ?? [];
    arr.push(it);
    byLane.set(it.lane, arr);
  }
  const blockKey = (laneItems: PlanItemInput[], taskId: number) => {
    let best = { lane: Infinity, order: Infinity };
    for (const it of laneItems) {
      if (it.task_id !== taskId) continue;
      const p = origPos.get(it.stage_id)!;
      if (p.lane < best.lane || (p.lane === best.lane && p.order < best.order)) best = p;
    }
    return best;
  };
  const out: PlanItemInput[] = [];
  for (const lane of [...byLane.keys()].sort((a, b) => a - b)) {
    const laneItems = byLane.get(lane)!;
    const taskIds = [...new Set(laneItems.map((it) => it.task_id))];
    taskIds.sort((a, b) => {
      const ca = isCritical(a) ? 0 : 1;
      const cb = isCritical(b) ? 0 : 1;
      if (ca !== cb) return ca - cb; // critical blocks first
      const ka = blockKey(laneItems, a);
      const kb = blockKey(laneItems, b);
      return ka.lane - kb.lane || ka.order - kb.order || a - b;
    });
    let order = 0;
    for (const taskId of taskIds) {
      const stages = laneItems
        .filter((it) => it.task_id === taskId)
        .sort((x, y) => {
          const px = origPos.get(x.stage_id)!;
          const py = origPos.get(y.stage_id)!;
          return px.lane - py.lane || px.order - py.order;
        });
      for (const it of stages) out.push({ ...it, order_in_lane: order++ });
    }
  }
  return out;
}

/**
 * Build today's execution flow entirely via the Claude CLI and persist it.
 * There is no deterministic fallback: on any failure the existing current plan
 * is left untouched and the error is returned.
 */
export async function buildAndSavePlan(
  store: Store,
  cfg: SpearConfig,
  trigger: PlanTrigger,
  run?: ClaudeRunner,
): Promise<BuildResult> {
  try {
    const context = buildPlanContext(store, todayLocal());
    const res = await llmPlan(
      context,
      { model: cfg.models.planner, effort: cfg.effort.planner, maxLanes: cfg.maxLanes },
      openStageIds(store),
      run,
    );
    if (!res || res.items.length === 0) {
      return { plan: store.getCurrentPlan() ?? null, error: "planner returned no actionable items" };
    }
    // Guard against the LLM dropping flows when folding into fewer lanes.
    const items = backfillReadyStages(context, res.items);
    if (items.length > res.items.length) {
      process.stderr.write(`spear: re-plan kept ${items.length - res.items.length} flow(s) the planner omitted\n`);
    }
    // Hard rule: no two distinct critical tasks share a lane (unless we run out of lanes).
    const criticalTaskIds = new Set(context.flows.filter((f) => f.priority === "critical").map((f) => f.taskId));
    const laneBefore = new Map(items.map((it) => [it.stage_id, it.lane]));
    const separated = separateCriticalLanes(items, criticalTaskIds, cfg.maxLanes);
    const relocated = separated.filter((it) => laneBefore.get(it.stage_id) !== it.lane).length;
    if (relocated > 0) {
      process.stderr.write(`spear: re-plan moved ${relocated} item(s) to keep critical tasks in separate lanes\n`);
    }
    const plan = store.savePlan(
      { plan_date: todayLocal(), trigger, narrative: res.narrative, model: cfg.models.planner },
      separated,
    );
    return { plan };
  } catch (err) {
    return { plan: store.getCurrentPlan() ?? null, error: err instanceof Error ? err.message : String(err) };
  }
}

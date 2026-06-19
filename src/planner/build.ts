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
    const plan = store.savePlan(
      { plan_date: todayLocal(), trigger, narrative: res.narrative, model: cfg.models.planner },
      items,
    );
    return { plan };
  } catch (err) {
    return { plan: store.getCurrentPlan() ?? null, error: err instanceof Error ? err.message : String(err) };
  }
}

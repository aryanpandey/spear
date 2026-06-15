import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { DailyPlan, PlanTrigger } from "../types.js";
import { todayLocal } from "../util/time.js";
import { buildPlanContext, openStageIds } from "./context.js";
import { llmPlan } from "../llm/planner.js";
import type { ClaudeRunner } from "../llm/cli.js";

export interface BuildResult {
  /** The new plan, or the previous current plan when the LLM failed. */
  plan: DailyPlan | null;
  /** Set when the LLM planner failed; the current plan was left untouched. */
  error?: string;
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
    const plan = store.savePlan(
      { plan_date: todayLocal(), trigger, narrative: res.narrative, model: cfg.models.planner },
      res.items,
    );
    return { plan };
  } catch (err) {
    return { plan: store.getCurrentPlan() ?? null, error: err instanceof Error ? err.message : String(err) };
  }
}

import type { Store } from "../db/store.js";
import type { DailyPlan, PlanTrigger } from "../types.js";
import { todayLocal } from "../util/time.js";
import { hasApiKey } from "../llm/client.js";
import { deterministicPlan } from "./graph.js";
import { buildPlanContext, buildPlannerInput, openStageIds, plannerExecutors } from "./context.js";

export interface BuildPlanOpts {
  trigger: PlanTrigger;
  useLlm: boolean;
  model: string;
  effort: "low" | "medium" | "high" | "max";
  maxLanes: number;
}

export interface BuildPlanResult {
  plan: DailyPlan;
  usedLlm: boolean;
}

/**
 * Build and persist the current execution flow. Always computes the
 * deterministic plan; refines it with the LLM when available and requested.
 */
export async function buildAndSavePlan(store: Store, opts: BuildPlanOpts): Promise<BuildPlanResult> {
  const det = deterministicPlan(buildPlannerInput(store), plannerExecutors(store), opts.maxLanes);
  let items = det.items;
  let narrative = det.narrative;
  let model: string | null = null;
  let usedLlm = false;

  if (opts.useLlm && hasApiKey()) {
    try {
      const { llmPlan } = await import("../llm/planner.js");
      const context = buildPlanContext(store, todayLocal());
      const res = await llmPlan(
        context,
        { model: opts.model, effort: opts.effort, maxLanes: opts.maxLanes },
        undefined,
        openStageIds(store),
      );
      if (res && res.items.length) {
        items = res.items;
        narrative = res.narrative;
        model = opts.model;
        usedLlm = true;
      }
    } catch (err) {
      process.stderr.write(
        `spear: LLM planning failed (${err instanceof Error ? err.message : String(err)}); using deterministic plan.\n`,
      );
    }
  }

  const plan = store.savePlan(
    { plan_date: todayLocal(), trigger: opts.trigger, narrative, model },
    items,
  );
  return { plan, usedLlm };
}

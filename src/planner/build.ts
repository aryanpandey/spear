import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { DailyPlan, PlanTrigger } from "../types.js";
import { todayLocal } from "../util/time.js";
import { hasApiKey } from "../llm/client.js";
import { deterministicPlan, type PlanMode } from "./graph.js";
import type { PlanItemInput } from "../db/store.js";
import { buildPlanContext, buildPlannerInput, openStageIds, plannerExecutors } from "./context.js";

export interface BuildPlanOpts {
  trigger: PlanTrigger;
  useLlm: boolean;
  model: string;
  effort: "low" | "medium" | "high" | "max";
  maxLanes: number;
  /** 'full' re-clusters lanes; 'incremental' keeps them sticky. Default 'full'. */
  mode?: PlanMode;
}

export interface BuildPlanResult {
  plan: DailyPlan;
  usedLlm: boolean;
}

const LANE_EPOCH = "lane_epoch";

function loadExistingLanes(store: Store): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of store.listOpenTasks()) if (t.lane != null) m.set(t.id, t.lane);
  return m;
}

function membershipFromItems(items: PlanItemInput[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const it of items) if (!m.has(it.task_id)) m.set(it.task_id, it.lane);
  return m;
}

function persistMembership(store: Store, membership: Map<number, number>, stampEpoch: boolean): void {
  for (const [id, lane] of membership) store.setTaskLane(id, lane);
  if (stampEpoch) store.setMeta(LANE_EPOCH, todayLocal());
}

/** Incremental is promoted to full if no lanes were assigned today yet (e.g. no morning run). */
function effectiveMode(store: Store, mode: PlanMode): PlanMode {
  if (mode === "incremental" && store.getMeta(LANE_EPOCH) !== todayLocal()) return "full";
  return mode;
}

/**
 * Synchronous, deterministic, sticky plan for ad-hoc changes: keeps existing
 * lanes, slots in new tasks, persists membership, saves + returns the plan. No LLM.
 */
export function saveStickyPlan(store: Store, cfg: SpearConfig, trigger: PlanTrigger): DailyPlan {
  const mode = effectiveMode(store, "incremental");
  const det = deterministicPlan(buildPlannerInput(store), plannerExecutors(store), cfg.maxLanes, {
    mode,
    existingLanes: mode === "incremental" ? loadExistingLanes(store) : new Map(),
  });
  persistMembership(store, det.membership, mode === "full");
  return store.savePlan(
    { plan_date: todayLocal(), trigger, narrative: det.narrative, model: null },
    det.items,
  );
}

/**
 * Build + persist the plan. Defaults to a FULL re-cluster (morning / `spear plan`)
 * and refines with the LLM when available; pass mode 'incremental' for sticky ad-hoc.
 */
export async function buildAndSavePlan(store: Store, opts: BuildPlanOpts): Promise<BuildPlanResult> {
  const mode = effectiveMode(store, opts.mode ?? "full");
  const det = deterministicPlan(buildPlannerInput(store), plannerExecutors(store), opts.maxLanes, {
    mode,
    existingLanes: mode === "incremental" ? loadExistingLanes(store) : new Map(),
  });

  let items = det.items;
  let narrative = det.narrative;
  let membership = det.membership;
  let model: string | null = null;
  let usedLlm = false;

  // The LLM regroups, so only let it run on a full re-cluster (keeps ad-hoc sticky).
  if (mode === "full" && opts.useLlm && hasApiKey()) {
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
        membership = membershipFromItems(items);
        model = opts.model;
        usedLlm = true;
      }
    } catch (err) {
      process.stderr.write(
        `spear: LLM planning failed (${err instanceof Error ? err.message : String(err)}); using deterministic plan.\n`,
      );
    }
  }

  persistMembership(store, membership, mode === "full");
  const plan = store.savePlan(
    { plan_date: todayLocal(), trigger: opts.trigger, narrative, model },
    items,
  );
  return { plan, usedLlm };
}

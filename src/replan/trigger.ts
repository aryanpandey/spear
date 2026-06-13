import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { todayLocal } from "../util/time.js";
import { deterministicPlan } from "../planner/graph.js";
import { buildPlannerInput, plannerExecutors } from "../planner/context.js";

/**
 * After a CLI mutation, keep the plan + dashboard in sync:
 *  - if a server is running, hand off (it re-plans, refines with the LLM, and
 *    pushes the update to any open browser over SSE);
 *  - otherwise persist a fresh deterministic plan inline so `today`/`serve`
 *    show the latest.
 */
export async function triggerReplan(store: Store, cfg: SpearConfig): Promise<"server" | "inline"> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 400);
    const res = await fetch(`http://127.0.0.1:${cfg.port}/internal/replan`, {
      method: "POST",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) return "server";
  } catch {
    /* no server listening — fall through to inline */
  }

  const det = deterministicPlan(buildPlannerInput(store), plannerExecutors(store), cfg.maxLanes);
  store.savePlan(
    { plan_date: todayLocal(), trigger: "adhoc", narrative: det.narrative, model: null },
    det.items,
  );
  return "inline";
}

/**
 * Ask a running server to broadcast a refresh WITHOUT re-planning — used after
 * a plan has already been persisted (e.g. the morning job) so an open dashboard
 * reloads it without clobbering it.
 */
export async function pingRefresh(port: number): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 400);
    await fetch(`http://127.0.0.1:${port}/internal/refresh`, { method: "POST", signal: ctrl.signal });
    clearTimeout(t);
  } catch {
    /* no server running */
  }
}

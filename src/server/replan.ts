import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { PlanTrigger } from "../types.js";
import { saveStickyPlan } from "../planner/build.js";
import type { SseHub } from "./sse.js";

/**
 * Owns plan regeneration for the running server. Ad-hoc changes do an instant,
 * deterministic, STICKY re-plan (existing lanes stay put, the new task slots in)
 * and broadcast — no LLM re-grouping mid-day, so the day doesn't reshuffle. The
 * heavy LLM grouping happens at the morning / `spear plan` full re-cluster.
 */
export class Replanner {
  constructor(
    private readonly store: Store,
    private readonly hub: SseHub,
    private readonly cfg: SpearConfig,
  ) {}

  requestReplan(trigger: PlanTrigger = "adhoc"): void {
    saveStickyPlan(this.store, this.cfg, trigger);
    this.hub.broadcast({ type: "update", source: "sticky" });
  }

  dispose(): void {
    /* no timers to clean up */
  }
}

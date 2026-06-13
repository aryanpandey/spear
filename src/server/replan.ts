import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { PlanTrigger } from "../types.js";
import { todayLocal } from "../util/time.js";
import { hasApiKey } from "../llm/client.js";
import { deterministicPlan } from "../planner/graph.js";
import { buildPlannerInput, plannerExecutors } from "../planner/context.js";
import { buildAndSavePlan } from "../planner/build.js";
import type { SseHub } from "./sse.js";

/**
 * Owns plan regeneration for the running server: an INSTANT deterministic
 * re-insert on every change (broadcast immediately), then a DEBOUNCED LLM
 * refinement so rapid ad-hoc adds don't fire an LLM call each.
 */
export class Replanner {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly hub: SseHub,
    private readonly cfg: SpearConfig,
  ) {}

  /** Mutations call this. Instant deterministic plan + broadcast; debounce LLM refine. */
  requestReplan(trigger: PlanTrigger = "adhoc"): void {
    const det = deterministicPlan(buildPlannerInput(this.store), plannerExecutors(this.store), this.cfg.maxLanes);
    this.store.savePlan(
      { plan_date: todayLocal(), trigger, narrative: det.narrative, model: null },
      det.items,
    );
    this.hub.broadcast({ type: "update", source: "deterministic" });

    if (hasApiKey()) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.refine(trigger);
      }, this.cfg.replanDebounceMs);
      this.timer.unref?.();
    }
  }

  private async refine(trigger: PlanTrigger): Promise<void> {
    try {
      const { usedLlm } = await buildAndSavePlan(this.store, {
        trigger,
        useLlm: true,
        model: this.cfg.models.planner,
        effort: this.cfg.effort.planner,
        maxLanes: this.cfg.maxLanes,
      });
      this.hub.broadcast({ type: "update", source: usedLlm ? "llm" : "deterministic" });
    } catch {
      /* deterministic plan already persisted; ignore refine failure */
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

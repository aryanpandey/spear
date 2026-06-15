import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { PlanTrigger } from "../types.js";
import { buildAndSavePlan } from "../planner/build.js";
import type { SseHub } from "./sse.js";

/**
 * Owns plan regeneration for the running server. Every change kicks off an
 * LLM (Claude CLI) re-plan in the background and broadcasts when it finishes,
 * so the triggering mutation returns immediately and the dashboard updates over
 * SSE a few seconds later. On planner failure the current plan is left intact.
 */
export class Replanner {
  constructor(
    private readonly store: Store,
    private readonly hub: SseHub,
    private readonly cfg: SpearConfig,
  ) {}

  requestReplan(trigger: PlanTrigger = "adhoc"): void {
    void this.run(trigger);
  }

  private async run(trigger: PlanTrigger): Promise<void> {
    const { error } = await buildAndSavePlan(this.store, this.cfg, trigger);
    if (error) {
      process.stderr.write(`spear: re-plan failed (${error})\n`);
      this.hub.broadcast({ type: "update", source: "error", error });
    } else {
      this.hub.broadcast({ type: "update", source: "llm" });
    }
  }

  dispose(): void {
    /* no timers to clean up */
  }
}

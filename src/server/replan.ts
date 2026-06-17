import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { PlanTrigger } from "../types.js";
import { buildAndSavePlan } from "../planner/build.js";
import { runSuggestedDuePass } from "./suggestDuePass.js";
import { redateCurrentPlan } from "./redatePass.js";
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

  /** Re-decide completion dates on the current lanes (button). */
  requestRedate(): void {
    void this.redate();
  }

  /** Re-plan the lanes (e.g. after a lane-count change), then re-date them. */
  requestReplanThenRedate(): void {
    void this.replanThenRedate();
  }

  private async run(trigger: PlanTrigger): Promise<void> {
    // Tell open dashboards a re-plan started so they can show progress; the LLM
    // call takes ~30-60s. The matching "end" fires when the plan is persisted.
    this.hub.broadcast({ type: "replan", phase: "start" });
    const { error } = await buildAndSavePlan(this.store, this.cfg, trigger);
    if (error) process.stderr.write(`spear: re-plan failed (${error})\n`);
    this.hub.broadcast({ type: "replan", phase: "end", ...(error ? { error } : {}) });
    void this.refreshSuggestedDue();
  }

  private async redate(): Promise<void> {
    this.hub.broadcast({ type: "redate", phase: "start", done: 0, total: 0 });
    try {
      await redateCurrentPlan(this.store, this.cfg, (done, total) =>
        this.hub.broadcast({ type: "redate", phase: "progress", done, total }),
      );
    } catch (err) {
      process.stderr.write(`spear: redate failed (${err instanceof Error ? err.message : String(err)})\n`);
    }
    this.hub.broadcast({ type: "redate", phase: "end", done: 0, total: 0 });
    this.hub.broadcast({ type: "update", source: "refresh" });
  }

  private async replanThenRedate(): Promise<void> {
    this.hub.broadcast({ type: "replan", phase: "start" });
    const { error } = await buildAndSavePlan(this.store, this.cfg, "manual");
    if (error) process.stderr.write(`spear: re-plan failed (${error})\n`);
    this.hub.broadcast({ type: "replan", phase: "end", ...(error ? { error } : {}) });
    void this.refreshSuggestedDue();
    if (!error) await this.redate();
  }

  /** Background, best-effort: recompute stored due-date suggestions for undated tasks. */
  async refreshSuggestedDue(): Promise<void> {
    try {
      const n = await runSuggestedDuePass(this.store, this.cfg);
      if (n > 0) this.hub.broadcast({ type: "update", source: "refresh" });
    } catch (err) {
      process.stderr.write(`spear: suggested-due pass failed (${err instanceof Error ? err.message : String(err)})\n`);
    }
  }

  dispose(): void {
    /* no timers to clean up */
  }
}

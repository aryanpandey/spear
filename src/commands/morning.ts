import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { buildAndSavePlan } from "../planner/build.js";
import { renderPlan } from "../planner/render.js";
import { pingRefresh } from "../replan/trigger.js";
import { notify } from "../notify/macos.js";

/** Build the day's plan and notify. This is what the launchd job runs at 8am. */
export function buildMorningSummary(narrative: string, lanes: number, nowCount: number): string {
  const firstSentence = narrative.split(/(?<=[.!?])\s/)[0] ?? narrative;
  const counts = `${lanes} lane(s), ${nowCount} to start now`;
  const body = `${counts}. ${firstSentence}`.trim();
  return body.length > 200 ? body.slice(0, 197) + "…" : body;
}

export function registerMorning(program: Command): void {
  program
    .command("morning")
    .description("Regenerate today's plan and send a desktop notification (run by the launchd job)")
    .option("--no-llm", "deterministic plan only")
    .action(async (opts: { llm: boolean }) => {
      const cfg = loadConfig();
      const store = openStore();
      try {
        const { plan } = await buildAndSavePlan(store, {
          trigger: "morning",
          useLlm: opts.llm !== false,
          model: cfg.models.planner,
          effort: cfg.effort.planner,
          maxLanes: cfg.maxLanes,
        });
        const items = store.getPlanItems(plan.id);
        const lanes = new Set(items.map((i) => i.lane)).size;
        const nowCount = items.filter((i) => i.scheduled_state === "start_now").length;

        const url = `http://127.0.0.1:${cfg.port}/today`;
        await notify("spear · today's plan is ready", buildMorningSummary(plan.narrative, lanes, nowCount), url);
        await pingRefresh(cfg.port); // refresh an open dashboard without clobbering the plan

        console.log(renderPlan(store));
      } finally {
        store.db.close();
      }
    });
}

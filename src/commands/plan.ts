import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { buildAndSavePlan } from "../planner/build.js";
import { renderPlan } from "../planner/render.js";
import { PLAN_TRIGGERS, type PlanTrigger } from "../types.js";
import { assertEnum } from "../util/validate.js";
import { c } from "../util/render.js";

interface PlanOpts {
  llm: boolean;
  trigger: string;
}

export function registerPlan(program: Command): void {
  program
    .command("plan")
    .description("Regenerate today's execution flow (LLM if available) and make it current")
    .option("--no-llm", "use the deterministic planner only")
    .option("--trigger <trigger>", "morning|adhoc|manual", "manual")
    .action(async (opts: PlanOpts) => {
      const trigger = assertEnum("trigger", opts.trigger, PLAN_TRIGGERS) as PlanTrigger;
      const cfg = loadConfig();
      const store = openStore();
      try {
        const { plan, usedLlm } = await buildAndSavePlan(store, {
          trigger,
          useLlm: opts.llm !== false,
          model: cfg.models.planner,
          effort: cfg.effort.planner,
          maxLanes: cfg.maxLanes,
        });
        console.log(renderPlan(store, plan));
        if (!usedLlm && opts.llm !== false && !process.env.ANTHROPIC_API_KEY) {
          console.log(c.dim("\nhint: set ANTHROPIC_API_KEY for LLM-optimized planning"));
        }
      } finally {
        store.db.close();
      }
    });
}

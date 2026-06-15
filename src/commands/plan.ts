import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { buildAndSavePlan } from "../planner/build.js";
import { renderPlan } from "../planner/render.js";
import { PLAN_TRIGGERS, type PlanTrigger } from "../types.js";
import { assertEnum } from "../util/validate.js";
import { c } from "../util/render.js";

export function registerPlan(program: Command): void {
  program
    .command("plan")
    .description("Regenerate today's execution flow via the Claude CLI and make it current")
    .option("--trigger <trigger>", "morning|adhoc|manual", "manual")
    .action(async (opts: { trigger: string }) => {
      const trigger = assertEnum("trigger", opts.trigger, PLAN_TRIGGERS) as PlanTrigger;
      const cfg = loadConfig();
      const store = openStore();
      try {
        const { plan, error } = await buildAndSavePlan(store, cfg, trigger);
        if (error && !plan) {
          console.error(c.red(`planning failed: ${error}`));
          process.exitCode = 1;
          return;
        }
        if (error) console.log(c.dim(`(planner error: ${error}; showing the previous plan)`));
        console.log(renderPlan(store));
      } finally {
        store.db.close();
      }
    });
}

import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { renderPlan } from "../planner/render.js";
import { buildTimeOpts } from "../planner/timefit.js";
import { c } from "../util/render.js";

export function registerToday(program: Command): void {
  program
    .command("today")
    .description("Show the current execution flow")
    .option("--hours <n>", "hours left today (overrides workday-end for time-fit)")
    .action((opts: { hours?: string }) => {
      const cfg = loadConfig();
      const store = openStore();
      try {
        if (!store.getCurrentPlan()) {
          console.log(c.dim("no current plan — run `spear plan` to generate one."));
          return;
        }
        const hours = opts.hours != null ? Number(opts.hours) : undefined;
        console.log(renderPlan(store, buildTimeOpts(cfg.effortMinutes, cfg.workdayEnd, hours)));
      } finally {
        store.db.close();
      }
    });
}

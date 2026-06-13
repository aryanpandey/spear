import type { Command } from "commander";
import { openStore } from "../context.js";
import { renderPlan } from "../planner/render.js";
import { c } from "../util/render.js";

export function registerToday(program: Command): void {
  program
    .command("today")
    .description("Show the current execution flow")
    .action(() => {
      const store = openStore();
      try {
        if (!store.getCurrentPlan()) {
          console.log(c.dim("no current plan — run `spear plan` to generate one."));
          return;
        }
        console.log(renderPlan(store));
      } finally {
        store.db.close();
      }
    });
}

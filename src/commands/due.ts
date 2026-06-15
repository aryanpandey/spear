import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { setTaskDue } from "../service.js";
import { triggerReplan } from "../replan/trigger.js";
import { c, taskOneLiner } from "../util/render.js";

export function registerDue(program: Command): void {
  program
    .command("due")
    .argument("<taskId>", "task to (re)schedule")
    .argument("<when>", "YYYY-MM-DD | +Nd | today | tomorrow | clear")
    .description("Set or change a task's deadline (use 'clear' to remove it)")
    .action(async (taskIdRaw: string, when: string) => {
      const store = openStore();
      try {
        const task = setTaskDue(store, Number(taskIdRaw), when);
        console.log(taskOneLiner(task));
        console.log(c.dim(task.due ? `  due ${task.due}` : "  deadline cleared"));
        await triggerReplan(store, loadConfig());
      } catch (err) {
        console.error(c.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      } finally {
        store.db.close();
      }
    });
}

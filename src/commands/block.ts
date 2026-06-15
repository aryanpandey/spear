import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { blockTask, unblockTask } from "../service.js";
import { pingRefresh } from "../replan/trigger.js";
import { c, taskOneLiner } from "../util/render.js";

export function registerBlock(program: Command): void {
  program
    .command("block")
    .argument("<taskId>", "task that is blocked")
    .requiredOption("--by <taskId>", "the prerequisite task")
    .description("Mark a task as blocked-by another")
    .action(async (taskIdRaw: string, opts: { by: string }) => {
      const store = openStore();
      try {
        const task = blockTask(store, Number(taskIdRaw), Number(opts.by));
        console.log(taskOneLiner(task));
        console.log(c.dim(`  now blocked-by #${opts.by}`));
        await pingRefresh(loadConfig().port); // dependency change — no re-plan
      } catch (err) {
        console.error(c.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      } finally {
        store.db.close();
      }
    });

  program
    .command("unblock")
    .argument("<taskId>", "task to unblock")
    .requiredOption("--by <taskId>", "the dependency to remove")
    .description("Remove a blocked-by dependency")
    .action(async (taskIdRaw: string, opts: { by: string }) => {
      const store = openStore();
      try {
        const task = unblockTask(store, Number(taskIdRaw), Number(opts.by));
        console.log(taskOneLiner(task));
        console.log(c.dim(`  removed blocked-by #${opts.by}`));
        await pingRefresh(loadConfig().port); // dependency change — no re-plan
      } finally {
        store.db.close();
      }
    });
}

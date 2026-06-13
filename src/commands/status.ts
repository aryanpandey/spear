import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { setTaskStatus } from "../service.js";
import { triggerReplan } from "../replan/trigger.js";
import { TASK_STATUSES } from "../types.js";
import { assertEnum } from "../util/validate.js";
import { c, taskOneLiner } from "../util/render.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .argument("<taskId>", "task id")
    .argument("<status>", "backlog|todo|in_progress|blocked|done")
    .description("Set a task's status explicitly")
    .action(async (taskIdRaw: string, statusRaw: string) => {
      const status = assertEnum("status", statusRaw, TASK_STATUSES);
      const store = openStore();
      try {
        const task = setTaskStatus(store, Number(taskIdRaw), status);
        console.log(taskOneLiner(task));
        await triggerReplan(store, loadConfig());
      } catch (err) {
        console.error(c.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      } finally {
        store.db.close();
      }
    });
}

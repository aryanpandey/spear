import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { advanceTask, completeStage, completeTask } from "../service.js";
import { triggerReplan } from "../replan/trigger.js";
import { c, taskOneLiner } from "../util/render.js";

interface DoneOpts {
  stage?: string;
  all?: boolean;
}

export function registerDone(program: Command): void {
  program
    .command("done")
    .argument("[taskId]", "task id whose flow to advance")
    .description("Advance a task's flow (complete its next stage); --all completes the whole task")
    .option("--stage <stageId>", "complete a specific stage instead")
    .option("-a, --all", "complete every stage of the task")
    .action(async (taskIdRaw: string | undefined, opts: DoneOpts) => {
      const store = openStore();
      let mutated = false;
      try {
        if (opts.stage) {
          const stage = completeStage(store, Number(opts.stage));
          const task = store.getTask(stage.task_id)!;
          console.log(`${c.green("✓")} stage ${c.bold(stage.name)} done`);
          console.log("  " + taskOneLiner(task));
          mutated = true;
        } else if (!taskIdRaw) {
          console.error(c.red("provide a taskId, or --stage <stageId>"));
          process.exitCode = 1;
        } else if (opts.all) {
          const task = completeTask(store, Number(taskIdRaw));
          console.log(`${c.green("✓")} completed all stages`);
          console.log("  " + taskOneLiner(task));
          mutated = true;
        } else {
          const { completed, task } = advanceTask(store, Number(taskIdRaw));
          if (completed) console.log(`${c.green("✓")} stage ${c.bold(completed.name)} done`);
          else console.log(c.dim("no open stages to advance"));
          console.log("  " + taskOneLiner(task));
          mutated = true;
        }
        if (mutated) await triggerReplan(store, loadConfig());
      } catch (err) {
        console.error(c.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      } finally {
        store.db.close();
      }
    });
}

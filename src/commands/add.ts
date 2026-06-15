import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { addTask } from "../service.js";
import { breakdownForAdd } from "../breakdown/index.js";
import { triggerReplan } from "../replan/trigger.js";
import { PRIORITIES, TASK_TYPES, type Priority, type TaskType } from "../types.js";
import { assertEnum, parseIds } from "../util/validate.js";
import { c, priorityColor, taskOneLiner } from "../util/render.js";

interface AddOpts {
  priority?: string;
  type?: string;
  blockedBy?: string;
  description?: string;
  due?: string;
}

export function registerAdd(program: Command): void {
  program
    .command("add")
    .argument("<title>", "what you want to do, in plain English")
    .description("Add a task; the Claude CLI breaks it down and infers priority (override with flags)")
    .option("-p, --priority <priority>", "critical|high|medium|low (otherwise the LLM infers it)")
    .option("-t, --type <type>", "feature|bug|chore|research|other (forces type, skips classification)")
    .option("-b, --blocked-by <ids>", "comma/space separated task ids this is blocked by")
    .option("-d, --description <text>", "longer description for the LLM / your notes")
    .option("--due <date>", "due date (YYYY-MM-DD)")
    .action(async (title: string, opts: AddOpts) => {
      const cfg = loadConfig();
      const explicitPriority = opts.priority
        ? (assertEnum("priority", opts.priority, PRIORITIES) as Priority)
        : undefined;
      const forcedType = opts.type ? (assertEnum("type", opts.type, TASK_TYPES) as TaskType) : undefined;
      const blockedBy = parseIds(opts.blockedBy);
      const due = opts.due ?? null;

      let broken;
      try {
        broken = await breakdownForAdd({
          title,
          description: opts.description,
          forcedType,
          model: cfg.models.breakdown,
          effort: cfg.effort.breakdown,
          due,
          explicitPriority,
        });
      } catch (err) {
        console.error(c.red(`breakdown failed (claude CLI): ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
        return;
      }

      const store = openStore();
      try {
        const { task, stages } = addTask(store, {
          title: broken.title,
          description: opts.description,
          type: broken.type,
          priority: broken.priority,
          due,
          blockedBy,
          stages: broken.stages,
        });
        console.log(taskOneLiner(task, stages[0]?.name));
        console.log(c.dim(`  breakdown → ${stages.length} stage(s): ${stages.map((s) => s.name).join(" → ")}`));
        if (!explicitPriority) {
          console.log(c.dim(`  priority: `) + priorityColor(broken.priority, broken.priority) + c.dim(` (${broken.priorityReason})`));
        }
        if (blockedBy.length) console.log(c.dim(`  blocked-by: ${blockedBy.map((b) => `#${b}`).join(", ")}`));
        await triggerReplan(store, cfg);
      } finally {
        store.db.close();
      }
    });
}

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
  task?: boolean;
  feature?: boolean;
  force?: boolean;
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
    .option("--task", "force a lean, non-feature breakdown")
    .option("--feature", "force the full feature flow (planning → implementation → testing)")
    .option("--force", "skip the duplicate-task check")
    .action(async (title: string, opts: AddOpts) => {
      const cfg = loadConfig();
      const explicitPriority = opts.priority
        ? (assertEnum("priority", opts.priority, PRIORITIES) as Priority)
        : undefined;
      const forcedType = opts.type ? (assertEnum("type", opts.type, TASK_TYPES) as TaskType) : undefined;
      const intent = opts.feature ? "feature" : opts.task ? "task" : undefined;
      const blockedBy = parseIds(opts.blockedBy);
      const due = opts.due ?? null;

      const store = openStore();
      try {
        if (!opts.force) {
          const { findDuplicates } = await import("../llm/duplicates.js");
          const existing = store.listTasks().map((t) => ({ id: t.id, title: t.title, status: t.status }));
          let dups: { candidateIndex: number; taskId: number; reason: string }[] = [];
          try {
            dups = await findDuplicates([{ title, details: opts.description }], existing, {
              model: cfg.models.duplicate,
              effort: cfg.effort.duplicate,
            });
          } catch {
            dups = []; // dup-check is best-effort; never block a capture on it
          }
          if (dups.length) {
            const byId = new Map(store.listTasks().map((t) => [t.id, t]));
            console.error(c.yellow("⚠ possible duplicate of an existing task:"));
            for (const d of dups) {
              const t = byId.get(d.taskId);
              console.error(c.yellow(`  #${d.taskId} "${t?.title ?? "?"}" (${t?.status ?? "?"}) — ${d.reason}`));
            }
            console.error(c.dim("  use --force to add it anyway"));
            process.exitCode = 1;
            return;
          }
        }

        let broken;
        try {
          broken = await breakdownForAdd({
            title,
            description: opts.description,
            forcedType,
            intent,
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

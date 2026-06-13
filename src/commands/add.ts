import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { addTask } from "../service.js";
import { breakdownForAdd } from "../breakdown/index.js";
import { triggerReplan } from "../replan/trigger.js";
import { PRIORITIES, TASK_TYPES, type Priority, type TaskType } from "../types.js";
import { assertEnum, parseIds } from "../util/validate.js";
import { c, taskOneLiner } from "../util/render.js";

interface AddOpts {
  priority?: string;
  type?: string;
  blockedBy?: string;
  description?: string;
  llm: boolean; // commander sets `llm:false` for --no-llm
}

export function registerAdd(program: Command): void {
  program
    .command("add")
    .argument("<title>", "what you want to do, in plain English")
    .description("Add a task; the LLM breaks it down (features → 4 stages, else its judgment)")
    .option("-p, --priority <priority>", "critical|high|medium|low")
    .option("-t, --type <type>", "feature|bug|chore|research|other (forces type, skips classification)")
    .option("-b, --blocked-by <ids>", "comma/space separated task ids this is blocked by")
    .option("-d, --description <text>", "longer description for the LLM / your notes")
    .option("--no-llm", "instant capture: no LLM (feature → 4 stages, else single stage)")
    .action(async (title: string, opts: AddOpts) => {
      const cfg = loadConfig();
      const priority = (opts.priority ?? cfg.defaultPriority) as Priority;
      assertEnum("priority", priority, PRIORITIES);
      const forcedType = opts.type ? assertEnum("type", opts.type, TASK_TYPES) : undefined;
      const blockedBy = parseIds(opts.blockedBy);

      const broken = await breakdownForAdd({
        title,
        description: opts.description,
        forcedType,
        useLlm: opts.llm !== false,
        model: cfg.models.breakdown,
        effort: cfg.effort.breakdown,
      });

      const store = openStore();
      try {
        const { task, stages } = addTask(store, {
          title: broken.title,
          description: opts.description,
          type: broken.type,
          priority,
          blockedBy,
          stages: broken.stages,
        });
        console.log(taskOneLiner(task, stages[0]?.name));
        console.log(c.dim(`  ${broken.source === "llm" ? "LLM" : "deterministic"} breakdown → ${stages.length} stage(s): ${stages.map((s) => s.name).join(" → ")}`));
        if (blockedBy.length) console.log(c.dim(`  blocked-by: ${blockedBy.map((b) => `#${b}`).join(", ")}`));
        if (broken.source === "deterministic" && opts.llm !== false && !forcedType && !process.env.ANTHROPIC_API_KEY) {
          console.log(c.dim("  hint: set ANTHROPIC_API_KEY for LLM classification + breakdown"));
        }
        await triggerReplan(store, cfg);
      } finally {
        store.db.close();
      }
    });
}

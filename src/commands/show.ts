import type { Command } from "commander";
import { openStore } from "../context.js";
import { openDependencies } from "../service.js";
import { c, priorityColor, statusColor } from "../util/render.js";

const STAGE_MARK: Record<string, string> = {
  done: "✓",
  in_progress: "▸",
  skipped: "⊘",
  todo: "○",
};

export function registerShow(program: Command): void {
  program
    .command("show")
    .argument("<taskId>", "task id")
    .description("Show a task with its stages and dependencies")
    .action((taskIdRaw: string) => {
      const taskId = Number(taskIdRaw);
      const store = openStore();
      try {
        const task = store.getTask(taskId);
        if (!task) {
          console.error(c.red(`task #${taskId} not found`));
          process.exitCode = 1;
          return;
        }
        console.log(
          `${c.dim(`#${task.id}`)} ${priorityColor(task.priority, `[${task.priority}]`)} ${statusColor(task.status, task.status)} ${c.bold(task.title)}`,
        );
        console.log(c.dim(`  type ${task.type}${task.effort ? ` · effort ${task.effort}` : ""}${task.due ? ` · due ${task.due}` : ""} · source ${task.source}`));
        if (task.description) console.log(c.dim(`  ${task.description}`));

        const deps = store.blockedBy(task.id);
        if (deps.length) {
          const open = new Set(openDependencies(store, task.id));
          console.log(
            c.dim("  blocked-by: ") +
              deps.map((d) => (open.has(d) ? c.red(`#${d}`) : c.dim(`#${d}✓`))).join(", "),
          );
        }

        console.log(c.dim("  stages:"));
        for (const s of store.getStages(task.id)) {
          const mark = STAGE_MARK[s.status] ?? "○";
          const deleg = s.delegatable_to.length ? c.gray(`  ⇄ ${s.delegatable_to.join(",")}`) : "";
          console.log(
            `    ${statusColor(s.status, mark)} ${c.dim(`#${s.id}`)} ${s.name} ${c.gray(`(${s.kind}${s.effort ? `, ${s.effort}` : ""})`)}${deleg}`,
          );
        }
      } finally {
        store.db.close();
      }
    });
}

import type { Command } from "commander";
import { openStore } from "../context.js";
import { nextOpenStage, openDependencies } from "../service.js";
import { PRIORITIES, TASK_STATUSES, TASK_TYPES, type Priority, type TaskStatus, type TaskType } from "../types.js";
import { assertEnum } from "../util/validate.js";
import { c, priorityColor, statusColor, table } from "../util/render.js";

interface ListOpts {
  status?: string;
  priority?: string;
  type?: string;
  all?: boolean;
}

export function registerList(program: Command): void {
  program
    .command("list")
    .alias("ls")
    .description("List tasks (open by default; --all to include done)")
    .option("-s, --status <status>", "filter by status")
    .option("-p, --priority <priority>", "filter by priority")
    .option("-t, --type <type>", "filter by type")
    .option("-a, --all", "include done tasks")
    .action((opts: ListOpts) => {
      const filter: { status?: TaskStatus; priority?: Priority; type?: TaskType } = {};
      if (opts.status) filter.status = assertEnum("status", opts.status, TASK_STATUSES);
      if (opts.priority) filter.priority = assertEnum("priority", opts.priority, PRIORITIES);
      if (opts.type) filter.type = assertEnum("type", opts.type, TASK_TYPES);

      const store = openStore();
      try {
        let tasks = store.listTasks(filter);
        if (!opts.all && !opts.status) tasks = tasks.filter((t) => t.status !== "done");
        if (tasks.length === 0) {
          console.log(c.dim("no tasks"));
          return;
        }
        const rows = tasks.map((t) => {
          const next = nextOpenStage(store, t.id);
          const deps = openDependencies(store, t.id);
          return [
            c.dim(`#${t.id}`),
            priorityColor(t.priority, t.priority),
            c.gray(t.type),
            statusColor(t.status, t.status),
            c.bold(t.title),
            next ? c.dim(next.name) : c.dim("—"),
            deps.length ? c.red(deps.map((d) => `#${d}`).join(",")) : "",
          ];
        });
        console.log(table(["id", "pri", "type", "status", "title", "next", "blocked-by"], rows));
      } finally {
        store.db.close();
      }
    });
}

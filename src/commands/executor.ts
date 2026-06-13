import type { Command } from "commander";
import { openStore } from "../context.js";
import { EXECUTOR_KINDS, STAGE_KINDS, type ExecutorKind, type StageKind } from "../types.js";
import { assertEnum } from "../util/validate.js";
import { c, table } from "../util/render.js";

export function registerExecutor(program: Command): void {
  const exec = program
    .command("executor")
    .alias("exec")
    .description("Manage the executor roster the planner delegates to");

  exec
    .command("list")
    .description("List executors")
    .action(() => {
      const store = openStore();
      try {
        const rows = store.listExecutors().map((e) => [
          c.dim(`#${e.id}`),
          c.bold(e.name),
          e.kind,
          String(e.capacity),
          e.active ? c.green("active") : c.gray("off"),
          c.gray(e.handles.join(",")),
        ]);
        console.log(table(["id", "name", "kind", "cap", "state", "handles"], rows));
      } finally {
        store.db.close();
      }
    });

  exec
    .command("add")
    .argument("<name>", "executor name (e.g. 'Claude Code', 'Alex', 'CI')")
    .requiredOption("--kind <kind>", "self|ai_agent|teammate|ci")
    .option("--handles <kinds>", "comma list of stage kinds this executor can run", "")
    .option("--capacity <n>", "concurrent lanes it can take", "1")
    .description("Add an executor (so the planner can delegate lanes to it)")
    .action((name: string, opts: { kind: string; handles: string; capacity: string }) => {
      const kind = assertEnum("kind", opts.kind, EXECUTOR_KINDS) as ExecutorKind;
      const handles = opts.handles
        ? opts.handles.split(/[,\s]+/).filter(Boolean).map((h) => assertEnum("stage kind", h, STAGE_KINDS) as StageKind)
        : (STAGE_KINDS as readonly StageKind[]).slice();
      const store = openStore();
      try {
        const e = store.addExecutor({ name, kind, capacity: Number(opts.capacity), handles, active: true });
        console.log(`${c.green("✓")} added executor ${c.dim(`#${e.id}`)} ${c.bold(e.name)} (${e.kind}) handles: ${e.handles.join(",")}`);
      } finally {
        store.db.close();
      }
    });

  exec
    .command("rm")
    .argument("<id>", "executor id")
    .description("Remove an executor")
    .action((idRaw: string) => {
      const store = openStore();
      try {
        store.removeExecutor(Number(idRaw));
        console.log(`${c.green("✓")} removed executor #${idRaw}`);
      } finally {
        store.db.close();
      }
    });
}

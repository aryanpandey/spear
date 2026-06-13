import type { Command } from "commander";
import { openStore } from "../context.js";
import { c } from "../util/render.js";

export function registerGoal(program: Command): void {
  const goal = program.command("goal").description("Manage weekly goals (the dashboard Goals tab)");

  goal
    .command("add")
    .argument("<title...>", "goal title")
    .description("Add a goal to the list")
    .action((titleParts: string[]) => {
      const store = openStore();
      try {
        const g = store.createGoal({ title: titleParts.join(" ") });
        console.log(c.brightGreen(`+ goal #${g.id}`) + ` ${g.title}`);
      } finally {
        store.db.close();
      }
    });

  goal
    .command("list")
    .alias("ls")
    .description("List goals")
    .action(() => {
      const store = openStore();
      try {
        const goals = store.listGoals();
        if (goals.length === 0) {
          console.log(c.dim("no goals yet."));
          return;
        }
        for (const g of goals) {
          const box = g.status === "done" ? c.brightGreen("[x]") : c.dim("[ ]");
          const title = g.status === "done" ? c.dim(g.title) : g.title;
          console.log(`${box} ${c.dim(`#${g.id}`)} ${title}`);
        }
      } finally {
        store.db.close();
      }
    });

  goal
    .command("done")
    .argument("<id>", "goal id")
    .description("Toggle a goal done/active")
    .action((idRaw: string) => {
      const store = openStore();
      try {
        const cur = store.getGoal(Number(idRaw));
        if (!cur) {
          console.error(c.red(`no goal #${idRaw}`));
          process.exitCode = 1;
          return;
        }
        const g = store.updateGoal(cur.id, { status: cur.status === "done" ? "active" : "done" })!;
        console.log(`${g.status === "done" ? c.brightGreen("✓ done") : c.dim("○ active")} ${c.dim(`#${g.id}`)} ${g.title}`);
      } finally {
        store.db.close();
      }
    });

  goal
    .command("rm")
    .argument("<id>", "goal id")
    .description("Delete a goal")
    .action((idRaw: string) => {
      const store = openStore();
      try {
        store.deleteGoal(Number(idRaw));
        console.log(c.dim(`removed goal #${idRaw}`));
      } finally {
        store.db.close();
      }
    });
}

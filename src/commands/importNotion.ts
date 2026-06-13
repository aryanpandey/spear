import fs from "node:fs";
import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { notionSeedPath } from "../paths.js";
import { importSeed, type NotionSeedTask } from "../notion/import.js";
import { triggerReplan } from "../replan/trigger.js";
import { c } from "../util/render.js";

export function registerImportNotion(program: Command): void {
  program
    .command("import-notion")
    .description("Import tasks from a Notion-board export JSON (idempotent by external id)")
    .option("--file <path>", "seed JSON file", notionSeedPath())
    .option("--breakdown", "run LLM/deterministic breakdown on newly-created tasks")
    .action(async (opts: { file: string; breakdown?: boolean }) => {
      if (!fs.existsSync(opts.file)) {
        console.error(c.red(`seed file not found: ${opts.file}`));
        console.error(c.dim("  export your Notion board to that path (array of {external_id,title,status,priority,due,notes})"));
        process.exitCode = 1;
        return;
      }
      let tasks: NotionSeedTask[];
      try {
        const parsed = JSON.parse(fs.readFileSync(opts.file, "utf8"));
        tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
        if (!Array.isArray(tasks)) throw new Error("expected a JSON array of tasks");
      } catch (err) {
        console.error(c.red(`could not parse ${opts.file}: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
        return;
      }

      const cfg = loadConfig();
      const store = openStore();
      try {
        const res = await importSeed(store, tasks, {
          breakdown: !!opts.breakdown,
          model: cfg.models.breakdown,
          effort: cfg.effort.breakdown,
        });
        console.log(
          `${c.green("✓")} imported from ${opts.file}: ${c.bold(String(res.created))} created, ${c.bold(String(res.updated))} updated${res.skipped ? `, ${res.skipped} skipped` : ""}`,
        );
        await triggerReplan(store, cfg);
      } finally {
        store.db.close();
      }
    });
}

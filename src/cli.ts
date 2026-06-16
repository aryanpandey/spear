#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerInit } from "./commands/init.js";
import { registerAdd } from "./commands/add.js";
import { registerList } from "./commands/list.js";
import { registerShow } from "./commands/show.js";
import { registerDone } from "./commands/done.js";
import { registerStatus } from "./commands/status.js";
import { registerBlock } from "./commands/block.js";
import { registerDue } from "./commands/due.js";
import { registerPlan } from "./commands/plan.js";
import { registerToday } from "./commands/today.js";
import { registerServe } from "./commands/serve.js";
import { registerMorning } from "./commands/morning.js";
import { registerImportNotion } from "./commands/importNotion.js";
import { registerConfig } from "./commands/config.js";
import { registerExecutor } from "./commands/executor.js";
import { registerGoal } from "./commands/goal.js";

const program = new Command();

// Read the real version from package.json (one level up from dist/ or src/).
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as { version: string };

program
  .name("spear")
  .description("Local, Matrix-themed project tracker with an LLM execution-flow planner")
  .version(pkg.version);

registerInit(program);
registerAdd(program);
registerList(program);
registerShow(program);
registerDone(program);
registerStatus(program);
registerBlock(program);
registerDue(program);
registerPlan(program);
registerToday(program);
registerServe(program);
registerMorning(program);
registerImportNotion(program);
registerConfig(program);
registerExecutor(program);
registerGoal(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

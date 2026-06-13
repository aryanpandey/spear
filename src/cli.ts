#!/usr/bin/env node
import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerAdd } from "./commands/add.js";
import { registerList } from "./commands/list.js";
import { registerShow } from "./commands/show.js";
import { registerDone } from "./commands/done.js";
import { registerStatus } from "./commands/status.js";
import { registerBlock } from "./commands/block.js";
import { registerPlan } from "./commands/plan.js";
import { registerToday } from "./commands/today.js";
import { registerServe } from "./commands/serve.js";
import { registerMorning } from "./commands/morning.js";
import { registerImportNotion } from "./commands/importNotion.js";
import { registerConfig } from "./commands/config.js";
import { registerExecutor } from "./commands/executor.js";

const program = new Command();

program
  .name("spear")
  .description("Local, Matrix-themed project tracker with an LLM execution-flow planner")
  .version("0.1.0");

registerInit(program);
registerAdd(program);
registerList(program);
registerShow(program);
registerDone(program);
registerStatus(program);
registerBlock(program);
registerPlan(program);
registerToday(program);
registerServe(program);
registerMorning(program);
registerImportNotion(program);
registerConfig(program);
registerExecutor(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

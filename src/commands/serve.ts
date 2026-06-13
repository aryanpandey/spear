import { exec } from "node:child_process";
import type { Command } from "commander";
import { openStore } from "../context.js";
import { loadConfig } from "../config/index.js";
import { startServer } from "../server/app.js";
import { c } from "../util/render.js";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Start the local dashboard + planner server")
    .option("-p, --port <port>", "port to listen on")
    .option("--open", "open the dashboard in your browser")
    .action(async (opts: { port?: string; open?: boolean }) => {
      const cfg = loadConfig();
      const port = opts.port ? Number(opts.port) : cfg.port;
      const store = openStore();
      await startServer(store, cfg, port);
      const url = `http://127.0.0.1:${port}`;
      console.log(c.brightGreen(`▌ spear dashboard → ${url}`));
      console.log(c.dim("  press Ctrl-C to stop"));
      if (opts.open) exec(`open "${url}"`);
    });
}

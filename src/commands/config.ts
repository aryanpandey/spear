import fs from "node:fs";
import type { Command } from "commander";
import { getConfigValue, loadConfig, saveConfig, setConfigValue } from "../config/index.js";
import { launchAgentPath } from "../paths.js";
import { buildMorningPlist } from "../launchd.js";
import { c } from "../util/render.js";

export function registerConfig(program: Command): void {
  program
    .command("config")
    .argument("[action]", "get | set (omit to print everything)")
    .argument("[key]", "dotted key, e.g. morning.hour")
    .argument("[value]", "new value (for set)")
    .description("View or change configuration")
    .action((action: string | undefined, key: string | undefined, value: string | undefined) => {
      const cfg = loadConfig();
      if (!action) {
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }
      if (action === "get") {
        if (!key) {
          console.error(c.red("usage: spear config get <key>"));
          process.exitCode = 1;
          return;
        }
        console.log(JSON.stringify(getConfigValue(cfg, key)));
        return;
      }
      if (action === "set") {
        if (!key || value === undefined) {
          console.error(c.red("usage: spear config set <key> <value>"));
          process.exitCode = 1;
          return;
        }
        const next = setConfigValue(cfg, key, value);
        saveConfig(next);
        console.log(`${key} = ${JSON.stringify(getConfigValue(next, key))}`);

        // Keep the launchd plist in sync when the morning schedule changes.
        if (key.startsWith("morning") && fs.existsSync(launchAgentPath())) {
          fs.writeFileSync(
            launchAgentPath(),
            buildMorningPlist({ hour: next.morning.hour, minute: next.morning.minute }),
          );
          console.log(c.dim(`  refreshed ${launchAgentPath()} — reload with:`));
          console.log(c.dim(`  launchctl unload ${launchAgentPath()} && launchctl load ${launchAgentPath()}`));
        }
        return;
      }
      console.error(c.red(`unknown action "${action}" (use get|set or omit to list)`));
      process.exitCode = 1;
    });
}

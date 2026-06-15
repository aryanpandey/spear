import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { openStore } from "../context.js";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../config/index.js";
import { configPath, dbPath, launchAgentPath, spearHome } from "../paths.js";
import { buildMorningPlist } from "../launchd.js";

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Create the spear database, seed defaults, write config + the morning launchd job")
    .option("--no-launchd", "skip writing the launchd morning job")
    .action((opts: { launchd: boolean }) => {
      fs.mkdirSync(spearHome(), { recursive: true });

      // DB + seed
      const store = openStore();
      store.seedDefaults();
      store.db.close();

      // Config
      let cfg = loadConfig();
      if (!fs.existsSync(configPath())) {
        cfg = { ...DEFAULT_CONFIG };
        saveConfig(cfg);
      }

      console.log(`${GREEN}spear initialised.${RESET}`);
      console.log(`  ${DIM}db     ${RESET}${dbPath()}`);
      console.log(`  ${DIM}config ${RESET}${configPath()}`);
      console.log(`  ${DIM}roster ${RESET}seeded executor "Me" (self)`);

      // launchd morning job
      if (opts.launchd !== false) {
        const plist = buildMorningPlist({ hour: cfg.morning.hour, minute: cfg.morning.minute });
        const plistPath = launchAgentPath();
        fs.mkdirSync(path.dirname(plistPath), { recursive: true });
        fs.writeFileSync(plistPath, plist);
        console.log(`  ${DIM}launchd${RESET}${plistPath} (${cfg.morning.hour}:${String(cfg.morning.minute).padStart(2, "0")})`);
        console.log("");
        console.log(`${DIM}Next steps:${RESET}`);
        console.log(`  ${DIM}# breakdown + planning run through your Claude Code CLI login — no API key needed${RESET}`);
        console.log(`  launchctl load ${plistPath}   ${DIM}# enable the 8am morning plan${RESET}`);
        console.log(`  spear serve --open                  ${DIM}# start the dashboard${RESET}`);
      }
    });
}

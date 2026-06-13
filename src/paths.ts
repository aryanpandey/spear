import os from "node:os";
import path from "node:path";

/** Root dir for all spear state. Overridable via SPEAR_HOME (used in tests). */
export function spearHome(): string {
  return process.env.SPEAR_HOME ?? path.join(os.homedir(), ".spear");
}

export function dbPath(): string {
  return process.env.SPEAR_DB ?? path.join(spearHome(), "spear.db");
}

export function configPath(): string {
  return path.join(spearHome(), "config.json");
}

export function notionSeedPath(): string {
  return path.join(spearHome(), "notion-seed.json");
}

export function launchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", "com.spear.morning.plist");
}

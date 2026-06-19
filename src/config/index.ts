import fs from "node:fs";
import path from "node:path";
import { configPath } from "../paths.js";
import type { Priority } from "../types.js";

export interface SpearConfig {
  /** Port the web dashboard + planner server listens on. */
  port: number;
  /** When the launchd morning job fires (local time). */
  morning: { hour: number; minute: number };
  /** Claude model ids for the LLM calls. */
  models: { breakdown: string; planner: string; duplicate: string; dates: string };
  /** Effort levels for the LLM calls. */
  effort: {
    breakdown: "low" | "medium" | "high" | "max";
    planner: "low" | "medium" | "high" | "max";
    duplicate: "low" | "medium" | "high" | "max";
    dates: "low" | "medium" | "high" | "max";
  };
  /** Default priority applied to `spear add` when --priority is omitted. */
  defaultPriority: Priority;
  /** Maximum number of lanes in the execution flow; extra themes are folded in. */
  maxLanes: number;
  /** Tasks finished per day when re-dating; 0 = auto (= maxLanes). A "large" task counts as 2. */
  dailyTaskCapacity: number;
  /** Active UI theme. */
  theme: "matrix" | "dark" | "light";
  /** Debounce window (ms) before an ad-hoc change triggers an LLM re-plan refine. */
  replanDebounceMs: number;
}

export const DEFAULT_CONFIG: SpearConfig = {
  port: 4317,
  morning: { hour: 8, minute: 0 },
  models: { breakdown: "claude-opus-4-8", planner: "claude-opus-4-8", duplicate: "claude-sonnet-4-6", dates: "claude-opus-4-8" },
  effort: { breakdown: "low", planner: "medium", duplicate: "low", dates: "medium" },
  defaultPriority: "medium",
  maxLanes: 6,
  dailyTaskCapacity: 0,
  theme: "matrix",
  replanDebounceMs: 4000,
};

export function loadConfig(): SpearConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return mergeConfig(DEFAULT_CONFIG, raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: SpearConfig): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  // The config may hold an API key — keep it owner-only.
  fs.chmodSync(p, 0o600);
}

/** Shallow-then-one-level-deep merge of user config over defaults. */
function mergeConfig(base: SpearConfig, over: Partial<SpearConfig>): SpearConfig {
  return {
    ...base,
    ...over,
    morning: { ...base.morning, ...(over.morning ?? {}) },
    models: { ...base.models, ...(over.models ?? {}) },
    effort: { ...base.effort, ...(over.effort ?? {}) },
  };
}

/** Get/set a config value by dotted key (used by `spear config`). */
export function getConfigValue(cfg: SpearConfig, key: string): unknown {
  return key.split(".").reduce<any>((acc, k) => (acc == null ? acc : acc[k]), cfg);
}

export function setConfigValue(cfg: SpearConfig, key: string, value: string): SpearConfig {
  const next: any = structuredClone(cfg);
  const parts = key.split(".");
  let cursor = next;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor[parts[i]] ??= {};
    cursor = cursor[parts[i]];
  }
  const leaf = parts[parts.length - 1];
  // Coerce numbers/booleans where the existing value is one.
  const existing = getConfigValue(cfg, key);
  if (typeof existing === "number") cursor[leaf] = Number(value);
  else if (typeof existing === "boolean") cursor[leaf] = value === "true";
  else cursor[leaf] = value;
  return next as SpearConfig;
}

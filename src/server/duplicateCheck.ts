import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { TaskSeed } from "../llm/intake.js";
import { findDuplicates, type ExistingTaskRef } from "../llm/duplicates.js";
import { claudeJson, type ClaudeRunner } from "../llm/cli.js";

export interface SeedDuplicate {
  seedIndex: number;
  taskId: number;
  title: string;
  status: string;
  reason: string;
}

/**
 * Check extracted seeds against ALL existing tasks (open + done) for semantic
 * duplicates, using the configured Sonnet model. Returns enriched matches with
 * the existing task's title + status for display.
 */
export async function checkSeedsForDuplicates(
  store: Store,
  cfg: SpearConfig,
  seeds: TaskSeed[],
  run: ClaudeRunner = claudeJson,
): Promise<SeedDuplicate[]> {
  const all = store.listTasks();
  const existing: ExistingTaskRef[] = all.map((t) => ({ id: t.id, title: t.title, status: t.status }));
  const byId = new Map(all.map((t) => [t.id, t]));
  const candidates = seeds.map((s) => ({ title: s.title, details: s.details }));

  const matches = await findDuplicates(candidates, existing, { model: cfg.models.duplicate, effort: cfg.effort.duplicate }, run);
  return matches.map((m) => {
    const t = byId.get(m.taskId)!;
    return { seedIndex: m.candidateIndex, taskId: m.taskId, title: t.title, status: t.status, reason: m.reason };
  });
}

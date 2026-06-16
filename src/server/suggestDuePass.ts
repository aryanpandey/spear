import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { todayLocal } from "../util/time.js";
import { suggestDueDates, type DueSnapshotTask } from "../llm/suggestDue.js";
import { claudeJson, type ClaudeRunner } from "../llm/cli.js";

/**
 * Snapshot every open, undated task, ask the LLM for due-date suggestions, and
 * store them. Best-effort: returns the number stored. The caller runs this in the
 * background after a re-plan, so the UI only ever reads the stored values.
 */
export async function runSuggestedDuePass(
  store: Store,
  cfg: SpearConfig,
  today: string = todayLocal(),
  run: ClaudeRunner = claudeJson,
): Promise<number> {
  const snapshot: DueSnapshotTask[] = store
    .listOpenTasks()
    .filter((t) => !t.due)
    .map((t) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      priority: t.priority,
      status: t.status,
      effort: t.effort,
      due: t.due,
      stageCount: store.getStages(t.id).length,
    }));
  if (snapshot.length === 0) return 0;

  const suggestions = await suggestDueDates(today, snapshot, { model: cfg.models.breakdown, effort: "low" }, run);
  for (const s of suggestions) {
    const task = store.getTask(s.taskId);
    if (task && !task.due) store.setSuggestedDue(s.taskId, s.date, s.reason);
  }
  return suggestions.length;
}

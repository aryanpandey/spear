import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { todayLocal, parseDateLocal } from "../util/time.js";
import { replanDatesGlobal, type TaskForDating } from "../llm/replanDates.js";
import { claudeJson, type ClaudeRunner } from "../llm/cli.js";
import { effectiveCapacity, deterministicDates } from "../util/capacity.js";
import { PRIORITY_RANK } from "../types.js";

export type RedateProgress = (done: number, total: number) => void;

interface OrderedTask extends TaskForDating {
  lane: number;
  order_in_lane: number;
}

/**
 * Re-decide a completion date for every open task in the current plan with a single
 * global LLM call that respects the configured daily task capacity (default = lane
 * count; a "large" task counts as two). Ordering is global by priority — lane number
 * only breaks ties — so any lane reordering is absorbed. Falls back to a deterministic
 * capacity-packed schedule for the whole set (or any task the model omits), and clamps
 * the final dates non-decreasing in priority order. Writes `due` directly (no re-plan).
 */
export async function redateCurrentPlan(
  store: Store,
  cfg: SpearConfig,
  onProgress?: RedateProgress,
  run: ClaudeRunner = claudeJson,
): Promise<number> {
  const plan = store.getCurrentPlan();
  if (!plan) return 0;
  const today = todayLocal();
  const items = store.getPlanItems(plan.id); // ordered by lane, order_in_lane

  // One entry per open task, remembering its current plan position for a stable tiebreak.
  const seen = new Set<number>();
  const tasks: OrderedTask[] = [];
  for (const it of items) {
    if (seen.has(it.task_id)) continue;
    const task = store.getTask(it.task_id);
    if (!task || task.status === "done") continue;
    seen.add(it.task_id);
    tasks.push({
      task_id: task.id,
      title: task.title,
      type: task.type,
      priority: task.priority,
      effort: task.effort,
      lane: it.lane,
      order_in_lane: it.order_in_lane,
    });
  }
  if (tasks.length === 0) {
    onProgress?.(1, 1);
    return 0;
  }

  // Global order: priority first, then current plan position (lane, order) as a stable tiebreak.
  tasks.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.lane - b.lane ||
      a.order_in_lane - b.order_in_lane,
  );

  const capacity = effectiveCapacity(cfg.dailyTaskCapacity, cfg.maxLanes);
  onProgress?.(0, 1);

  let assignments: { taskId: number; date: string }[] = [];
  try {
    assignments = await replanDatesGlobal(today, tasks, capacity, { model: cfg.models.dates, effort: cfg.effort.dates }, run);
  } catch {
    assignments = []; // best-effort: fall back to the deterministic schedule below
  }
  const byId = new Map<number, string>(assignments.map((a) => [a.taskId, a.date]));
  const fallback = deterministicDates(tasks, capacity, today);

  let prev: string | null = null;
  let dated = 0;
  for (const t of tasks) {
    // Prefer the model's date when present; otherwise the deterministic capacity schedule.
    let date: string = byId.get(t.task_id) ?? fallback.get(t.task_id) ?? today;
    if (prev) {
      const a = parseDateLocal(date);
      const b = parseDateLocal(prev);
      if (a && b && a.getTime() < b.getTime()) date = prev; // clamp non-decreasing
    }
    store.updateTask(t.task_id, { due: date });
    prev = date;
    dated += 1;
  }
  onProgress?.(1, 1);
  return dated;
}

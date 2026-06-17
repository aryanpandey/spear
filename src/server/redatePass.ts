import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { todayLocal, parseDateLocal } from "../util/time.js";
import { replanDatesForLane, type LaneForDating, type LaneTaskForDating } from "../llm/replanDates.js";
import { claudeJson, type ClaudeRunner } from "../llm/cli.js";

export type RedateProgress = (done: number, total: number) => void;

/**
 * Re-decide every open task's completion date from the CURRENT plan's lanes, one
 * LLM call per lane (sequential, for percentage progress). Within each lane the
 * dates are clamped non-decreasing; gaps fall back to the previous date (or today).
 * Writes `due` directly (no re-plan, so lane order is preserved). Returns the count.
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

  // Group plan items into ordered lanes; one entry per task, skipping done tasks.
  const items = store.getPlanItems(plan.id); // ordered by lane, order_in_lane
  const laneMap = new Map<number, LaneTaskForDating[]>();
  const seen = new Set<number>();
  for (const it of items) {
    if (seen.has(it.task_id)) continue;
    const task = store.getTask(it.task_id);
    if (!task || task.status === "done") continue;
    seen.add(it.task_id);
    if (!laneMap.has(it.lane)) laneMap.set(it.lane, []);
    laneMap.get(it.lane)!.push({ task_id: task.id, title: task.title, type: task.type, priority: task.priority, effort: task.effort });
  }

  const lanes: LaneForDating[] = [...laneMap.keys()].sort((x, y) => x - y).map((lane) => ({ lane, tasks: laneMap.get(lane)! }));
  const total = lanes.length;
  onProgress?.(0, total);

  let dated = 0;
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    let assignments: { taskId: number; date: string }[] = [];
    try {
      assignments = await replanDatesForLane(today, lane, { model: cfg.models.dates, effort: cfg.effort.dates }, run);
    } catch {
      assignments = []; // best-effort: a failed lane falls back to clamp/today below
    }
    const byId = new Map(assignments.map((a) => [a.taskId, a.date]));

    let prev: string | null = null;
    for (const t of lane.tasks) {
      let date = byId.get(t.task_id) ?? prev ?? today;
      if (prev) {
        const a = parseDateLocal(date);
        const b = parseDateLocal(prev);
        if (a && b && a.getTime() < b.getTime()) date = prev; // clamp non-decreasing
      }
      store.updateTask(t.task_id, { due: date });
      prev = date;
      dated += 1;
    }
    onProgress?.(i + 1, total);
  }
  return dated;
}

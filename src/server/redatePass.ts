import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { todayLocal, parseDateLocal } from "../util/time.js";
import { replanDatesGlobal, type StageForDating } from "../llm/replanDates.js";
import { claudeJson, type ClaudeRunner } from "../llm/cli.js";
import { effectiveCapacity, deterministicDates } from "../util/capacity.js";
import { syncTaskDueFromStages } from "../service.js";
import { PRIORITY_RANK } from "../types.js";

export type RedateProgress = (done: number, total: number) => void;

interface OrderedStage extends StageForDating {
  lane: number;
  order_in_lane: number;
}

/**
 * Re-decide a completion date for every open STAGE in the current plan with a single
 * global LLM call that respects the configured daily capacity (default = lane count;
 * a "large" step counts as two). Stages are ordered globally by their task's priority,
 * then kept in sequence within each task, so a task's steps stay non-decreasing while
 * higher-priority work lands sooner — robust to lane reordering. Falls back to a
 * deterministic capacity-packed schedule (per stage), clamps non-decreasing, writes each
 * stage's `due`, then re-derives each task's `due` from its stages. Returns stages dated.
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

  // One entry per open stage (a plan item is a (task, stage)), remembering plan position.
  const seen = new Set<number>();
  const stages: OrderedStage[] = [];
  for (const it of items) {
    if (seen.has(it.stage_id)) continue;
    const task = store.getTask(it.task_id);
    const stage = store.getStage(it.stage_id);
    if (!task || !stage) continue;
    if (task.status === "done") continue;
    if (stage.status === "done" || stage.status === "skipped") continue; // finished steps keep their date
    seen.add(it.stage_id);
    stages.push({
      stage_id: stage.id,
      task_id: task.id,
      task_title: task.title,
      stage_name: stage.name,
      type: task.type,
      priority: task.priority,
      effort: stage.effort,
      seq: stage.seq,
      lane: it.lane,
      order_in_lane: it.order_in_lane,
    });
  }
  if (stages.length === 0) {
    onProgress?.(1, 1);
    return 0;
  }

  // Global order: task priority, then keep a task's stages together and in sequence.
  stages.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.lane - b.lane ||
      a.task_id - b.task_id ||
      a.seq - b.seq,
  );

  const capacity = effectiveCapacity(cfg.dailyTaskCapacity, cfg.maxLanes);
  onProgress?.(0, 1);

  let assignments: { stageId: number; date: string }[] = [];
  try {
    assignments = await replanDatesGlobal(today, stages, capacity, { model: cfg.models.dates, effort: cfg.effort.dates }, run);
  } catch {
    assignments = []; // best-effort: fall back to the deterministic schedule below
  }
  const byId = new Map<number, string>(assignments.map((a) => [a.stageId, a.date]));
  const fallback = deterministicDates(stages.map((s) => ({ id: s.stage_id, effort: s.effort })), capacity, today);

  let prev: string | null = null;
  let dated = 0;
  const touchedTasks = new Set<number>();
  for (const s of stages) {
    let date: string = byId.get(s.stage_id) ?? fallback.get(s.stage_id) ?? today;
    if (prev) {
      const a = parseDateLocal(date);
      const b = parseDateLocal(prev);
      if (a && b && a.getTime() < b.getTime()) date = prev; // clamp non-decreasing
    }
    store.updateStage(s.stage_id, { due: date });
    touchedTasks.add(s.task_id);
    prev = date;
    dated += 1;
  }
  for (const taskId of touchedTasks) syncTaskDueFromStages(store, taskId);

  onProgress?.(1, 1);
  return dated;
}

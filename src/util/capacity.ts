import type { Effort } from "../types.js";
import { addDaysLocal } from "./time.js";

/**
 * How many of a day's capacity "slots" a task consumes. A "large" task is a
 * roughly-half-to-full-day effort, so it counts as two; everything else (small,
 * medium, or unknown effort) counts as one. This is deliberately separate from
 * `EFFORT_WEIGHT` (rough hours used for critical-path math).
 */
export function effortSlots(effort: Effort | null | undefined): number {
  return effort === "large" ? 2 : 1;
}

/**
 * The capacity actually used when dating: an explicit `dailyTaskCapacity` (> 0)
 * overrides; `0` (the "auto" default) falls back to the lane count. Never below 1.
 */
export function effectiveCapacity(dailyTaskCapacity: number, maxLanes: number): number {
  const n = dailyTaskCapacity > 0 ? dailyTaskCapacity : maxLanes;
  return Math.max(1, Math.floor(n));
}

export interface DatableTask {
  task_id: number;
  effort: Effort | null;
}

/**
 * Deterministic capacity-based schedule: walk the tasks in their given (priority)
 * order, packing `capacity` slots per day; each task is due on the day its first
 * slot falls. So with capacity 2 and four 1-slot tasks the due-day offsets are
 * [0, 0, 1, 1]; a leading `large` task (2 slots) fills its day alone.
 *
 * Returns a Map of task_id → YYYY-MM-DD. Dates are non-decreasing by construction.
 */
export function deterministicDates(
  tasks: DatableTask[],
  capacity: number,
  today: string,
): Map<number, string> {
  const cap = Math.max(1, Math.floor(capacity));
  const out = new Map<number, string>();
  let usedBefore = 0;
  for (const t of tasks) {
    const dayIndex = Math.floor(usedBefore / cap);
    out.set(t.task_id, addDaysLocal(today, dayIndex));
    usedBefore += effortSlots(t.effort);
  }
  return out;
}

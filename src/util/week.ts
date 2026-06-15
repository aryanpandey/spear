import { PRIORITY_RANK, type Priority } from "../types.js";
import { todayLocal } from "./time.js";

/** Minimal task shape the weekly calendar needs (a slice of BoardTask). */
export interface WeekTask {
  id: number;
  due: string | null;
  status: string;
  priority: Priority;
}

export interface WeekDay<T> {
  /** YYYY-MM-DD (local). */
  date: string;
  /** Mon, Tue, … */
  weekday: string;
  /** Day-of-month, e.g. 15. */
  dayNum: number;
  isToday: boolean;
  tasks: T[];
}

export interface WeekView<T> {
  weekStart: string;
  weekEnd: string;
  /** Monday → Sunday. */
  days: WeekDay<T>[];
  /** Still-open tasks due before this week. */
  overdue: T[];
  /** Open tasks with no deadline. */
  unscheduled: T[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday (00:00 local) of the week containing `now`. */
function mondayOf(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  d.setDate(d.getDate() - dow);
  return d;
}

/**
 * Bucket tasks into the running (Mon→Sun) week by their `due` date, plus an
 * overdue group (still-open, due before this week) and an unscheduled group
 * (open, no deadline). Tasks due after this week are dropped. Done tasks appear
 * only inside their in-week day; they're excluded from overdue/unscheduled.
 * Each bucket is sorted by priority then id. Pure (pass `now` for determinism).
 */
export function buildWeek<T extends WeekTask>(tasks: T[], now: Date): WeekView<T> {
  const start = mondayOf(now);
  const today = todayLocal(now);

  const days: WeekDay<T>[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const date = todayLocal(d);
    days.push({ date, weekday: WEEKDAYS[i], dayNum: d.getDate(), isToday: date === today, tasks: [] });
  }
  const weekStart = days[0].date;
  const weekEnd = days[6].date;
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));

  const overdue: T[] = [];
  const unscheduled: T[] = [];
  for (const task of tasks) {
    const done = task.status === "done";
    if (task.due == null) {
      if (!done) unscheduled.push(task);
      continue;
    }
    const di = dayIndex.get(task.due);
    if (di != null) days[di].tasks.push(task);
    else if (task.due < weekStart && !done) overdue.push(task);
    // due > weekEnd → out of view, dropped
  }

  const byPriThenId = (a: T, b: T) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id - b.id;
  for (const d of days) d.tasks.sort(byPriThenId);
  overdue.sort(byPriThenId);
  unscheduled.sort(byPriThenId);

  return { weekStart, weekEnd, days, overdue, unscheduled };
}

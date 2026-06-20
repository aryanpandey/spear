import { todayLocal } from "./time.js";

export interface MetricsTaskRecord {
  /** ISO timestamp the task was created. */
  created_at: string;
  /** ISO timestamp the task was completed, or null if still open. */
  completed_at: string | null;
}

export interface DayPoint {
  date: string; // YYYY-MM-DD (local)
  weekday: string; // Mon, Tue, …
  /** Open tasks at end of this day (only meaningful when !isFuture). */
  remaining: number;
  /** Tasks completed from the week's Monday through this day (cumulative). */
  completed: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface MetricsView {
  today: { date: string; added: number; completed: number };
  week: { weekStart: string; weekEnd: string; added: number; completed: number };
  /** Current open (not-done) task count. */
  totalOpen: number;
  /** Monday → Sunday of the running week. */
  burndown: DayPoint[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Local YYYY-MM-DD of an ISO timestamp. */
function localDate(iso: string): string {
  return todayLocal(new Date(iso));
}

/** Monday (local) of the week containing `now`. */
function mondayOf(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  d.setDate(d.getDate() - dow);
  return d;
}

/**
 * Compute today/active-week task metrics and a Mon→Sun burndown from each task's
 * created/completed timestamps. Dates compare as local YYYY-MM-DD strings. Pure:
 * pass `now` for determinism. Tasks deleted in the past leave no trace (caveat).
 */
export function buildMetrics(tasks: MetricsTaskRecord[], now: Date): MetricsView {
  const today = todayLocal(now);
  const start = mondayOf(now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date: todayLocal(d), weekday: WEEKDAYS[i] };
  });
  const weekStart = days[0].date;
  const weekEnd = days[6].date;

  const recs = tasks.map((t) => ({
    created: localDate(t.created_at),
    completed: t.completed_at ? localDate(t.completed_at) : null,
  }));
  const inWeek = (d: string) => d >= weekStart && d <= weekEnd;

  const burndown: DayPoint[] = days.map((d) => {
    if (d.date > today) {
      return { date: d.date, weekday: d.weekday, remaining: 0, completed: 0, isToday: false, isFuture: true };
    }
    const remaining = recs.filter((r) => r.created <= d.date && (r.completed == null || r.completed > d.date)).length;
    const completed = recs.filter((r) => r.completed != null && r.completed >= weekStart && r.completed <= d.date).length;
    return { date: d.date, weekday: d.weekday, remaining, completed, isToday: d.date === today, isFuture: false };
  });

  return {
    today: {
      date: today,
      added: recs.filter((r) => r.created === today).length,
      completed: recs.filter((r) => r.completed === today).length,
    },
    week: {
      weekStart,
      weekEnd,
      added: recs.filter((r) => inWeek(r.created)).length,
      completed: recs.filter((r) => r.completed != null && inWeek(r.completed)).length,
    },
    totalOpen: recs.filter((r) => r.completed == null).length,
    burndown,
  };
}

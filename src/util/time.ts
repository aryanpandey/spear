export function nowIso(): string {
  return new Date().toISOString();
}

/** Local YYYY-MM-DD for "today" (plan_date). */
export function todayLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse a YYYY-MM-DD (local) or full ISO string to a Date; null if unparseable. */
export function parseDateLocal(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export type DueBand = "overdue" | "today" | "soon" | "later" | "none";

/** Classify a due date relative to now (soon = within 3 days). */
export function dueBand(due: string | null | undefined, now: Date = new Date()): DueBand {
  if (!due) return "none";
  const d = parseDateLocal(due);
  if (!d) return "none";
  const diffDays = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 3) return "soon";
  return "later";
}

/** Minutes from `now` until the local workday end (hour:minute); 0 if already past. */
export function minutesUntil(hour: number, minute: number, now: Date = new Date()): number {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  return Math.max(0, Math.round((end.getTime() - now.getTime()) / 60000));
}

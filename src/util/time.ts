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

function offsetDays(now: Date, n: number): string {
  return todayLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
}

/**
 * Parse a user-supplied deadline into a normalized YYYY-MM-DD, or null to clear.
 * Accepts: `YYYY-MM-DD`, `+Nd` (N days from now), `today`, `tomorrow`, and
 * `clear`/`none`/empty (clear). Throws on anything else or an impossible date.
 */
export function parseDueInput(input: string, now: Date = new Date()): string | null {
  const s = input.trim().toLowerCase();
  if (s === "" || s === "clear" || s === "none") return null;
  if (s === "today") return todayLocal(now);
  if (s === "tomorrow") return offsetDays(now, 1);

  const rel = /^\+(\d+)d$/.exec(s);
  if (rel) return offsetDays(now, Number(rel[1]));

  const abs = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (abs) {
    const d = new Date(Number(abs[1]), Number(abs[2]) - 1, Number(abs[3]));
    // Reject overflow (e.g. 2026-13-40) by requiring a clean round-trip.
    if (todayLocal(d) !== s) throw new Error(`invalid date: ${input}`);
    return s;
  }

  throw new Error(`unrecognized deadline "${input}" (use YYYY-MM-DD, +Nd, today, tomorrow, or clear)`);
}

/** Minutes from `now` until the local workday end (hour:minute); 0 if already past. */
export function minutesUntil(hour: number, minute: number, now: Date = new Date()): number {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  return Math.max(0, Math.round((end.getTime() - now.getTime()) / 60000));
}

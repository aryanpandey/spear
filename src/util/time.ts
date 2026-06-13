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

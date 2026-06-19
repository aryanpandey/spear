const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface LaneSortable {
  task: { status: string; priority: string };
  stage: { status: string };
  due: string | null;
}

/** Order a lane: in-progress STAGE first, then by due date (soonest first, undated last), then priority. */
export function compareLaneItems(a: LaneSortable, b: LaneSortable): number {
  const ip = Number(b.stage.status === "in_progress") - Number(a.stage.status === "in_progress");
  if (ip) return ip;
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return (RANK[a.task.priority] ?? 9) - (RANK[b.task.priority] ?? 9);
}

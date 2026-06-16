import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { SuggestDueSchema } from "./schemas.js";
import { parseDateLocal } from "../util/time.js";
import type { Effort, Priority, TaskStatus, TaskType } from "../types.js";

export interface DueSnapshotTask {
  id: number;
  title: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  effort: Effort | null;
  due: string | null;
  stageCount: number;
}

export interface DueSuggestion {
  taskId: number;
  date: string;
  reason: string;
}

const SYSTEM = `You suggest a realistic due date for each undated task on a founder's board.

Consider:
- Priority: critical/high should land sooner; low can be deferred.
- Effort and stageCount: larger / multi-stage work needs more lead time.
- The OTHER tasks and their existing due dates: spread deadlines out — do not pile everything on one day.
- All dates must be today or later, formatted YYYY-MM-DD.

Output ONLY a JSON object: {"suggestions":[{"task_id":number,"date":"YYYY-MM-DD","reason":string}]} — one entry per undated task, no prose, no fences.`;

function buildPrompt(today: string, tasks: DueSnapshotTask[]): string {
  return `${SYSTEM}\n\nToday is ${today}.\nBoard:\n${JSON.stringify(tasks)}`;
}

/**
 * Ask the Claude CLI to suggest a due date for each task in `tasks` that has no
 * real deadline. Returns only well-formed suggestions: a parseable date that is
 * today-or-later, for a task id present in the snapshot. Drops the rest.
 */
export async function suggestDueDates(
  today: string,
  tasks: DueSnapshotTask[],
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<DueSuggestion[]> {
  const undated = tasks.filter((t) => !t.due);
  if (undated.length === 0) return [];
  const ids = new Set(undated.map((t) => t.id));
  const todayDate = parseDateLocal(today);
  const parsed = await claudeStructured(buildPrompt(today, undated), (x) => SuggestDueSchema.parse(x), opts, run);

  const out: DueSuggestion[] = [];
  for (const s of parsed.suggestions) {
    if (!ids.has(s.task_id)) continue;
    const d = parseDateLocal(s.date);
    if (!d || !todayDate) continue;
    if (d.getTime() < todayDate.getTime()) continue; // no past dates
    out.push({ taskId: s.task_id, date: s.date, reason: s.reason });
  }
  return out;
}

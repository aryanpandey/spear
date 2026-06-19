import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { ReplanDatesSchema } from "./schemas.js";
import { parseDateLocal } from "../util/time.js";
import type { Effort, Priority, TaskType } from "../types.js";

export interface TaskForDating {
  task_id: number;
  title: string;
  type: TaskType;
  priority: Priority;
  effort: Effort | null;
}
export interface DateAssignment {
  taskId: number;
  date: string;
}

const SYSTEM = `You assign a completion (due) date to EVERY task in a founder's execution flow.

Rules:
- The operator finishes about CAPACITY tasks per day in total across everything they are doing.
- A "large" effort task counts as roughly two tasks (it can take up to a full day); small/medium count as one.
- The tasks are listed highest-priority first; give higher-priority tasks sooner (earlier or equal) dates.
- Keep the dates NON-DECREASING down the list (a task later in the list never finishes before an earlier one).
- Start from today and pack about CAPACITY tasks' worth of work into each day before moving to the next.
- All dates are YYYY-MM-DD, today or later.

Output ONLY a JSON object: {"dates":[{"task_id":number,"date":"YYYY-MM-DD"}]} — one per task, no prose, no fences.`;

function buildPrompt(today: string, tasks: TaskForDating[], capacity: number): string {
  return `${SYSTEM.replace(/CAPACITY/g, String(capacity))}\n\nToday is ${today}.\nTasks (highest-priority first):\n${JSON.stringify(tasks)}`;
}

/**
 * Ask the Claude CLI for completion dates for ALL of the flow's open tasks in one
 * call, given a daily task capacity. The tasks are passed highest-priority first.
 * Returns only well-formed dates (parseable, today-or-later) keyed by task id; the
 * caller clamps for non-decreasing order and fills any gaps deterministically.
 */
export async function replanDatesGlobal(
  today: string,
  tasks: TaskForDating[],
  capacity: number,
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<DateAssignment[]> {
  if (tasks.length === 0) return [];
  const ids = new Set(tasks.map((t) => t.task_id));
  const todayDate = parseDateLocal(today);
  const parsed = await claudeStructured(buildPrompt(today, tasks, capacity), (x) => ReplanDatesSchema.parse(x), opts, run);

  const out: DateAssignment[] = [];
  for (const d of parsed.dates) {
    if (!ids.has(d.task_id)) continue;
    const dt = parseDateLocal(d.date);
    if (!dt || !todayDate) continue;
    if (dt.getTime() < todayDate.getTime()) continue; // no past dates
    out.push({ taskId: d.task_id, date: d.date });
  }
  return out;
}

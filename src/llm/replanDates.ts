import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { ReplanDatesSchema } from "./schemas.js";
import { parseDateLocal } from "../util/time.js";
import type { Effort, Priority, TaskType } from "../types.js";

export interface LaneTaskForDating {
  task_id: number;
  title: string;
  type: TaskType;
  priority: Priority;
  effort: Effort | null;
}
export interface LaneForDating {
  lane: number;
  tasks: LaneTaskForDating[];
}
export interface DateAssignment {
  taskId: number;
  date: string;
}

const SYSTEM = `You assign a completion (due) date to each task in ONE lane of a founder's execution flow.

Rules:
- The operator finishes about 2 tasks per lane per day; a "large" task may take a full day on its own.
- Keep the dates NON-DECREASING down the lane (a task later in the list never finishes before an earlier one).
- The tasks are listed highest-priority first; give higher-priority tasks sooner (earlier or equal) dates.
- Lanes run in parallel, so start this lane from today.
- All dates are YYYY-MM-DD, today or later.

Output ONLY a JSON object: {"dates":[{"task_id":number,"date":"YYYY-MM-DD"}]} — one per task, no prose, no fences.`;

function buildPrompt(today: string, lane: LaneForDating): string {
  return `${SYSTEM}\n\nToday is ${today}.\nLane ${lane.lane} tasks (in order):\n${JSON.stringify(lane.tasks)}`;
}

/**
 * Ask the Claude CLI for completion dates for one lane's tasks (in order). Returns
 * only well-formed dates (parseable, today-or-later) keyed by task id. The caller
 * clamps for non-decreasing order and fills any gaps.
 */
export async function replanDatesForLane(
  today: string,
  lane: LaneForDating,
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<DateAssignment[]> {
  if (lane.tasks.length === 0) return [];
  const ids = new Set(lane.tasks.map((t) => t.task_id));
  const todayDate = parseDateLocal(today);
  const parsed = await claudeStructured(buildPrompt(today, lane), (x) => ReplanDatesSchema.parse(x), opts, run);

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

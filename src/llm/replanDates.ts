import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { ReplanDatesSchema } from "./schemas.js";
import { parseDateLocal } from "../util/time.js";
import type { Effort, Priority, TaskType } from "../types.js";

export interface StageForDating {
  stage_id: number;
  task_id: number;
  task_title: string;
  stage_name: string;
  type: TaskType;
  priority: Priority;
  effort: Effort | null;
  /** Sequence within the task (planning → implementation → testing → …). */
  seq: number;
}
export interface DateAssignment {
  stageId: number;
  date: string;
}

const SYSTEM = `You assign a completion (due) date to EVERY stage (step) in a founder's execution flow.

Rules:
- The operator finishes about CAPACITY steps per day in total across everything.
- A "large" effort step counts as roughly two steps (it can take up to a full day); small/medium count as one.
- Stages of the SAME task run in sequence (e.g. planning → implementation → testing): a step with a higher seq within a task must never finish before an earlier step of that task.
- Steps are listed with higher-priority tasks first; give them sooner (earlier or equal) dates.
- Keep the dates NON-DECREASING down the whole list.
- Start from today and pack about CAPACITY steps' worth of work into each day before moving on.
- All dates are YYYY-MM-DD, today or later.

Output ONLY a JSON object: {"dates":[{"stage_id":number,"date":"YYYY-MM-DD"}]} — one per stage, no prose, no fences.`;

function buildPrompt(today: string, stages: StageForDating[], capacity: number): string {
  return `${SYSTEM.replace(/CAPACITY/g, String(capacity))}\n\nToday is ${today}.\nStages (higher-priority tasks first, in sequence within each task):\n${JSON.stringify(stages)}`;
}

/**
 * Ask the Claude CLI for completion dates for ALL of the flow's open stages in one
 * call, given a daily capacity. Stages are passed higher-priority first, in sequence
 * within each task. Returns only well-formed dates (parseable, today-or-later) keyed
 * by stage id; the caller clamps for non-decreasing order and fills any gaps.
 */
export async function replanDatesGlobal(
  today: string,
  stages: StageForDating[],
  capacity: number,
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<DateAssignment[]> {
  if (stages.length === 0) return [];
  const ids = new Set(stages.map((s) => s.stage_id));
  const todayDate = parseDateLocal(today);
  const parsed = await claudeStructured(buildPrompt(today, stages, capacity), (x) => ReplanDatesSchema.parse(x), opts, run);

  const out: DateAssignment[] = [];
  for (const d of parsed.dates) {
    if (!ids.has(d.stage_id)) continue;
    const dt = parseDateLocal(d.date);
    if (!dt || !todayDate) continue;
    if (dt.getTime() < todayDate.getTime()) continue; // no past dates
    out.push({ stageId: d.stage_id, date: d.date });
  }
  return out;
}

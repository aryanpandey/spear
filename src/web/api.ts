// Response types mirror src/server/dto.ts (kept in sync by hand; the server is the source of truth).

export type Priority = "critical" | "high" | "medium" | "low";
export type TaskType = "feature" | "bug" | "chore" | "research" | "other";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done";
export type StageStatus = "todo" | "in_progress" | "done" | "skipped";
export type StageKind = "planning" | "implementation" | "testing" | "stage_testing" | "generic";
export type ExecutorKind = "self" | "ai_agent" | "teammate" | "ci";
export type ScheduledState = "start_now" | "background" | "waiting";
export type DueBand = "overdue" | "today" | "soon" | "later" | "none";

export interface BoardStage {
  id: number;
  name: string;
  kind: StageKind;
  seq: number;
  status: StageStatus;
  effort: string | null;
  delegatable_to: ExecutorKind[];
}

export interface BoardTask {
  id: number;
  title: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  due: string | null;
  description: string;
  stages: BoardStage[];
  blockedBy: number[];
  openBlockers: number[];
}

export interface BoardData {
  tasks: BoardTask[];
  executors: { id: number; name: string; kind: ExecutorKind; capacity: number }[];
}

export interface TodayItem {
  order_in_lane: number;
  scheduled_state: ScheduledState;
  is_delegation_candidate: boolean;
  rationale: string;
  due: string | null;
  dueBand: DueBand;
  estMin: number;
  fitsToday: boolean;
  task: { id: number; title: string; priority: Priority; type: TaskType };
  stage: { id: number; name: string; kind: StageKind; status: StageStatus; effort: string | null };
}

export interface TodayLane {
  lane: number;
  executor: { id: number; name: string; kind: ExecutorKind } | null;
  items: TodayItem[];
}

export interface TimeBudget {
  leftMin: number;
  plannedMin: number;
  fitsCount: number;
  spillCount: number;
}

export interface TodayData {
  plan: { plan_date: string; trigger: string; narrative: string; model: string | null; generated_at: string } | null;
  lanes: TodayLane[];
  timeBudget: TimeBudget | null;
}

export async function fetchBoard(): Promise<BoardData> {
  const r = await fetch("/api/board");
  if (!r.ok) throw new Error(`board ${r.status}`);
  return r.json();
}

export async function fetchToday(hours?: number): Promise<TodayData> {
  const q = hours != null && !Number.isNaN(hours) ? `?hours=${hours}` : "";
  const r = await fetch(`/api/today${q}`);
  if (!r.ok) throw new Error(`today ${r.status}`);
  return r.json();
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

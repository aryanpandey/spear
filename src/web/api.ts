// Response types mirror src/server/dto.ts (kept in sync by hand; the server is the source of truth).

export type Priority = "critical" | "high" | "medium" | "low";
export type TaskType = "feature" | "bug" | "chore" | "research" | "other";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done";
export type StageStatus = "todo" | "in_progress" | "done" | "skipped";
export type StageKind = "planning" | "implementation" | "testing" | "stage_testing" | "generic";
export type ExecutorKind = "self" | "ai_agent" | "teammate" | "ci";
export type ScheduledState = "start_now" | "background" | "waiting";

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
  task: { id: number; title: string; priority: Priority; type: TaskType };
  stage: { id: number; name: string; kind: StageKind; status: StageStatus };
}

export interface TodayLane {
  lane: number;
  executor: { id: number; name: string; kind: ExecutorKind } | null;
  items: TodayItem[];
}

export interface TodayData {
  plan: { plan_date: string; trigger: string; narrative: string; model: string | null; generated_at: string } | null;
  lanes: TodayLane[];
}

export async function fetchBoard(): Promise<BoardData> {
  const r = await fetch("/api/board");
  if (!r.ok) throw new Error(`board ${r.status}`);
  return r.json();
}

export async function fetchToday(): Promise<TodayData> {
  const r = await fetch("/api/today");
  if (!r.ok) throw new Error(`today ${r.status}`);
  return r.json();
}

// Response types mirror src/server/dto.ts (kept in sync by hand; the server is the source of truth).

export type Priority = "critical" | "high" | "medium" | "low";
export type TaskType = "feature" | "bug" | "chore" | "research" | "other";
export type Intent = "task" | "feature";

export interface TaskSeed {
  title: string;
  details: string;
}
export interface DuplicateMatch {
  seedIndex: number;
  taskId: number;
  title: string;
  status: TaskStatus;
  reason: string;
}
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
  suggestedDue: string | null;
  suggestedDueReason: string | null;
  dueBand: DueBand;
  task: { id: number; title: string; priority: Priority; type: TaskType; status: TaskStatus };
  stage: { id: number; name: string; kind: StageKind; status: StageStatus; effort: string | null };
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
  const r = await fetch(`/api/today`);
  if (!r.ok) throw new Error(`today ${r.status}`);
  return r.json();
}

// ---- task create / actions ----

/**
 * Create a task through the same pipeline as `spear add` (server-side breakdown +
 * replan). Omit `priority` to let the server auto-infer it.
 */
export async function createTask(title: string, priority?: Priority): Promise<void> {
  const body: { title: string; priority?: Priority } = { title };
  if (priority) body.priority = priority;
  const r = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`add ${r.status}`);
}

/**
 * Multimodal / multi-task intake: a prompt and/or a pasted image become 1..N
 * tasks. `imageDataUrl` is a `data:<mime>;base64,<...>` string (from a paste).
 */
export async function createTasksFromIntake(params: {
  prompt: string;
  imageDataUrl?: string;
  intent?: Intent;
  priority?: Priority;
}): Promise<{ count: number; taskIds: number[] }> {
  const body: {
    prompt: string;
    intent?: Intent;
    priority?: Priority;
    image?: { mime: string; dataB64: string };
  } = { prompt: params.prompt };
  if (params.intent) body.intent = params.intent;
  if (params.priority) body.priority = params.priority;
  if (params.imageDataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(params.imageDataUrl);
    if (m) body.image = { mime: m[1], dataB64: m[2] };
  }
  const r = await fetch("/api/tasks/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`intake ${r.status}`);
  return r.json();
}

/** Intake step 1: extract seeds + check for duplicates. Creates nothing. */
export async function checkIntake(params: {
  prompt: string;
  imageDataUrl?: string;
}): Promise<{ seeds: TaskSeed[]; duplicates: DuplicateMatch[] }> {
  const body: { prompt: string; image?: { mime: string; dataB64: string } } = { prompt: params.prompt };
  if (params.imageDataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(params.imageDataUrl);
    if (m) body.image = { mime: m[1], dataB64: m[2] };
  }
  const r = await fetch("/api/tasks/intake/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`check ${r.status}`);
  return r.json();
}

/** Intake step 2: create tasks from already-extracted seeds. */
export async function createTasksFromSeeds(
  seeds: TaskSeed[],
  intent?: Intent,
  priority?: Priority,
): Promise<{ count: number; taskIds: number[] }> {
  const body: { seeds: TaskSeed[]; intent?: Intent; priority?: Priority } = { seeds };
  if (intent) body.intent = intent;
  if (priority) body.priority = priority;
  const r = await fetch("/api/tasks/intake/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`create ${r.status}`);
  return r.json();
}

export async function fetchConfig(): Promise<{ maxLanes: number }> {
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

/** Set the planner's lane count; the server persists it and re-plans. */
export async function setMaxLanes(lanes: number): Promise<{ maxLanes: number }> {
  const r = await fetch("/api/config/lanes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lanes }),
  });
  if (!r.ok) throw new Error(`lanes ${r.status}`);
  return r.json();
}

export async function setTaskStatus(id: number, status: TaskStatus): Promise<void> {
  const r = await fetch(`/api/tasks/${id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error(`status ${r.status}`);
}

/** Change a task's priority; server refreshes (does not re-plan). */
export async function setTaskPriority(id: number, priority: Priority): Promise<void> {
  const r = await fetch(`/api/tasks/${id}/priority`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priority }),
  });
  if (!r.ok) throw new Error(`priority ${r.status}`);
}

/** Rename a task; server refreshes (does not re-plan). */
export async function setTaskTitle(id: number, title: string): Promise<void> {
  const r = await fetch(`/api/tasks/${id}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error(`title ${r.status}`);
}

/** Set (`YYYY-MM-DD`) or clear (`null`) a task's deadline; server re-plans. */
export async function setTaskDue(id: number, due: string | null): Promise<void> {
  const r = await fetch(`/api/tasks/${id}/due`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ due }),
  });
  if (!r.ok) throw new Error(`due ${r.status}`);
}

export async function completeTask(id: number): Promise<void> {
  const r = await fetch(`/api/tasks/${id}/done`, { method: "POST" });
  if (!r.ok) throw new Error(`done ${r.status}`);
}

export async function deleteTask(id: number): Promise<void> {
  const r = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`delete ${r.status}`);
}

// ---- desktop app downloads ----

export type DesktopPlatform = "mac" | "win";

export interface DesktopArtifact {
  platform: DesktopPlatform;
  file: string;
  url: string;
  bytes: number;
}

export interface DesktopManifest {
  version: string;
  source?: "github" | "local";
  mac: DesktopArtifact | null;
  win: DesktopArtifact | null;
}

export async function fetchDesktopManifest(): Promise<DesktopManifest> {
  const r = await fetch("/api/desktop/manifest");
  if (!r.ok) throw new Error(`desktop manifest ${r.status}`);
  return r.json();
}

/** Best-effort detection of the visitor's OS for the download button. */
export function detectPlatform(): DesktopPlatform | null {
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const hay = `${uaData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  if (/mac|iphone|ipad|darwin/.test(hay)) return "mac";
  if (/win/.test(hay)) return "win";
  return null;
}

// ---- Goals tab (mirrors src/server/goalsDto.ts) ----

export type GoalStatus = "active" | "done";

export interface Goal {
  id: number;
  title: string;
  notes: string;
  status: GoalStatus;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface ScorecardMetric {
  id: number;
  scorecard_id: number;
  name: string;
  progress: number;
  goal: number;
  weight: number;
  sort: number;
  earned: number;
  pct: number;
}

export interface ScorecardBonus {
  id: number;
  scorecard_id: number;
  task: string;
  reward: string;
  done: boolean;
  sort: number;
}

export interface Scorecard {
  id: number;
  title: string;
  week_of: string | null;
  bonus_reward: string;
  is_current: boolean;
  metrics: ScorecardMetric[];
  bonuses: ScorecardBonus[];
  totals: { earned: number; weight: number; pct: number };
}

export interface GoalsData {
  goals: Goal[];
  scorecard: Scorecard | null;
  scorecards: { id: number; title: string; week_of: string | null; is_current: boolean }[];
}

async function jsonOrThrow(r: Response): Promise<any> {
  if (!r.ok) throw new Error(`${r.url} ${r.status}`);
  return r.json();
}

const send = (method: string, url: string, body?: unknown): Promise<any> =>
  fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(jsonOrThrow);

export const goalsApi = {
  fetch: (): Promise<GoalsData> => fetch("/api/goals").then(jsonOrThrow),

  addGoal: (title: string) => send("POST", "/api/goals", { title }),
  patchGoal: (id: number, patch: Partial<Pick<Goal, "title" | "notes" | "status">>) =>
    send("PATCH", `/api/goals/${id}`, patch),
  toggleGoal: (id: number) => send("POST", `/api/goals/${id}/toggle`),
  deleteGoal: (id: number) => send("DELETE", `/api/goals/${id}`),

  createScorecard: (title: string) => send("POST", "/api/scorecards", { title }),
  patchScorecard: (id: number, patch: { title?: string; week_of?: string | null; bonus_reward?: string; current?: boolean }) =>
    send("PATCH", `/api/scorecards/${id}`, patch),
  deleteScorecard: (id: number) => send("DELETE", `/api/scorecards/${id}`),

  addMetric: (scorecardId: number, name: string) => send("POST", `/api/scorecards/${scorecardId}/metrics`, { name }),
  patchMetric: (id: number, patch: Partial<Pick<ScorecardMetric, "name" | "progress" | "goal" | "weight">>) =>
    send("PATCH", `/api/metrics/${id}`, patch),
  deleteMetric: (id: number) => send("DELETE", `/api/metrics/${id}`),

  addBonus: (scorecardId: number, task: string) => send("POST", `/api/scorecards/${scorecardId}/bonuses`, { task }),
  patchBonus: (id: number, patch: Partial<Pick<ScorecardBonus, "task" | "reward" | "done">>) =>
    send("PATCH", `/api/bonuses/${id}`, patch),
  deleteBonus: (id: number) => send("DELETE", `/api/bonuses/${id}`),
};

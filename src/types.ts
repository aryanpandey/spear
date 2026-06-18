// Shared domain types & enums for spear.

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
/** Lower number = more urgent. Used for deterministic ordering. */
export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const TASK_TYPES = ["feature", "bug", "chore", "research", "other"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STAGE_KINDS = [
  "planning",
  "implementation",
  "testing",
  "stage_testing",
  "generic",
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_STATUSES = ["todo", "in_progress", "done", "skipped"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const EXECUTOR_KINDS = ["self", "ai_agent", "teammate", "ci"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

export const EFFORTS = ["small", "medium", "large"] as const;
export type Effort = (typeof EFFORTS)[number];
/** Rough hours used for critical-path math. */
export const EFFORT_WEIGHT: Record<Effort, number> = { small: 1, medium: 3, large: 8 };

export const PLAN_TRIGGERS = ["morning", "adhoc", "manual"] as const;
export type PlanTrigger = (typeof PLAN_TRIGGERS)[number];

export const SCHEDULED_STATES = ["start_now", "background", "waiting"] as const;
export type ScheduledState = (typeof SCHEDULED_STATES)[number];

// ---- Row shapes (as returned by the store, with JSON fields parsed) ----

export interface Task {
  id: number;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  effort: Effort | null;
  due: string | null;
  /** LLM-suggested due date for tasks without a real deadline (and a short reason). */
  suggested_due: string | null;
  suggested_due_reason: string | null;
  source: string;
  external_id: string | null;
  /** Persistent lane assignment (sticky across replans); null until first planned. */
  lane: number | null;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: number;
  task_id: number;
  name: string;
  kind: StageKind;
  seq: number;
  status: StageStatus;
  effort: Effort | null;
  delegatable_to: ExecutorKind[];
}

export interface Dependency {
  id: number;
  task_id: number;
  blocked_by_task_id: number;
}

export interface Attachment {
  id: number;
  task_id: number;
  filename: string;
  original_name: string | null;
  mime: string;
  created_at: string;
}

export interface Executor {
  id: number;
  name: string;
  kind: ExecutorKind;
  capacity: number;
  handles: StageKind[];
  active: boolean;
}

export interface DailyPlan {
  id: number;
  plan_date: string;
  generated_at: string;
  trigger: PlanTrigger;
  narrative: string;
  model: string | null;
  is_current: boolean;
}

export interface PlanItem {
  id: number;
  plan_id: number;
  task_id: number;
  stage_id: number;
  lane: number;
  order_in_lane: number;
  executor_id: number | null;
  is_delegation_candidate: boolean;
  scheduled_state: ScheduledState;
  rationale: string;
}

// ---- Weekly goals (dashboard "Goals" tab) ----

export const GOAL_STATUSES = ["active", "done"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** A free-form goal in the simple "List" sub-tab. */
export interface Goal {
  id: number;
  title: string;
  notes: string;
  status: GoalStatus;
  sort: number;
  created_at: string;
  updated_at: string;
}

/** A weekly focus scorecard (the structured "Scorecard" sub-tab). */
export interface Scorecard {
  id: number;
  title: string;
  week_of: string | null;
  bonus_reward: string;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

/** A weighted, measurable row within a scorecard (progress toward a goal). */
export interface ScorecardMetric {
  id: number;
  scorecard_id: number;
  name: string;
  progress: number;
  goal: number;
  /** Max score this row contributes (the "Score" weight column). */
  weight: number;
  sort: number;
}

/** A bonus task → reward pair, unlocked only on a full week. */
export interface ScorecardBonus {
  id: number;
  scorecard_id: number;
  task: string;
  reward: string;
  done: boolean;
  sort: number;
}

import type { Store } from "../db/store.js";
import { openDependencies } from "../service.js";
import { dueBand, type DueBand } from "../util/time.js";
import type {
  Effort,
  ExecutorKind,
  Priority,
  ScheduledState,
  StageKind,
  StageStatus,
  TaskStatus,
  TaskType,
} from "../types.js";

export interface BoardStageDto {
  id: number;
  name: string;
  kind: StageKind;
  seq: number;
  status: StageStatus;
  effort: Effort | null;
  delegatable_to: ExecutorKind[];
}

export interface BoardTaskDto {
  id: number;
  title: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  due: string | null;
  description: string;
  stages: BoardStageDto[];
  blockedBy: number[];
  openBlockers: number[];
}

export interface ExecutorDto {
  id: number;
  name: string;
  kind: ExecutorKind;
  capacity: number;
}

export interface BoardDto {
  tasks: BoardTaskDto[];
  executors: ExecutorDto[];
}

export function boardDto(store: Store): BoardDto {
  return {
    executors: store.listExecutors().map((e) => ({ id: e.id, name: e.name, kind: e.kind, capacity: e.capacity })),
    tasks: store.listTasks().map((t) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      priority: t.priority,
      status: t.status,
      due: t.due,
      description: t.description,
      stages: store.getStages(t.id).map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        seq: s.seq,
        status: s.status,
        effort: s.effort,
        delegatable_to: s.delegatable_to,
      })),
      blockedBy: store.blockedBy(t.id),
      openBlockers: openDependencies(store, t.id),
    })),
  };
}

export interface TodayItemDto {
  order_in_lane: number;
  scheduled_state: ScheduledState;
  is_delegation_candidate: boolean;
  rationale: string;
  due: string | null;
  suggestedDue: string | null;
  suggestedDueReason: string | null;
  dueBand: DueBand;
  /** Whether the task has more than one stage (so the stage name is a real sub-step worth showing). */
  multiStage: boolean;
  task: { id: number; title: string; priority: Priority; type: TaskType; status: TaskStatus; description: string };
  stage: { id: number; name: string; kind: StageKind; status: StageStatus; effort: Effort | null };
}

export interface TodayLaneDto {
  lane: number;
  executor: { id: number; name: string; kind: ExecutorKind } | null;
  items: TodayItemDto[];
}

export interface TodayDto {
  plan: { plan_date: string; trigger: string; narrative: string; model: string | null; generated_at: string } | null;
  lanes: TodayLaneDto[];
}

export function todayDto(store: Store): TodayDto {
  const plan = store.getCurrentPlan();
  if (!plan) return { plan: null, lanes: [] };

  const now = new Date();
  const execById = new Map(store.listExecutors().map((e) => [e.id, e]));
  const items = store.getPlanItems(plan.id); // ordered by lane, order_in_lane

  const laneMap = new Map<number, TodayItemDto[]>();
  const laneExec = new Map<number, number | null>();

  for (const it of items) {
    const task = store.getTask(it.task_id);
    const stage = store.getStage(it.stage_id);
    if (!task || !stage) continue;
    if (task.status === "done") continue; // completed work leaves the lanes (no re-plan needed)
    if (!laneMap.has(it.lane)) {
      laneMap.set(it.lane, []);
      laneExec.set(it.lane, it.executor_id);
    }
    laneMap.get(it.lane)!.push({
      order_in_lane: it.order_in_lane,
      scheduled_state: it.scheduled_state,
      is_delegation_candidate: it.is_delegation_candidate,
      rationale: it.rationale,
      due: task.due,
      suggestedDue: task.suggested_due,
      suggestedDueReason: task.suggested_due_reason,
      dueBand: dueBand(task.due, now),
      multiStage: store.getStages(task.id).length > 1,
      task: { id: task.id, title: task.title, priority: task.priority, type: task.type, status: task.status, description: task.description },
      stage: { id: stage.id, name: stage.name, kind: stage.kind, status: stage.status, effort: stage.effort },
    });
  }

  const lanes: TodayLaneDto[] = [...laneMap.keys()]
    .sort((a, b) => a - b)
    .map((lane) => {
      const execId = laneExec.get(lane) ?? null;
      const e = execId != null ? execById.get(execId) : undefined;
      return {
        lane,
        executor: e ? { id: e.id, name: e.name, kind: e.kind } : null,
        items: laneMap.get(lane)!.sort((a, b) => a.order_in_lane - b.order_in_lane),
      };
    });

  return {
    plan: {
      plan_date: plan.plan_date,
      trigger: plan.trigger,
      narrative: plan.narrative,
      model: plan.model,
      generated_at: plan.generated_at,
    },
    lanes,
  };
}

export interface AttachmentDto {
  id: number;
  taskId: number;
  filename: string;
  originalName: string | null;
  mime: string;
  createdAt: string;
  url: string;
}

export interface TaskDetailDto {
  task: {
    id: number;
    title: string;
    type: TaskType;
    priority: Priority;
    status: TaskStatus;
    due: string | null;
    description: string;
  };
  stages: BoardStageDto[];
  blockedBy: number[];
  openBlockers: number[];
  attachments: AttachmentDto[];
}

export function taskDetailDto(store: Store, id: number): TaskDetailDto | null {
  const task = store.getTask(id);
  if (!task) return null;
  return {
    task: {
      id: task.id,
      title: task.title,
      type: task.type,
      priority: task.priority,
      status: task.status,
      due: task.due,
      description: task.description,
    },
    stages: store.getStages(id).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      seq: s.seq,
      status: s.status,
      effort: s.effort,
      delegatable_to: s.delegatable_to,
    })),
    blockedBy: store.blockedBy(id),
    openBlockers: openDependencies(store, id),
    attachments: store.listAttachments(id).map((a) => ({
      id: a.id,
      taskId: a.task_id,
      filename: a.filename,
      originalName: a.original_name,
      mime: a.mime,
      createdAt: a.created_at,
      url: `/api/attachments/${encodeURIComponent(a.filename)}`,
    })),
  };
}

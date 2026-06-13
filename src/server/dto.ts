import type { Store } from "../db/store.js";
import { openDependencies } from "../service.js";
import { dueBand, type DueBand } from "../util/time.js";
import { timeBudget, type TimeOpts } from "../planner/timefit.js";
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
  dueBand: DueBand;
  estMin: number;
  /** False when this item spills past today's time budget. */
  fitsToday: boolean;
  task: { id: number; title: string; priority: Priority; type: TaskType };
  stage: { id: number; name: string; kind: StageKind; status: StageStatus; effort: Effort | null };
}

export interface TodayLaneDto {
  lane: number;
  executor: { id: number; name: string; kind: ExecutorKind } | null;
  items: TodayItemDto[];
}

export interface TimeBudgetDto {
  leftMin: number;
  plannedMin: number;
  fitsCount: number;
  spillCount: number;
}

export interface TodayDto {
  plan: { plan_date: string; trigger: string; narrative: string; model: string | null; generated_at: string } | null;
  lanes: TodayLaneDto[];
  timeBudget: TimeBudgetDto | null;
}

export function todayDto(store: Store, time?: TimeOpts): TodayDto {
  const plan = store.getCurrentPlan();
  if (!plan) return { plan: null, lanes: [], timeBudget: null };

  const now = time?.now ?? new Date();
  const execById = new Map(store.listExecutors().map((e) => [e.id, e]));
  const selfExecIds = new Set(store.listExecutors().filter((e) => e.kind === "self").map((e) => e.id));
  const items = store.getPlanItems(plan.id); // ordered by lane, order_in_lane

  // Resolve each item with its task + stage; keep plan order for the time budget.
  const resolved = items
    .map((it) => {
      const task = store.getTask(it.task_id);
      const stage = store.getStage(it.stage_id);
      return task && stage ? { it, task, stage } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Time budget over the human's queue (self / unassigned, non-background), in plan order.
  const fitsByItem = new Map<number, boolean>();
  if (time) {
    const human = resolved.filter(
      ({ it }) =>
        it.scheduled_state !== "background" && (it.executor_id == null || selfExecIds.has(it.executor_id)),
    );
    const fit = timeBudget(human.map(({ stage }) => stage.effort), time.effortMinutes, time.timeLeftMin);
    human.forEach(({ it }, i) => fitsByItem.set(it.id, fit.perItem[i].fits));
  }

  const estMinOf = (eff: Effort | null): number => (time ? time.effortMinutes[eff ?? "medium"] : 0);

  const laneMap = new Map<number, TodayItemDto[]>();
  const laneExec = new Map<number, number | null>();
  let plannedMin = 0;
  let spillCount = 0;
  let fitsCount = 0;

  for (const { it, task, stage } of resolved) {
    if (!laneMap.has(it.lane)) {
      laneMap.set(it.lane, []);
      laneExec.set(it.lane, it.executor_id);
    }
    const fitsToday = fitsByItem.has(it.id) ? fitsByItem.get(it.id)! : true;
    const estMin = estMinOf(stage.effort);
    if (time && fitsByItem.has(it.id)) {
      plannedMin += estMin;
      if (fitsToday) fitsCount++;
      else spillCount++;
    }
    laneMap.get(it.lane)!.push({
      order_in_lane: it.order_in_lane,
      scheduled_state: it.scheduled_state,
      is_delegation_candidate: it.is_delegation_candidate,
      rationale: it.rationale,
      due: task.due,
      dueBand: dueBand(task.due, now),
      estMin,
      fitsToday,
      task: { id: task.id, title: task.title, priority: task.priority, type: task.type },
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
    timeBudget: time ? { leftMin: time.timeLeftMin, plannedMin, fitsCount, spillCount } : null,
  };
}

import type { Store } from "../db/store.js";
import type { Effort, ExecutorKind, Priority, StageKind, TaskStatus, TaskType } from "../types.js";
import { openDependencies } from "../service.js";

export interface PlannerExecutorRef {
  id: number;
  kind: ExecutorKind;
}

export function plannerExecutors(store: Store): PlannerExecutorRef[] {
  return store.listExecutors(true).map((e) => ({ id: e.id, kind: e.kind }));
}

// ---- Raw, human-readable board snapshot for the LLM planner ----

export interface PlanContextStage {
  stageId: number;
  name: string;
  kind: StageKind;
  effort: Effort | null;
  status: string;
  delegatable_to: ExecutorKind[];
}

export interface PlanContextFlow {
  taskId: number;
  title: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  due: string | null;
  /** Dependency task ids that are still open (the LLM must not start a flow with any). */
  openBlockers: number[];
  /** Remaining (not done/skipped) stages, in order. */
  stages: PlanContextStage[];
}

export interface PlanContext {
  date: string;
  executors: { id: number; name: string; kind: ExecutorKind; capacity: number; handles: StageKind[] }[];
  flows: PlanContextFlow[];
}

/** Build the LLM-facing board: open flows with their remaining stages + blockers. */
export function buildPlanContext(store: Store, date: string): PlanContext {
  const executors = store
    .listExecutors(true)
    .map((e) => ({ id: e.id, name: e.name, kind: e.kind, capacity: e.capacity, handles: e.handles }));

  const flows: PlanContextFlow[] = [];
  for (const task of store.listOpenTasks()) {
    const remaining = store.getStages(task.id).filter((s) => s.status !== "done" && s.status !== "skipped");
    if (remaining.length === 0) continue;
    flows.push({
      taskId: task.id,
      title: task.title,
      type: task.type,
      priority: task.priority,
      status: task.status,
      due: task.due,
      openBlockers: openDependencies(store, task.id),
      stages: remaining.map((s) => ({
        stageId: s.id,
        name: s.name,
        kind: s.kind,
        effort: s.effort,
        status: s.status,
        delegatable_to: s.delegatable_to,
      })),
    });
  }
  return { date, executors, flows };
}

/** Ids of all open (not done/skipped) stages — used to validate an LLM plan. */
export function openStageIds(store: Store): Set<number> {
  const ids = new Set<number>();
  for (const t of store.listOpenTasks()) {
    for (const s of store.getStages(t.id)) {
      if (s.status !== "done" && s.status !== "skipped") ids.add(s.id);
    }
  }
  return ids;
}

import type { Store } from "../db/store.js";
import type { Effort, ExecutorKind, Priority, Stage, StageKind, TaskStatus, TaskType } from "../types.js";
import { buildPlannerGraph, type PlannerExecutor, type PlannerInput, type PlannerStage } from "./graph.js";

function toPlannerStage(s: Stage): PlannerStage {
  return {
    id: s.id,
    seq: s.seq,
    status: s.status,
    effort: s.effort,
    kind: s.kind,
    delegatable_to: s.delegatable_to,
  };
}

/** Read the whole board into the plain PlannerInput the graph consumes. */
export function buildPlannerInput(store: Store): PlannerInput {
  const tasks = store.listTasks();
  const stages = new Map<number, PlannerStage[]>();
  for (const t of tasks) stages.set(t.id, store.getStages(t.id).map(toPlannerStage));
  const deps = store
    .listDependencies()
    .map((d) => ({ task_id: d.task_id, blocked_by_task_id: d.blocked_by_task_id }));
  return {
    tasks: tasks.map((t) => ({ id: t.id, priority: t.priority, status: t.status, title: t.title, due: t.due })),
    stages,
    deps,
  };
}

export function plannerExecutors(store: Store): PlannerExecutor[] {
  return store.listExecutors(true).map((e) => ({ id: e.id, kind: e.kind }));
}

// ---- Rich, human-readable context for the LLM planner ----

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
  ready: boolean;
  criticalPath: number;
  openBlockers: number[];
  /** Remaining (not done/skipped) stages, in order. */
  stages: PlanContextStage[];
}

export interface PlanContext {
  date: string;
  executors: { id: number; name: string; kind: ExecutorKind; capacity: number; handles: StageKind[] }[];
  flows: PlanContextFlow[];
}

/** Build the LLM-facing context: titles + remaining stages + readiness/critical-path. */
export function buildPlanContext(store: Store, date: string): PlanContext {
  const graph = buildPlannerGraph(buildPlannerInput(store));
  const executors = store
    .listExecutors(true)
    .map((e) => ({ id: e.id, name: e.name, kind: e.kind, capacity: e.capacity, handles: e.handles }));

  const flows: PlanContextFlow[] = [];
  for (const taskId of [...graph.ready, ...graph.waiting]) {
    const node = graph.nodes.get(taskId)!;
    const task = store.getTask(taskId)!;
    const remaining = store
      .getStages(taskId)
      .filter((s) => s.status !== "done" && s.status !== "skipped");
    flows.push({
      taskId,
      title: task.title,
      type: task.type,
      priority: task.priority,
      status: task.status,
      ready: node.ready,
      criticalPath: node.criticalPath,
      openBlockers: node.openBlockers,
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

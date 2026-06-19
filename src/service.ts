import type { Store } from "./db/store.js";
import type { Priority, Stage, StageStatus, Task, TaskStatus, TaskType } from "./types.js";
import { genericStage, type StageSpec } from "./breakdown/standard.js";
import { parseDueInput } from "./util/time.js";

export interface AddTaskInput {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: Priority;
  due?: string | null;
  blockedBy?: number[];
  source?: string;
  external_id?: string | null;
  /** Explicit stage list (e.g. from the LLM breakdown). If omitted, stages are derived. */
  stages?: StageSpec[];
}

export interface TaskWithStages {
  task: Task;
  stages: Stage[];
}

/** Use the breakdown's stages when provided; otherwise a single generic stage. */
function deriveStages(input: AddTaskInput): StageSpec[] {
  if (input.stages && input.stages.length) return input.stages;
  return genericStage(input.title);
}

/** Create a task with its stages + dependencies, then settle its status. */
export function addTask(store: Store, input: AddTaskInput): TaskWithStages {
  const task = store.createTask({
    title: input.title,
    description: input.description,
    type: input.type ?? "other",
    priority: input.priority,
    due: input.due ?? null,
    source: input.source ?? "cli",
    external_id: input.external_id ?? null,
    status: "todo",
  });

  const specs = deriveStages(input);
  specs.forEach((s, i) =>
    store.addStage({
      task_id: task.id,
      name: s.name,
      kind: s.kind,
      seq: i,
      effort: s.effort ?? null,
      delegatable_to: s.delegatable_to ?? [],
    }),
  );

  for (const dep of input.blockedBy ?? []) {
    if (dep !== task.id && store.getTask(dep)) store.addDependency(task.id, dep);
  }

  recomputeTaskStatus(store, task.id);
  return { task: store.getTask(task.id)!, stages: store.getStages(task.id) };
}

/** First stage that isn't done/skipped, by seq. */
export function nextOpenStage(store: Store, taskId: number): Stage | undefined {
  return store.getStages(taskId).find((s) => s.status !== "done" && s.status !== "skipped");
}

/** Open (not-done) dependency task ids for a task. */
export function openDependencies(store: Store, taskId: number): number[] {
  return store.blockedBy(taskId).filter((id) => {
    const t = store.getTask(id);
    return t ? t.status !== "done" : false;
  });
}

/**
 * Recompute a task's rollup status from its stages + dependencies.
 * Precedence: all stages done → done; open deps → blocked; any stage in progress → in_progress; else todo.
 * Explicit `backlog` is preserved unless the task is actually complete.
 */
export function recomputeTaskStatus(store: Store, taskId: number): TaskStatus {
  const task = store.getTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const stages = store.getStages(taskId);
  const allDone = stages.length > 0 && stages.every((s) => s.status === "done" || s.status === "skipped");
  const anyStarted = stages.some((s) => s.status === "in_progress" || s.status === "done");

  let status: TaskStatus;
  if (allDone) status = "done";
  else if (task.status === "backlog") status = "backlog";
  else if (openDependencies(store, taskId).length > 0) status = "blocked";
  else if (anyStarted) status = "in_progress";
  else status = "todo";

  if (status !== task.status) store.updateTask(taskId, { status });
  return status;
}

/** Advance a task's flow by completing its next open stage. */
export function advanceTask(store: Store, taskId: number): { completed?: Stage; task: Task } {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  const stage = nextOpenStage(store, taskId);
  if (stage) store.updateStage(stage.id, { status: "done" });
  recomputeTaskStatus(store, taskId);
  // Cascade: dependents may now be unblocked.
  resettleDependents(store, taskId);
  return { completed: stage, task: store.getTask(taskId)! };
}

/** Mark every stage of a task done (complete the whole flow). */
export function completeTask(store: Store, taskId: number): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  for (const s of store.getStages(taskId)) {
    if (s.status !== "done") store.updateStage(s.id, { status: "done" });
  }
  recomputeTaskStatus(store, taskId);
  resettleDependents(store, taskId);
  return store.getTask(taskId)!;
}

/**
 * Set a single stage's status independently of its siblings, then resettle the
 * task's rollup status + its dependents. This is what the Today cards use so each
 * stage of a multi-stage task starts/completes on its own.
 */
export function setStageStatus(store: Store, stageId: number, status: StageStatus): Stage {
  const stage = store.getStage(stageId);
  if (!stage) throw new Error(`stage ${stageId} not found`);
  store.updateStage(stageId, { status });
  recomputeTaskStatus(store, stage.task_id);
  resettleDependents(store, stage.task_id);
  return store.getStage(stageId)!;
}

/** Complete a specific stage, then resettle its task. */
export function completeStage(store: Store, stageId: number): Stage {
  return setStageStatus(store, stageId, "done");
}

/**
 * Set (or clear) a task's deadline. `dueInput` accepts YYYY-MM-DD, `+Nd`,
 * `today`, `tomorrow`, or `clear`/`none` (see parseDueInput). Throws on an
 * unknown task or an unparseable date.
 */
export function setTaskDue(store: Store, taskId: number, dueInput: string): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  const due = parseDueInput(dueInput);
  store.updateTask(taskId, { due });
  return store.getTask(taskId)!;
}

/**
 * Derive a task's `due` from its stages: the latest (max) stage due, so the task
 * date tracks its final step. If no stage carries a date, the task's own `due`
 * (a manual/CLI deadline) is left untouched.
 */
export function syncTaskDueFromStages(store: Store, taskId: number): Task | undefined {
  const task = store.getTask(taskId);
  if (!task) return undefined;
  const dues = store.getStages(taskId).map((s) => s.due).filter((d): d is string => !!d);
  if (dues.length === 0) return task; // no stage dates → keep the task's own due
  const max = dues.reduce((a, b) => (a >= b ? a : b));
  if (max !== task.due) store.updateTask(taskId, { due: max });
  return store.getTask(taskId)!;
}

/**
 * Set (or clear) a single stage's completion date, then re-derive its task's due.
 * `dueInput` accepts the same forms as `setTaskDue` (YYYY-MM-DD, +Nd, today, clear…).
 */
export function setStageDue(store: Store, stageId: number, dueInput: string): Stage {
  const stage = store.getStage(stageId);
  if (!stage) throw new Error(`stage ${stageId} not found`);
  const due = parseDueInput(dueInput);
  store.updateStage(stageId, { due });
  syncTaskDueFromStages(store, stage.task_id);
  return store.getStage(stageId)!;
}

/** Change a task's priority. */
export function setTaskPriority(store: Store, taskId: number, priority: Priority): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  store.updateTask(taskId, { priority });
  return store.getTask(taskId)!;
}

/** Rename a task. Trims; rejects an empty title. Keeps a lone generic stage's name in sync. */
export function setTaskTitle(store: Store, taskId: number, title: string): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  const t = title.trim();
  if (!t) throw new Error("title cannot be empty");
  store.updateTask(taskId, { title: t });
  // A single generic stage IS the task's work, so keep its name equal to the title.
  const stages = store.getStages(taskId);
  if (stages.length === 1 && stages[0].kind === "generic") store.updateStage(stages[0].id, { name: t });
  return store.getTask(taskId)!;
}

/** Set a task's free-form notes/details (the description). Empty is allowed. */
export function setTaskDescription(store: Store, taskId: number, description: string): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  store.updateTask(taskId, { description });
  return store.getTask(taskId)!;
}

/** Set a task's status explicitly. */
export function setTaskStatus(store: Store, taskId: number, status: TaskStatus): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  // A task whose stages are all complete IS done — never let an out-of-order
  // status write (e.g. a "start" click that lands after "done") un-complete it.
  const stages = store.getStages(taskId);
  const allDone = stages.length > 0 && stages.every((s) => s.status === "done" || s.status === "skipped");
  store.updateTask(taskId, { status: allDone ? "done" : status });
  return store.getTask(taskId)!;
}

export function blockTask(store: Store, taskId: number, byTaskId: number): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  if (!store.getTask(byTaskId)) throw new Error(`task ${byTaskId} not found`);
  store.addDependency(taskId, byTaskId);
  recomputeTaskStatus(store, taskId);
  return store.getTask(taskId)!;
}

export function unblockTask(store: Store, taskId: number, byTaskId: number): Task {
  store.removeDependency(taskId, byTaskId);
  recomputeTaskStatus(store, taskId);
  return store.getTask(taskId)!;
}

/** Delete a task and its stages/dependencies (FK cascade); re-settle dependents. */
export function removeTask(store: Store, taskId: number): void {
  const dependents = store
    .listDependencies()
    .filter((d) => d.blocked_by_task_id === taskId)
    .map((d) => d.task_id);
  store.deleteTask(taskId);
  for (const dep of dependents) {
    if (store.getTask(dep)) recomputeTaskStatus(store, dep);
  }
}

/** When a task changes, re-settle any tasks that depend on it. */
function resettleDependents(store: Store, taskId: number): void {
  const dependents = store
    .listDependencies()
    .filter((d) => d.blocked_by_task_id === taskId)
    .map((d) => d.task_id);
  for (const id of new Set(dependents)) recomputeTaskStatus(store, id);
}

import {
  EFFORT_WEIGHT,
  PRIORITY_RANK,
  type Effort,
  type ExecutorKind,
  type Priority,
  type StageKind,
  type TaskStatus,
} from "../types.js";
import type { PlanItemInput } from "../db/store.js";
import { clusterByTitle, incrementalGroups, phaseRank } from "./grouping.js";
import { dueBand } from "../util/time.js";

/** overdue=0, today=1 float to the top of a lane; everything else=2. */
function dueFloat(due: string | null | undefined, now: Date): number {
  const band = dueBand(due, now);
  return band === "overdue" ? 0 : band === "today" ? 1 : 2;
}

// ---- Plain inputs (decoupled from the DB so the graph is trivially testable) ----

export interface PlannerTask {
  id: number;
  priority: Priority;
  status: TaskStatus;
  /** Used by the deterministic planner to group similar tasks into one lane. */
  title?: string;
  /** Due date — overdue/today float to the top of their lane. */
  due?: string | null;
}

export interface PlannerStage {
  id: number;
  seq: number;
  status: string;
  effort: Effort | null;
  kind: StageKind;
  delegatable_to: ExecutorKind[];
}

export interface PlannerExecutor {
  id: number;
  kind: ExecutorKind;
}

export interface PlannerInput {
  tasks: PlannerTask[];
  /** taskId → its stages (any order; sorted by seq internally). */
  stages: Map<number, PlannerStage[]>;
  deps: { task_id: number; blocked_by_task_id: number }[];
}

export interface PlannerNode {
  taskId: number;
  priority: Priority;
  nextStageId: number | null;
  remainingStageIds: number[];
  remainingEffort: number;
  /** All declared blockers (task ids). */
  blockers: number[];
  /** Blockers that are still open (in the open-task set). */
  openBlockers: number[];
  ready: boolean;
  /** Remaining effort of this flow plus the worst remaining blocker chain. */
  criticalPath: number;
}

export interface PlannerGraph {
  nodes: Map<number, PlannerNode>;
  topoOrder: number[];
  cycle: number[] | null;
  /** Open task ids with no open blockers, ordered for action. */
  ready: number[];
  /** Open task ids waiting on blockers, ordered. */
  waiting: number[];
}

const STAGE_DONE = new Set(["done", "skipped"]);

function isOpenStage(s: PlannerStage): boolean {
  return !STAGE_DONE.has(s.status);
}

function remainingStages(stages: PlannerStage[]): PlannerStage[] {
  return [...stages].sort((a, b) => a.seq - b.seq).filter(isOpenStage);
}

function effortOf(stages: PlannerStage[]): number {
  return stages.reduce((sum, s) => sum + EFFORT_WEIGHT[s.effort ?? "medium"], 0);
}

/** Build the dependency/readiness/critical-path graph over open tasks only. */
export function buildPlannerGraph(input: PlannerInput): PlannerGraph {
  const open = input.tasks.filter((t) => t.status !== "done");
  const openIds = new Set(open.map((t) => t.id));

  // blockers per task (only those still open count toward readiness)
  const blockersByTask = new Map<number, number[]>();
  for (const t of open) blockersByTask.set(t.id, []);
  for (const d of input.deps) {
    if (!openIds.has(d.task_id)) continue;
    blockersByTask.get(d.task_id)!.push(d.blocked_by_task_id);
  }

  const nodes = new Map<number, PlannerNode>();
  for (const t of open) {
    const remaining = remainingStages(input.stages.get(t.id) ?? []);
    const blockers = blockersByTask.get(t.id) ?? [];
    const openBlockers = blockers.filter((b) => openIds.has(b));
    nodes.set(t.id, {
      taskId: t.id,
      priority: t.priority,
      nextStageId: remaining[0]?.id ?? null,
      remainingStageIds: remaining.map((s) => s.id),
      remainingEffort: effortOf(remaining),
      blockers,
      openBlockers,
      ready: openBlockers.length === 0,
      criticalPath: 0, // filled below
    });
  }

  // topo sort (Kahn) over edges blocker → task, deterministic by id
  const { order, cycle } = topoSort(nodes);

  // critical path: remainingEffort + max over open blockers (cycle-safe DFS)
  const cp = new Map<number, number>();
  const visiting = new Set<number>();
  const dfs = (id: number): number => {
    if (cp.has(id)) return cp.get(id)!;
    if (visiting.has(id)) return 0; // back-edge in a cycle → contribute nothing
    visiting.add(id);
    const node = nodes.get(id)!;
    let worstBlocker = 0;
    for (const b of node.openBlockers) {
      if (nodes.has(b)) worstBlocker = Math.max(worstBlocker, dfs(b));
    }
    visiting.delete(id);
    const value = node.remainingEffort + worstBlocker;
    cp.set(id, value);
    return value;
  };
  for (const id of nodes.keys()) {
    const v = dfs(id);
    nodes.get(id)!.criticalPath = v;
  }

  const ready: number[] = [];
  const waiting: number[] = [];
  for (const node of nodes.values()) (node.ready ? ready : waiting).push(node.taskId);
  ready.sort(actionOrder(nodes));
  waiting.sort(actionOrder(nodes));

  return { nodes, topoOrder: order, cycle, ready, waiting };
}

/** Sort comparator: higher priority first, then longer critical path, then lower id. */
function actionOrder(nodes: Map<number, PlannerNode>): (a: number, b: number) => number {
  return (a, b) => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const p = PRIORITY_RANK[na.priority] - PRIORITY_RANK[nb.priority];
    if (p !== 0) return p;
    if (nb.criticalPath !== na.criticalPath) return nb.criticalPath - na.criticalPath;
    return a - b;
  };
}

function topoSort(nodes: Map<number, PlannerNode>): { order: number[]; cycle: number[] | null } {
  const indegree = new Map<number, number>();
  const out = new Map<number, number[]>(); // blocker → [dependents]
  for (const id of nodes.keys()) {
    indegree.set(id, 0);
    out.set(id, []);
  }
  for (const node of nodes.values()) {
    for (const b of node.openBlockers) {
      if (!nodes.has(b)) continue;
      indegree.set(node.taskId, (indegree.get(node.taskId) ?? 0) + 1);
      out.get(b)!.push(node.taskId);
    }
  }
  const order: number[] = [];
  let frontier = [...nodes.keys()].filter((id) => (indegree.get(id) ?? 0) === 0).sort((a, b) => a - b);
  while (frontier.length) {
    const id = frontier.shift()!;
    order.push(id);
    for (const dep of out.get(id)!) {
      indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
      if (indegree.get(dep) === 0) frontier.push(dep);
    }
    frontier.sort((a, b) => a - b);
  }
  if (order.length < nodes.size) {
    const cycle = [...nodes.keys()].filter((id) => !order.includes(id)).sort((a, b) => a - b);
    return { order, cycle };
  }
  return { order, cycle: null };
}

export type PlanMode = "full" | "incremental";

export interface DeterministicPlanOpts {
  /** 'full' re-clusters from scratch; 'incremental' keeps existing lanes sticky. */
  mode?: PlanMode;
  /** taskId → lane, for incremental mode. */
  existingLanes?: Map<number, number>;
  stageLookup?: Map<number, PlannerStage>;
}

export interface DeterministicPlan {
  items: PlanItemInput[];
  narrative: string;
  /** taskId → lane index, to persist as sticky membership. */
  membership: Map<number, number>;
}

/**
 * A no-LLM plan: open flows are GROUPED INTO LANES by title similarity (so
 * related work shares a lane instead of one lane per task). Lanes are ordered by
 * the priority/critical-path of their most important member; within a lane,
 * tasks are ordered design → implementation → testing. Only the lane's first
 * actionable (ready) step is marked start_now. Delegatable stages are flagged
 * even though everything is currently assigned to "self".
 */
export function deterministicPlan(
  input: PlannerInput,
  executors: PlannerExecutor[],
  maxLanes = 8,
  opts: DeterministicPlanOpts = {},
): DeterministicPlan {
  const mode = opts.mode ?? "full";
  const graph = buildPlannerGraph(input);
  const self = executors.find((e) => e.kind === "self") ?? executors[0];
  const selfId = self?.id ?? null;

  const stageById = opts.stageLookup ?? new Map<number, PlannerStage>();
  if (!opts.stageLookup) {
    for (const list of input.stages.values()) for (const s of list) stageById.set(s.id, s);
  }
  const titleById = new Map(input.tasks.map((t) => [t.id, t.title ?? ""]));
  const dueById = new Map(input.tasks.map((t) => [t.id, t.due ?? null]));
  const now = new Date();

  // Action order = priority, then critical path, then id (graph.ready/waiting already sorted).
  const ordered = [...graph.ready, ...graph.waiting];
  const actionIndex = new Map(ordered.map((id, i) => [id, i]));

  const firstStageKind = (taskId: number): string | undefined => {
    const sid = graph.nodes.get(taskId)?.remainingStageIds[0];
    return sid != null ? stageById.get(sid)?.kind : undefined;
  };

  // Lane membership: incremental keeps existing lanes sticky; full re-clusters.
  const groups =
    mode === "incremental"
      ? incrementalGroups(ordered, opts.existingLanes ?? new Map(), maxLanes, titleById)
      : clusterByTitle(ordered.map((id) => ({ id, title: titleById.get(id) ?? "" })), maxLanes);

  // Order within each lane: overdue/due-today float to the top, then phase
  // (design → implementation → testing), then priority.
  for (const g of groups) {
    g.sort((a, b) => {
      const da = dueFloat(dueById.get(a), now);
      const db = dueFloat(dueById.get(b), now);
      if (da !== db) return da - db;
      const pa = phaseRank(titleById.get(a) ?? "", firstStageKind(a));
      const pb = phaseRank(titleById.get(b) ?? "", firstStageKind(b));
      if (pa !== pb) return pa - pb;
      return (actionIndex.get(a) ?? 0) - (actionIndex.get(b) ?? 0);
    });
  }
  // Order lanes by their most important member — but only for a full re-cluster.
  // Incremental keeps stored lane order so lane numbers stay stable through the day.
  if (mode === "full") {
    groups.sort(
      (g1, g2) =>
        Math.min(...g1.map((id) => actionIndex.get(id) ?? 0)) -
        Math.min(...g2.map((id) => actionIndex.get(id) ?? 0)),
    );
  }

  const membership = new Map<number, number>();
  const items: PlanItemInput[] = [];
  groups.forEach((group, lane) => {
    let laneHasNow = false;
    let order = 0;
    for (const taskId of group) membership.set(taskId, lane);
    for (const taskId of group) {
      const node = graph.nodes.get(taskId)!;
      node.remainingStageIds.forEach((stageId, j) => {
        const stage = stageById.get(stageId);
        const delegatable = !!stage && stage.delegatable_to.some((k) => k !== "self");
        let scheduled: PlanItemInput["scheduled_state"] = "waiting";
        if (!laneHasNow && node.ready && j === 0) {
          scheduled = "start_now";
          laneHasNow = true;
        }
        items.push({
          task_id: taskId,
          stage_id: stageId,
          lane,
          order_in_lane: order++,
          executor_id: selfId,
          is_delegation_candidate: delegatable,
          scheduled_state: scheduled,
          rationale: "",
        });
      });
    }
  });

  const nowLanes = new Set(items.filter((i) => i.scheduled_state === "start_now").map((i) => i.lane)).size;
  const delegatable = items.filter((i) => i.is_delegation_candidate).length;
  const narrative =
    `${groups.length} lane(s) across ${ordered.length} open flow(s); ${nowLanes} ready to start now. ` +
    `Within each lane: design → implementation → testing.` +
    (delegatable ? ` ${delegatable} step(s) could be delegated to free up your critical path.` : "") +
    (graph.cycle ? ` ⚠ dependency cycle among #${graph.cycle.join(", #")}.` : "");

  return { items, narrative, membership };
}

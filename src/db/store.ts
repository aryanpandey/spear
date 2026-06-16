import type { DB } from "./index.js";
import { nowIso } from "../util/time.js";
import type {
  DailyPlan,
  Dependency,
  Effort,
  Executor,
  ExecutorKind,
  Goal,
  GoalStatus,
  PlanItem,
  PlanTrigger,
  Priority,
  ScheduledState,
  Scorecard,
  ScorecardBonus,
  ScorecardMetric,
  Stage,
  StageKind,
  StageStatus,
  Task,
  TaskStatus,
  TaskType,
} from "../types.js";

export interface NewTask {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: Priority;
  status?: TaskStatus;
  effort?: Effort | null;
  due?: string | null;
  source?: string;
  external_id?: string | null;
}

export interface NewStage {
  task_id: number;
  name: string;
  kind: StageKind;
  seq: number;
  status?: StageStatus;
  effort?: Effort | null;
  delegatable_to?: ExecutorKind[];
}

export interface NewExecutor {
  name: string;
  kind: ExecutorKind;
  capacity?: number;
  handles?: StageKind[];
  active?: boolean;
}

export interface PlanItemInput {
  task_id: number;
  stage_id: number;
  lane: number;
  order_in_lane: number;
  executor_id: number | null;
  is_delegation_candidate: boolean;
  scheduled_state: ScheduledState;
  rationale: string;
}

export interface NewGoal {
  title: string;
  notes?: string;
  status?: GoalStatus;
  sort?: number;
}

export interface NewScorecard {
  title?: string;
  week_of?: string | null;
  bonus_reward?: string;
  is_current?: boolean;
}

export interface NewMetric {
  scorecard_id: number;
  name: string;
  progress?: number;
  goal?: number;
  weight?: number;
  sort?: number;
}

export interface NewBonus {
  scorecard_id: number;
  task: string;
  reward?: string;
  done?: boolean;
  sort?: number;
}

/** Typed, JSON-aware wrapper around the spear SQLite database. */
export class Store {
  constructor(public readonly db: DB) {}

  // ---- tasks ----

  createTask(input: NewTask): Task {
    const ts = nowIso();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (title, description, type, priority, status, effort, due, source, external_id, created_at, updated_at)
      VALUES (@title, @description, @type, @priority, @status, @effort, @due, @source, @external_id, @created_at, @updated_at)
    `);
    const info = stmt.run({
      title: input.title,
      description: input.description ?? "",
      type: input.type ?? "other",
      priority: input.priority ?? "medium",
      status: input.status ?? "todo",
      effort: input.effort ?? null,
      due: input.due ?? null,
      source: input.source ?? "cli",
      external_id: input.external_id ?? null,
      created_at: ts,
      updated_at: ts,
    });
    return this.getTask(Number(info.lastInsertRowid))!;
  }

  getTask(id: number): Task | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? mapTask(row) : undefined;
  }

  getTaskByExternalId(externalId: string): Task | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE external_id = ?").get(externalId) as
      | TaskRow
      | undefined;
    return row ? mapTask(row) : undefined;
  }

  listTasks(filter: { status?: TaskStatus; priority?: Priority; type?: TaskType } = {}): Task[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.status) {
      clauses.push("status = @status");
      params.status = filter.status;
    }
    if (filter.priority) {
      clauses.push("priority = @priority");
      params.priority = filter.priority;
    }
    if (filter.type) {
      clauses.push("type = @type");
      params.type = filter.type;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY id ASC`)
      .all(params) as TaskRow[];
    return rows.map(mapTask);
  }

  /** Open tasks = anything not done. */
  listOpenTasks(): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE status != 'done' ORDER BY id ASC")
      .all() as TaskRow[];
    return rows.map(mapTask);
  }

  updateTask(id: number, patch: Partial<Omit<Task, "id" | "created_at">>): Task | undefined {
    const current = this.getTask(id);
    if (!current) return undefined;
    const merged = { ...current, ...patch, updated_at: nowIso() };
    this.db
      .prepare(
        `UPDATE tasks SET title=@title, description=@description, type=@type, priority=@priority,
         status=@status, effort=@effort, due=@due, source=@source, external_id=@external_id, updated_at=@updated_at
         WHERE id=@id`,
      )
      .run({ ...merged, id });
    return this.getTask(id);
  }

  deleteTask(id: number): void {
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }

  /** Set a task's persistent lane (does not bump updated_at — it's plan-internal). */
  setTaskLane(id: number, lane: number | null): void {
    this.db.prepare("UPDATE tasks SET lane = ? WHERE id = ?").run(lane, id);
  }

  /** Store the pre-computed due-date suggestion (plan-internal; does not bump updated_at). */
  setSuggestedDue(id: number, date: string | null, reason: string | null): void {
    this.db.prepare("UPDATE tasks SET suggested_due = ?, suggested_due_reason = ? WHERE id = ?").run(date, reason, id);
  }

  // ---- meta (key/value) ----

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // ---- stages ----

  addStage(input: NewStage): Stage {
    const info = this.db
      .prepare(
        `INSERT INTO stages (task_id, name, kind, seq, status, effort, delegatable_to)
         VALUES (@task_id, @name, @kind, @seq, @status, @effort, @delegatable_to)`,
      )
      .run({
        task_id: input.task_id,
        name: input.name,
        kind: input.kind,
        seq: input.seq,
        status: input.status ?? "todo",
        effort: input.effort ?? null,
        delegatable_to: JSON.stringify(input.delegatable_to ?? []),
      });
    return this.getStage(Number(info.lastInsertRowid))!;
  }

  getStage(id: number): Stage | undefined {
    const row = this.db.prepare("SELECT * FROM stages WHERE id = ?").get(id) as StageRow | undefined;
    return row ? mapStage(row) : undefined;
  }

  getStages(taskId: number): Stage[] {
    const rows = this.db
      .prepare("SELECT * FROM stages WHERE task_id = ? ORDER BY seq ASC")
      .all(taskId) as StageRow[];
    return rows.map(mapStage);
  }

  /** All stages for the given task ids, keyed by task id (ordered by seq). */
  stagesByTask(taskIds: number[]): Map<number, Stage[]> {
    const out = new Map<number, Stage[]>();
    for (const id of taskIds) out.set(id, this.getStages(id));
    return out;
  }

  updateStage(id: number, patch: Partial<Omit<Stage, "id" | "task_id">>): Stage | undefined {
    const current = this.getStage(id);
    if (!current) return undefined;
    const merged = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE stages SET name=@name, kind=@kind, seq=@seq, status=@status, effort=@effort, delegatable_to=@delegatable_to WHERE id=@id`,
      )
      .run({
        name: merged.name,
        kind: merged.kind,
        seq: merged.seq,
        status: merged.status,
        effort: merged.effort,
        delegatable_to: JSON.stringify(merged.delegatable_to),
        id,
      });
    return this.getStage(id);
  }

  // ---- dependencies ----

  addDependency(taskId: number, blockedByTaskId: number): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO dependencies (task_id, blocked_by_task_id) VALUES (?, ?)",
      )
      .run(taskId, blockedByTaskId);
  }

  removeDependency(taskId: number, blockedByTaskId: number): void {
    this.db
      .prepare("DELETE FROM dependencies WHERE task_id = ? AND blocked_by_task_id = ?")
      .run(taskId, blockedByTaskId);
  }

  listDependencies(): Dependency[] {
    return this.db.prepare("SELECT * FROM dependencies").all() as Dependency[];
  }

  blockedBy(taskId: number): number[] {
    const rows = this.db
      .prepare("SELECT blocked_by_task_id FROM dependencies WHERE task_id = ?")
      .all(taskId) as { blocked_by_task_id: number }[];
    return rows.map((r) => r.blocked_by_task_id);
  }

  // ---- executors ----

  addExecutor(input: NewExecutor): Executor {
    const info = this.db
      .prepare(
        `INSERT INTO executors (name, kind, capacity, handles, active)
         VALUES (@name, @kind, @capacity, @handles, @active)`,
      )
      .run({
        name: input.name,
        kind: input.kind,
        capacity: input.capacity ?? 1,
        handles: JSON.stringify(input.handles ?? []),
        active: input.active === false ? 0 : 1,
      });
    return this.getExecutor(Number(info.lastInsertRowid))!;
  }

  getExecutor(id: number): Executor | undefined {
    const row = this.db.prepare("SELECT * FROM executors WHERE id = ?").get(id) as
      | ExecutorRow
      | undefined;
    return row ? mapExecutor(row) : undefined;
  }

  listExecutors(activeOnly = false): Executor[] {
    const sql = activeOnly
      ? "SELECT * FROM executors WHERE active = 1 ORDER BY id ASC"
      : "SELECT * FROM executors ORDER BY id ASC";
    return (this.db.prepare(sql).all() as ExecutorRow[]).map(mapExecutor);
  }

  removeExecutor(id: number): void {
    this.db.prepare("DELETE FROM executors WHERE id = ?").run(id);
  }

  /** Seed the single "Me" executor if the roster is empty. */
  seedDefaults(): void {
    const count = (this.db.prepare("SELECT COUNT(*) AS c FROM executors").get() as { c: number }).c;
    if (count === 0) {
      this.addExecutor({
        name: "Me",
        kind: "self",
        capacity: 1,
        handles: ["planning", "implementation", "testing", "stage_testing", "generic"],
        active: true,
      });
    }
  }

  // ---- plans ----

  savePlan(
    meta: { plan_date: string; trigger: PlanTrigger; narrative: string; model: string | null },
    items: PlanItemInput[],
  ): DailyPlan {
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE daily_plans SET is_current = 0 WHERE is_current = 1").run();
      const info = this.db
        .prepare(
          `INSERT INTO daily_plans (plan_date, generated_at, trigger, narrative, model, is_current)
           VALUES (@plan_date, @generated_at, @trigger, @narrative, @model, 1)`,
        )
        .run({
          plan_date: meta.plan_date,
          generated_at: nowIso(),
          trigger: meta.trigger,
          narrative: meta.narrative,
          model: meta.model,
        });
      const planId = Number(info.lastInsertRowid);
      const insItem = this.db.prepare(
        `INSERT INTO plan_items (plan_id, task_id, stage_id, lane, order_in_lane, executor_id, is_delegation_candidate, scheduled_state, rationale)
         VALUES (@plan_id, @task_id, @stage_id, @lane, @order_in_lane, @executor_id, @is_delegation_candidate, @scheduled_state, @rationale)`,
      );
      for (const it of items) {
        insItem.run({
          plan_id: planId,
          task_id: it.task_id,
          stage_id: it.stage_id,
          lane: it.lane,
          order_in_lane: it.order_in_lane,
          executor_id: it.executor_id,
          is_delegation_candidate: it.is_delegation_candidate ? 1 : 0,
          scheduled_state: it.scheduled_state,
          rationale: it.rationale,
        });
      }
      return planId;
    });
    const planId = tx();
    return this.getPlan(planId)!;
  }

  getPlan(id: number): DailyPlan | undefined {
    const row = this.db.prepare("SELECT * FROM daily_plans WHERE id = ?").get(id) as
      | DailyPlanRow
      | undefined;
    return row ? mapPlan(row) : undefined;
  }

  getCurrentPlan(): DailyPlan | undefined {
    const row = this.db
      .prepare("SELECT * FROM daily_plans WHERE is_current = 1 ORDER BY id DESC LIMIT 1")
      .get() as DailyPlanRow | undefined;
    return row ? mapPlan(row) : undefined;
  }

  getPlanItems(planId: number): PlanItem[] {
    const rows = this.db
      .prepare("SELECT * FROM plan_items WHERE plan_id = ? ORDER BY lane ASC, order_in_lane ASC")
      .all(planId) as PlanItemRow[];
    return rows.map(mapPlanItem);
  }

  // ---- goals (simple list) ----

  createGoal(input: NewGoal): Goal {
    const ts = nowIso();
    const sort = input.sort ?? this.nextGoalSort();
    const info = this.db
      .prepare(
        `INSERT INTO goals (title, notes, status, sort, created_at, updated_at)
         VALUES (@title, @notes, @status, @sort, @created_at, @updated_at)`,
      )
      .run({
        title: input.title,
        notes: input.notes ?? "",
        status: input.status ?? "active",
        sort,
        created_at: ts,
        updated_at: ts,
      });
    return this.getGoal(Number(info.lastInsertRowid))!;
  }

  private nextGoalSort(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM goals").get() as { n: number };
    return row.n;
  }

  getGoal(id: number): Goal | undefined {
    const row = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined;
    return row ? mapGoal(row) : undefined;
  }

  listGoals(): Goal[] {
    const rows = this.db.prepare("SELECT * FROM goals ORDER BY sort ASC, id ASC").all() as GoalRow[];
    return rows.map(mapGoal);
  }

  updateGoal(id: number, patch: Partial<Omit<Goal, "id" | "created_at">>): Goal | undefined {
    const current = this.getGoal(id);
    if (!current) return undefined;
    const merged = { ...current, ...patch, updated_at: nowIso() };
    this.db
      .prepare(
        `UPDATE goals SET title=@title, notes=@notes, status=@status, sort=@sort, updated_at=@updated_at WHERE id=@id`,
      )
      .run({ ...merged, id });
    return this.getGoal(id);
  }

  deleteGoal(id: number): void {
    this.db.prepare("DELETE FROM goals WHERE id = ?").run(id);
  }

  // ---- scorecards (weekly focus) ----

  createScorecard(input: NewScorecard): Scorecard {
    const ts = nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO scorecards (title, week_of, bonus_reward, is_current, created_at, updated_at)
         VALUES (@title, @week_of, @bonus_reward, @is_current, @created_at, @updated_at)`,
      )
      .run({
        title: input.title ?? "Weekly Focus",
        week_of: input.week_of ?? null,
        bonus_reward: input.bonus_reward ?? "",
        is_current: input.is_current ? 1 : 0,
        created_at: ts,
        updated_at: ts,
      });
    const id = Number(info.lastInsertRowid);
    if (input.is_current) this.setCurrentScorecard(id);
    return this.getScorecard(id)!;
  }

  getScorecard(id: number): Scorecard | undefined {
    const row = this.db.prepare("SELECT * FROM scorecards WHERE id = ?").get(id) as ScorecardRow | undefined;
    return row ? mapScorecard(row) : undefined;
  }

  listScorecards(): Scorecard[] {
    const rows = this.db
      .prepare("SELECT * FROM scorecards ORDER BY is_current DESC, id DESC")
      .all() as ScorecardRow[];
    return rows.map(mapScorecard);
  }

  getCurrentScorecard(): Scorecard | undefined {
    const row = this.db
      .prepare("SELECT * FROM scorecards WHERE is_current = 1 ORDER BY id DESC LIMIT 1")
      .get() as ScorecardRow | undefined;
    return row ? mapScorecard(row) : undefined;
  }

  /** Mark one scorecard current and clear the flag on all others. */
  setCurrentScorecard(id: number): void {
    const tx = this.db.transaction((cardId: number) => {
      this.db.prepare("UPDATE scorecards SET is_current = 0").run();
      this.db.prepare("UPDATE scorecards SET is_current = 1, updated_at = ? WHERE id = ?").run(nowIso(), cardId);
    });
    tx(id);
  }

  updateScorecard(
    id: number,
    patch: Partial<Pick<Scorecard, "title" | "week_of" | "bonus_reward">>,
  ): Scorecard | undefined {
    const current = this.getScorecard(id);
    if (!current) return undefined;
    const merged = { ...current, ...patch, updated_at: nowIso() };
    this.db
      .prepare(
        `UPDATE scorecards SET title=@title, week_of=@week_of, bonus_reward=@bonus_reward, updated_at=@updated_at WHERE id=@id`,
      )
      .run({
        title: merged.title,
        week_of: merged.week_of,
        bonus_reward: merged.bonus_reward,
        updated_at: merged.updated_at,
        id,
      });
    return this.getScorecard(id);
  }

  deleteScorecard(id: number): void {
    this.db.prepare("DELETE FROM scorecards WHERE id = ?").run(id);
  }

  // ---- scorecard metrics ----

  addMetric(input: NewMetric): ScorecardMetric {
    const sort = input.sort ?? this.nextRowSort("scorecard_metrics", input.scorecard_id);
    const info = this.db
      .prepare(
        `INSERT INTO scorecard_metrics (scorecard_id, name, progress, goal, weight, sort)
         VALUES (@scorecard_id, @name, @progress, @goal, @weight, @sort)`,
      )
      .run({
        scorecard_id: input.scorecard_id,
        name: input.name,
        progress: input.progress ?? 0,
        goal: input.goal ?? 0,
        weight: input.weight ?? 0,
        sort,
      });
    return this.getMetric(Number(info.lastInsertRowid))!;
  }

  getMetric(id: number): ScorecardMetric | undefined {
    const row = this.db.prepare("SELECT * FROM scorecard_metrics WHERE id = ?").get(id) as
      | ScorecardMetric
      | undefined;
    return row ?? undefined;
  }

  listMetrics(scorecardId: number): ScorecardMetric[] {
    return this.db
      .prepare("SELECT * FROM scorecard_metrics WHERE scorecard_id = ? ORDER BY sort ASC, id ASC")
      .all(scorecardId) as ScorecardMetric[];
  }

  updateMetric(
    id: number,
    patch: Partial<Pick<ScorecardMetric, "name" | "progress" | "goal" | "weight" | "sort">>,
  ): ScorecardMetric | undefined {
    const current = this.getMetric(id);
    if (!current) return undefined;
    const merged = { ...current, ...patch };
    this.db
      .prepare(
        `UPDATE scorecard_metrics SET name=@name, progress=@progress, goal=@goal, weight=@weight, sort=@sort WHERE id=@id`,
      )
      .run({ name: merged.name, progress: merged.progress, goal: merged.goal, weight: merged.weight, sort: merged.sort, id });
    return this.getMetric(id);
  }

  deleteMetric(id: number): void {
    this.db.prepare("DELETE FROM scorecard_metrics WHERE id = ?").run(id);
  }

  // ---- scorecard bonus tasks ----

  addBonus(input: NewBonus): ScorecardBonus {
    const sort = input.sort ?? this.nextRowSort("scorecard_bonuses", input.scorecard_id);
    const info = this.db
      .prepare(
        `INSERT INTO scorecard_bonuses (scorecard_id, task, reward, done, sort)
         VALUES (@scorecard_id, @task, @reward, @done, @sort)`,
      )
      .run({
        scorecard_id: input.scorecard_id,
        task: input.task,
        reward: input.reward ?? "",
        done: input.done ? 1 : 0,
        sort,
      });
    return this.getBonus(Number(info.lastInsertRowid))!;
  }

  getBonus(id: number): ScorecardBonus | undefined {
    const row = this.db.prepare("SELECT * FROM scorecard_bonuses WHERE id = ?").get(id) as BonusRow | undefined;
    return row ? mapBonus(row) : undefined;
  }

  listBonuses(scorecardId: number): ScorecardBonus[] {
    const rows = this.db
      .prepare("SELECT * FROM scorecard_bonuses WHERE scorecard_id = ? ORDER BY sort ASC, id ASC")
      .all(scorecardId) as BonusRow[];
    return rows.map(mapBonus);
  }

  updateBonus(
    id: number,
    patch: Partial<Pick<ScorecardBonus, "task" | "reward" | "done" | "sort">>,
  ): ScorecardBonus | undefined {
    const current = this.getBonus(id);
    if (!current) return undefined;
    const merged = { ...current, ...patch };
    this.db
      .prepare(`UPDATE scorecard_bonuses SET task=@task, reward=@reward, done=@done, sort=@sort WHERE id=@id`)
      .run({ task: merged.task, reward: merged.reward, done: merged.done ? 1 : 0, sort: merged.sort, id });
    return this.getBonus(id);
  }

  deleteBonus(id: number): void {
    this.db.prepare("DELETE FROM scorecard_bonuses WHERE id = ?").run(id);
  }

  private nextRowSort(table: "scorecard_metrics" | "scorecard_bonuses", scorecardId: number): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM ${table} WHERE scorecard_id = ?`)
      .get(scorecardId) as { n: number };
    return row.n;
  }
}

// ---- raw row types & mappers ----

interface TaskRow {
  id: number;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  effort: string | null;
  due: string | null;
  suggested_due: string | null;
  suggested_due_reason: string | null;
  source: string;
  external_id: string | null;
  lane: number | null;
  created_at: string;
  updated_at: string;
}
function mapTask(r: TaskRow): Task {
  return { ...r, type: r.type as TaskType, priority: r.priority as Priority, status: r.status as TaskStatus, effort: r.effort as Effort | null };
}

interface StageRow {
  id: number;
  task_id: number;
  name: string;
  kind: string;
  seq: number;
  status: string;
  effort: string | null;
  delegatable_to: string;
}
function mapStage(r: StageRow): Stage {
  return {
    id: r.id,
    task_id: r.task_id,
    name: r.name,
    kind: r.kind as StageKind,
    seq: r.seq,
    status: r.status as StageStatus,
    effort: r.effort as Effort | null,
    delegatable_to: safeJsonArray(r.delegatable_to) as ExecutorKind[],
  };
}

interface ExecutorRow {
  id: number;
  name: string;
  kind: string;
  capacity: number;
  handles: string;
  active: number;
}
function mapExecutor(r: ExecutorRow): Executor {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as ExecutorKind,
    capacity: r.capacity,
    handles: safeJsonArray(r.handles) as StageKind[],
    active: r.active === 1,
  };
}

interface DailyPlanRow {
  id: number;
  plan_date: string;
  generated_at: string;
  trigger: string;
  narrative: string;
  model: string | null;
  is_current: number;
}
function mapPlan(r: DailyPlanRow): DailyPlan {
  return { ...r, trigger: r.trigger as PlanTrigger, is_current: r.is_current === 1 };
}

interface PlanItemRow {
  id: number;
  plan_id: number;
  task_id: number;
  stage_id: number;
  lane: number;
  order_in_lane: number;
  executor_id: number | null;
  is_delegation_candidate: number;
  scheduled_state: string;
  rationale: string;
}
function mapPlanItem(r: PlanItemRow): PlanItem {
  return {
    ...r,
    is_delegation_candidate: r.is_delegation_candidate === 1,
    scheduled_state: r.scheduled_state as ScheduledState,
  };
}

function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

interface GoalRow {
  id: number;
  title: string;
  notes: string;
  status: string;
  sort: number;
  created_at: string;
  updated_at: string;
}
function mapGoal(r: GoalRow): Goal {
  return { ...r, status: r.status as GoalStatus };
}

interface ScorecardRow {
  id: number;
  title: string;
  week_of: string | null;
  bonus_reward: string;
  is_current: number;
  created_at: string;
  updated_at: string;
}
function mapScorecard(r: ScorecardRow): Scorecard {
  return { ...r, is_current: r.is_current === 1 };
}

interface BonusRow {
  id: number;
  scorecard_id: number;
  task: string;
  reward: string;
  done: number;
  sort: number;
}
function mapBonus(r: BonusRow): ScorecardBonus {
  return { ...r, done: r.done === 1 };
}

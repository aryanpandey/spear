# Per-stage due dates (+ lanes fill width) — design

**Date:** 2026-06-19
**Version target:** v0.1.33

## Problem

A `due` date lives only on the **task**, so every stage of a multi-stage task
(Planning → Implementation → Testing → Stage Testing) shares one date. The user
wants each stage to carry its own date — both from "replan dates" and when edited.

Separately: when there are **more than 6 lanes**, the Today lane view should fill
the full screen width instead of horizontally scrolling fixed-width lanes.

## Decisions (confirmed)

1. **Task-level date = the final (latest) stage's date, auto-synced.** Board/Week keep
   working at task granularity using this derived value. When a task has no stage dues,
   its own `due` (manual/CLI) stands.
2. **Editing on a Today card edits that stage's date** (each card is one stage). The
   task date re-derives.
3. **Week places each stage on its own day** (buckets stages, not tasks).

## Data model

- New column `stages.due TEXT` (migration in `db/index.ts` + add to `db/schema.ts`).
- `Stage` gains `due: string | null`; `addStage` defaults null; `updateStage` writes it;
  `mapStage`/`StageRow` carry it.

## Task due derivation

- `syncTaskDueFromStages(store, taskId)`: if any stage has a `due`, set `task.due` to the
  **max** stage due; if none do, leave `task.due` untouched (preserves a manual deadline).
  Called after any stage-due change and after the redate pass.

## Manual editing

- `setStageDue(store, stageId, dueInput)`: parse (reuse `parseDueInput`), `updateStage({due})`,
  then `syncTaskDueFromStages`. Returns the stage.
- Route `POST /api/stages/:id/due` `{due}` → `setStageDue`, broadcast refresh (no re-plan).
- Web `setStageDue(stageId, due)`.
- Today `DueEditor` calls `setStageDue(item.stage.id, …)` (incl. the suggested-due chip).
- `setTaskDue` (service) is unchanged and still backs `spear due` + `POST /api/tasks/:id/due`
  (sets the task's own `due` column directly — the fallback deadline).

## Redate → per-stage

`redateCurrentPlan`:
- Gather all open **stages** from the plan items (each plan item is a (task, stage)).
- Order globally: `PRIORITY_RANK[task.priority]`, then task id, then stage `seq`. This keeps
  each task's stages contiguous and in sequence (so they stay non-decreasing) while higher-
  priority tasks' stages come first.
- `capacity = effectiveCapacity(cfg.dailyTaskCapacity, cfg.maxLanes)`; each stage consumes
  `effortSlots(stage.effort)` (large = 2).
- One LLM call `replanDatesGlobal(today, stages, capacity, …)` → `{stage_id, date}` per stage.
  Prompt: stages of one task run in sequence (a later seq is never earlier); ~N steps/day total
  (large ≈ 2); higher-priority first; non-decreasing down the list; start today.
- Apply with a global non-decreasing clamp; deterministic `deterministicDates` (keyed by
  stage id) fills gaps / fallback. Write each `stage.due`; then `syncTaskDueFromStages` per task.
- `ReplanDatesSchema` field becomes `stage_id` (was `task_id`).

## DTO

- `BoardStageDto` (+ web `BoardStage`) gains `due: string | null` (maps `stage.due`).
- `todayDto` item: `due = stage.due`, `dueBand = dueBand(stage.due)` (was task.due). `suggestedDue`
  stays task-level.

## Week (per-stage)

- `Calendar.tsx` flattens `data.tasks` into **stage units** `{ id: stage.id, taskId, title,
  stageName, due: stage.due, status: stage.status, priority: task.priority, kind }` (one per
  stage). `buildWeek` is generic (`T extends WeekTask {id,due,status,priority}`) — units fit.
- `CalChip` shows `#task · StageName`, drags via the **stage** id → `setStageDue(stageId, day)`
  (drop on Unscheduled clears it). Rename still edits the task title; click opens the task.
- `week.ts` is unchanged (generic); done stages show on their day, undated open stages are
  unscheduled, open stages due before the week are overdue.

## Lanes fill width (>6 lanes)

- `Today.tsx`: `<div className={`lanes${data.lanes.length > 6 ? " fill" : ""}`}>`.
- CSS: `.lanes.fill { overflow-x: visible; }` and `.lanes.fill .lane { min-width: 0; max-width: none; }`
  so lanes share the viewport width and shrink to fit instead of scrolling.

## Files touched

- `src/db/schema.ts`, `src/db/index.ts` — `stages.due` column + migration.
- `src/db/store.ts` — `Stage.due` plumbing (addStage/updateStage/mapStage/StageRow).
- `src/types.ts` — `Stage.due`.
- `src/service.ts` — `syncTaskDueFromStages`, `setStageDue`.
- `src/llm/replanDates.ts` + `src/llm/schemas.ts` — date stages (`stage_id`).
- `src/server/redatePass.ts` — gather/order/clamp stages; sync task due.
- `src/server/app.ts` — `POST /api/stages/:id/due`.
- `src/server/dto.ts` — board stage `due`; today item `due`/`dueBand` from stage.
- `src/web/api.ts` — `setStageDue`; `BoardStage.due`.
- `src/web/components/Today.tsx` — DueEditor → stage due; lanes fill class.
- `src/web/components/Calendar.tsx` — per-stage week chips.
- `src/web/styles.css` — `.lanes.fill` rules.
- Tests: `redatePass.test.ts`, `replanDates.test.ts`, `service.test.ts`, `dto.test.ts`,
  `store.test.ts`, `week.test.ts` updated/added.

## Out of scope

- Per-stage on the **Board** rows (Board stays task-summary; the data is available if wanted later).
- Changing the suggested-due pass (stays task-level).
- The "tasks/day" capacity label now governs stage-slots/day; the wording stays "tasks/day".

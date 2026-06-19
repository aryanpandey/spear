# Global, capacity-based date replanning — design

**Date:** 2026-06-19
**Version target:** v0.1.31

## Problem

The "⟳ replan dates" feature (v0.1.24/v0.1.28) re-decides every open task's `due`
**per lane** — one LLM call per lane, each told the operator does "~2 tasks per lane
per day". This bakes capacity into the lane structure: it is not configurable, and a
lane reordering changes which tasks get early dates in ways the user can't reason about.

The user wants:
1. A **configurable daily task capacity** (how many tasks they finish in a day), default
   = the number of lanes.
2. Dating that is **global**, not lane-specific, so any lane reordering is absorbed.

## Decisions (confirmed)

- **Dating method:** a single **global LLM call** that respects the configured capacity
  (not a pure deterministic formula). Keeps the LLM's effort/real-world nuance.
- **Configuring N:** a **header control** ("tasks/day") next to the lanes selector;
  default `auto` = the current lane count. Persisted to config; changing it re-dates.
- **Effort weighting:** a **large** task consumes **2** capacity slots; small / medium /
  unknown consume **1**. (So it is "about N tasks/day", weighted by size.)

## Capacity model

- New config field `dailyTaskCapacity: number`, default `0`.
  - `0` means **auto** → use `maxLanes` (the current lane count).
  - A positive integer overrides.
- Effective capacity at redate time: `cfg.dailyTaskCapacity > 0 ? cfg.dailyTaskCapacity : cfg.maxLanes`.
- `effortSlots(effort)`: `large → 2`, everything else (`small`, `medium`, `null`) → `1`.
  Kept separate from the existing `EFFORT_WEIGHT` (rough hours for critical-path math).

## Global dating

`redateCurrentPlan` (in `src/server/redatePass.ts`):

1. Collect **all open (non-`done`) tasks** referenced by the current plan, deduped by
   `task_id`.
2. Order them **globally** by `PRIORITY_RANK` (critical → low), tiebroken by the task's
   current plan position (lane, then `order_in_lane`) for stability. Lane number is **not**
   passed to the LLM — lane reordering only affects the stable tiebreak, never the model's
   capacity reasoning.
3. **One** LLM call `replanDatesGlobal(today, tasks, capacity, opts, run)` over that ordered
   list. System prompt tells the model: it finishes about **N tasks per day in total**; a
   *large* task counts as ~2 (up to a full day); tasks are highest-priority first, so give
   higher-priority tasks sooner-or-equal dates; keep dates **non-decreasing** down the list;
   start from today; dates are `YYYY-MM-DD`, today-or-later.
4. Apply returned dates with a global **non-decreasing clamp**. For any task the model
   omitted or returned an invalid/earlier date for, fall back to the deterministic schedule
   for that task.

**Deterministic fallback** (pure, in `src/util/capacity.ts`): `deterministicDates(tasks, capacity, today)`
walks the ordered tasks accumulating `effortSlots`, and dates each task `today + floor(usedSlotsBefore / capacity)`
days (so the first `capacity` slots land today, the next `capacity` tomorrow, …). Used both
when the whole LLM call throws and to fill per-task gaps. This replaces today's weak
"everything gets the same date" fallback.

## API + config

- `GET /api/config` also returns `dailyTaskCapacity`.
- New `POST /api/config/capacity` `{ capacity: number }`: validate integer `0..20`
  (`0` = auto), set `cfg.dailyTaskCapacity`, `saveConfig`, then `replanner.requestRedate()`.
- `POST /api/config/lanes` is unchanged; when capacity is `auto`, a lane change already flows
  the new count into the effective capacity (and it re-plans + re-dates).

## UI

- **Header control** in `App.tsx`: a "tasks/day" `<select>` next to "lanes". Options:
  `auto` (value `0`, label `auto (N)` where N = current lanes) plus `1…20`. State
  `capacity`, seeded from `fetchConfig()`. On change → `setCapacity(n)` → `POST /api/config/capacity`.
- **Progress bar:** the redate is now a single LLM call, so there are no honest sub-steps.
  The `redate` SSE collapses to `start` / `end`; the Today bar becomes an **indeterminate
  "⟳ re-dating…" bar** instead of a fake `done/total` percentage. `App.tsx` `redate` state
  becomes a boolean-ish `{ active: true }` (or `null`); `Today.tsx` renders the indeterminate
  bar when active and updates the button tooltip to "re-decide every task's completion date
  globally by your tasks/day capacity".

## Files touched

- `src/config/index.ts` — `dailyTaskCapacity` field + default.
- `src/util/capacity.ts` — **new**: `effortSlots`, `deterministicDates` (pure, tested).
- `src/util/capacity.test.ts` — **new** unit tests.
- `src/llm/replanDates.ts` — replace per-lane `replanDatesForLane` with global `replanDatesGlobal` (new prompt).
- `src/server/redatePass.ts` — global ordering, single call, clamp, deterministic fallback.
- `src/server/redatePass.test.ts` — **new/updated**: global non-decreasing + fallback with a fake runner.
- `src/server/replan.ts` — `redate()` emits `start`/`end` only (no per-lane progress).
- `src/server/app.ts` — `GET /api/config` adds capacity; new `POST /api/config/capacity`.
- `src/web/api.ts` — `fetchConfig` returns capacity; new `setCapacity`.
- `src/web/App.tsx` — tasks/day header control; redate state → indeterminate.
- `src/web/components/Today.tsx` — indeterminate re-dating bar; tooltip wording.

## Out of scope

- Changing lane assignment or the planner. This feature only re-decides `due` dates.
- Per-task manual capacity overrides. One global N.

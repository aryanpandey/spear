# spear: "Replan dates" — re-decide completion dates on the current lanes

**Date:** 2026-06-17
**Target version:** v0.1.24 (tagged dmg release + repo push)
**Status:** Approved design → ready for implementation plan

## Summary

A **Replan dates** button (Today flow header) re-decides the completion (`due`) date of every open
task in the current plan **without changing lane order**, via per-lane LLM calls that assume the
operator clears **~2 tasks per lane per day**. Within-lane dates are clamped non-decreasing. The same
re-dating runs **automatically after a lane-count change** (which redistributes tasks across lanes).
A **determinate, percentage progress bar** (one step per lane) shows while it runs.

## Why per-lane calls

Lanes are independent for dating (the 2/lane/day rule is per-lane; lanes run in parallel from today).
Dating each lane in its own LLM call (a) is correct/cleaner and (b) yields genuine progress: progress =
lanes done / total lanes. Lanes are processed **sequentially** so the bar fills lane-by-lane.

## A. Per-lane dating call (`src/llm/replanDates.ts`)

`replanDatesForLane(today, lane, opts, run?)`:
- `lane`: `{ lane: number; tasks: { task_id, title, type, priority, effort }[] }` — tasks in order.
- Prompt rules: the operator finishes **~2 tasks per lane per day** (a `large` task may take a full day
  on its own); keep dates **non-decreasing** down the lane; all dates `YYYY-MM-DD`, today or later.
  Returns `{ dates: [{ task_id, date }] }`.
- `opts`: `{ model: cfg.models.dates, effort: cfg.effort.dates }`.
- Returns the validated `{ taskId, date }[]` for that lane (drops dates that don't parse).

`src/llm/schemas.ts`: `ReplanDatesSchema = { dates: [{ task_id, date }] }`.

## B. Orchestration (`src/server/redatePass.ts`)

`redateCurrentPlan(store, cfg, onProgress?, run?) → Promise<number>`:
1. `plan = store.getCurrentPlan()`; if none → return 0.
2. `items = store.getPlanItems(plan.id)` (ordered by lane, order_in_lane). Group into lanes; per lane,
   build the **task order** = first occurrence of each task id, **skipping `done` tasks**; enrich each
   with `{title, type, priority, effort}` from the store.
3. `total = lanes.length`. Call `onProgress?.(0, total)` so the UI learns the real total immediately.
   Then for each lane **in sequence** (index `i`):
   - `dates = await replanDatesForLane(today, lane, {model, effort}, run)`.
   - Build a `taskId → date` map. Then walk the lane's tasks **in order**, assigning each a date:
     candidate = mapped date if valid else the previous assigned date (or `today`); then **clamp** to
     `>= previous assigned date` (the non-decreasing guarantee).
   - `store.updateTask(taskId, { due })` for each — **no re-plan**.
   - `onProgress?.(i + 1, total)`.
4. Return the number of tasks dated.

Clamp + fallback guarantee every dated task gets a valid, non-decreasing `due`, even if the LLM omits
or mis-orders one.

## C. Triggers + progress events (`src/server/replan.ts`)

The `Replanner` owns the SSE phases (so the bar shows). New SSE event type **`redate`**:
`{ type: "redate", phase: "start"|"progress"|"end", done, total }`.

- `requestRedate()` → `void this.redate()`:
  - broadcast `{type:"redate", phase:"start", done:0, total:0}` (UI shows the bar immediately),
  - `await redateCurrentPlan(store, cfg, (done, total) => broadcast {type:"redate", phase:"progress", done, total})`,
  - broadcast `{type:"redate", phase:"end"}` (+ a `{type:"update", source:"refresh"}` so the board reloads).
  - errors are caught + logged (best-effort), and still emit `end`.
- `requestReplanThenRedate()` → run the normal plan (existing `run`/broadcasts), then on success
  `await this.redate()`. Used by the lane-count route.

## D. Routes (`src/server/app.ts`)

- **`POST /api/plan/replan-dates`** → `replanner.requestRedate()`; return `{ ok: true }`.
- Change **`POST /api/config/lanes`**: replace `replanner.requestReplan("manual")` with
  `replanner.requestReplanThenRedate()` (re-plan the new lane count, then re-date).

## E. Web (`src/web/api.ts`, `App.tsx`, `Today.tsx`)

- `replanDates()` in `api.ts` (POST `/api/plan/replan-dates`).
- `App.tsx`: handle `redate` SSE events → `redate` state `{ done, total } | null` (`start`/`progress`
  set it, `end` clears it + `load()`); pass `redate` to `<Today>`.
- `Today.tsx` header (`.narrative .head`): a **⟳ replan dates** button (calls `replanDates()`, disabled
  while `redate` is active) and, when `redate` is non-null, a **determinate progress bar**:
  - a filled green bar with width `done/total*100%` (0% at start while `total===0`),
  - a label `re-dating lanes… {done}/{total} ({pct}%)`.

## F. Config

Add `models.dates` (default `claude-opus-4-8`) and `effort.dates` (default `medium`) to `SpearConfig` /
`DEFAULT_CONFIG` (both `models` and `effort` already deep-merge, so old configs pick up the defaults).

## G. Testing

- `src/llm/replanDates.test.ts` — `replanDatesForLane` returns validated dates with a fake runner; drops
  unparseable dates.
- `src/server/redatePass.test.ts` — with an in-memory store + a saved plan + a fake runner that returns
  **out-of-order** dates, assert the written `due`s are **non-decreasing within each lane**, done tasks
  are skipped, and `onProgress` reports `(0,total)` then `(1,total)…(total,total)`.

## Cross-cutting

- Writing `due` via `store.updateTask` never re-plans, so lane order is preserved (the core promise).
- **Overwrites** any existing/manual due dates on tasks in the lanes (intended).
- Triggers: the button + a lane-count change only — **not** task adds.
- Latency: sequential per-lane LLM calls (~8-12s each); a 6-lane board ≈ ~1 min, with the bar filling
  lane-by-lane. A lane-count change runs the re-plan first, then the re-date.
- No new runtime dependencies.
- **Docs:** add a `## [0.1.24]` `CHANGELOG.md` entry. **Release** v0.1.24 + local refresh.

## Rejected alternatives

- **One LLM call for all lanes** — simpler, but gives no real progress; per-lane calls enable the
  percentage bar and match lane independence.
- **Parallel per-lane calls** — faster, but the bar would jump rather than fill smoothly; sequential
  gives clean percentage-wise updates (the explicit ask).
- **Indeterminate sweep (reuse the green replan bar)** — rejected; the user asked for percentage updates.
- **Deterministic-only dating (today + floor(order/2))** — the 2/day rule could be pure math, but the
  user wants LLM calls (effort-aware nuance); the clamp is the only deterministic safeguard.

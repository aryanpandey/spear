# Progress metrics tab — design

**Date:** 2026-06-20
**Version target:** v0.1.35

## Goal

A new **metrics** tab that tracks, for **today** and the **active week** (Mon→Sun):
how many tasks were **completed**, how many were **added**, plus a **burndown chart**
with two lines — open tasks **remaining** and **cumulative completed** — across the week.

## Decisions (confirmed)

- Burndown = two lines: open remaining (descends) + cumulative completed within the week (ascends).
- "Active week" = the running Mon→Sun calendar week (matches the Week tab).
- Counts are whole **tasks** (not stages).

## Data model

Tasks have `created_at`/`updated_at` but no completion time, so add one:

- `tasks.completed_at TEXT` (schema + idempotent migration). Migration backfills existing done
  tasks: `UPDATE tasks SET completed_at = updated_at WHERE status='done' AND completed_at IS NULL`.
- `Task` + `TaskRow` gain `completed_at: string | null` (mapTask already spreads the row).
- `store.updateTask` maintains it on status transitions: entering `done` (from non-done) sets
  `completed_at = nowIso()`; leaving `done` clears it; otherwise it is preserved. Add the column
  to the UPDATE statement.

## Metrics computation (pure, tested)

`src/util/metrics.ts` — no DB, takes records + `now`:

```ts
interface MetricsTaskRecord { created_at: string; completed_at: string | null }
interface DayPoint { date: string; weekday: string; remaining: number; completed: number; isToday: boolean; isFuture: boolean }
interface MetricsView {
  today: { date: string; added: number; completed: number };
  week:  { weekStart: string; weekEnd: string; added: number; completed: number };
  totalOpen: number;
  burndown: DayPoint[]; // Mon..Sun (7 entries)
}
function buildMetrics(tasks: MetricsTaskRecord[], now: Date): MetricsView
```

Dates compare as local `YYYY-MM-DD` (via `todayLocal(new Date(iso))`):
- **added today / week** = `createdDate` is today / within [weekStart, weekEnd].
- **completed today / week** = `completed_at` set and `completedDate` is today / within the week.
- **totalOpen** = tasks with `completed_at == null` (current open count).
- **burndown[D]**:
  - `remaining` = tasks with `createdDate <= D` AND (`completed_at == null` OR `completedDate > D`)
    — open at end of day D (includes backlog created before the week).
  - `completed` = tasks with `completedDate` in `[weekStart, D]` — cumulative completed this week.
  - Future days (`D > today`) are flagged `isFuture`; the chart stops its lines at today.

Caveat (documented in UI): deleted tasks leave no history, so a task added-and-deleted within the
week isn't counted. Acceptable.

## Server

- `store.listAllTasks(): Task[]` — `SELECT * FROM tasks` (incl. done), mapped.
- `src/server/metricsDto.ts` `metricsDto(store, now = new Date()): MetricsView` — maps tasks to
  records and calls `buildMetrics`.
- Route `GET /api/metrics` → `metricsDto(store)`.

## Web

- `api.ts`: `MetricsData` (mirrors `MetricsView`) + `fetchMetrics()`.
- `App.tsx`: add `"metrics"` to the `Tab` union + the header tabs array; `metrics` state loaded in
  `load()` alongside board/today (so SSE keeps it live); render `<Metrics data={metrics} />`.
- `src/web/components/Metrics.tsx`:
  - Two stat blocks — **Today** and **This Week** — each showing **Completed** and **Added**
    (the week block also shows current **open** total).
  - **Burndown**: a hand-drawn inline SVG (no chart lib, matching the app's style) with two
    polylines — remaining (accent) and completed (a dim/second color) — plotted across the
    non-future weekdays, with a y-axis max label, per-day dots, weekday x-labels, and a legend.
- `styles.css`: `.metrics`, stat cards, `.burndown` SVG styling (theme-var colors).

## Files touched

- `src/db/schema.ts`, `src/db/index.ts` — `completed_at` column + migration/backfill.
- `src/db/store.ts` — `Task`/`TaskRow.completed_at`, `updateTask` transition logic, `listAllTasks`.
- `src/types.ts` — `Task.completed_at`.
- `src/util/metrics.ts` (+ `metrics.test.ts`) — pure metrics builder.
- `src/server/metricsDto.ts` — dto.
- `src/server/app.ts` — `GET /api/metrics`.
- `src/web/api.ts` — `MetricsData` + `fetchMetrics`.
- `src/web/App.tsx` — metrics tab + state + load.
- `src/web/components/Metrics.tsx` — the tab UI + chart.
- `src/web/styles.css` — metrics styles.

## Out of scope

- Per-stage/step metrics (counts are whole tasks).
- Historical persistence/snapshots (burndown is reconstructed from created/completed timestamps).
- Configurable date ranges beyond today + the running week.

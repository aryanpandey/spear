# Seamless Day — design

Make daily execution in spear seamless by removing capture friction and plan churn, and by making
the day time-aware. Three coupled improvements, each shippable on its own.

## Goals (from brainstorming)
1. **No plan reshuffling.** Adding a task mid-day must not rearrange the rest of the day. Lanes and
   their numbers stay stable until the next morning plan (or an explicit reset).
2. **Zero-decision capture.** `spear add "..."` assigns a sensible priority and the right lane
   automatically — no flags required.
3. **Time-aware.** Overdue / due-today work floats up; the plan shows what realistically fits the
   time left today.

Non-goal: a single "focus/now" view (explicitly deprioritised by the user).

## 1. Sticky lanes (stability + light re-balance)

Lane **membership becomes persistent** instead of being recomputed on every replan.

- Schema: `tasks.lane INTEGER` (nullable) + a `meta(key,value)` table holding `lane_epoch` (the date
  membership was last fully computed).
- The planner gains a `mode`:
  - **`full`** — morning job and `spear plan --reset`: cluster all open tasks → assign lanes
    `0..k-1` → persist `tasks.lane` + set `lane_epoch = today` (today's behaviour).
  - **`incremental`** — every ad-hoc add / completion: **keep every existing task's lane**. Only a
    task with `lane = null` (new) is placed — into the existing lane it shares the most title tokens
    with; if it matches none, the smallest lane. All other tasks' lanes are untouched.
  - Promotion rule: an `incremental` replan runs as `full` when `lane_epoch != today` (first plan of
    the day, e.g. the Mac was asleep at the morning hour).
- Within-lane order, `scheduled_state`, and the narrative still recompute every replan (cheap,
  deterministic) — only **membership** is sticky.
- **Light re-balance** (only on `incremental`, only when a lane is overloaded): a lane is overloaded
  when its open-task count exceeds `ceil(open / laneCount) + 1`. Fix locally:
  - if `laneCount < maxLanes`: split the least-related subset of the overloaded lane into a new lane;
  - else: move that lane's single lowest-priority / latest-phase task to the most-related lighter lane.
  Unrelated lanes are never touched.
- The LLM planner runs only on `full` (it does the semantic grouping). `incremental` is deterministic
  and instant. Lane numbers are displayed 1..N by position (already implemented).

## 2. Auto-priority on capture (hybrid)

`spear add "..."` with **no `--priority`** infers one; explicit `--priority` always wins.

- **Instant heuristic** (`src/planner/priority.ts`, pure + tested): score from
  - urgency keywords in the title — `prod|down|broken|outage|urgent|asap|p0|blocker|security|hotfix`
    → critical/high; `fix|bug|investigate|regression` → bump one level;
  - due-date proximity (overdue/today → high+, this week → slight bump);
  - blocks-others (the task is in another task's `blocked-by`, or is itself a declared blocker) → bump.
  Default `medium`. Returns `{ priority, reason }`.
- **LLM refine (when keyed):** the existing breakdown call already runs at capture — extend its schema
  with a `priority` field, and use it when the user gave no explicit priority. No extra latency / extra
  call. Offline → heuristic; keyed → LLM judgment. This *is* the hybrid.
- `add` prints the inferred priority + a one-line reason so it's transparent.

## 3. Time-awareness (due band + time-fit)

- **Due band** (a priority *floor*, never lowers): overdue → at least `critical`, due-today → at least
  `high`. Banded tasks float to the top of their lane with a ⌛/⏰ marker; otherwise within-lane order
  stays design → implementation → testing, then priority.
- **Time-fit:**
  - Effort → minutes: `small 30 / medium 120 / large 240` (config `effortMinutes`).
  - "Time left today" = config `workdayEnd` (default `18:00`) − now; override with `spear today --hours N`
    and a dashboard control.
  - Compute a running estimate over the **self** executor's items (the human bottleneck). Items beyond
    the budget stay in their lane but sit **below a visual cut line**, de-emphasised and marked
    "spills to tomorrow" — not removed (keeps the plan stable). Delegated/background items don't consume
    the human budget.

## Modules & footprint

- New: `src/planner/priority.ts` (heuristic), `src/planner/lanes.ts` (incremental assign + rebalance,
  extends `grouping.ts`), `meta` table + `tasks.lane` + Store methods, `effortMinutes`/`workdayEnd` config.
- Touch: `deterministicPlan` (mode + sticky membership + due band + time budget), `buildAndSavePlan`
  (mode), `Replanner`/`triggerReplan` (incremental), `plan` command (`--reset`), `today` (`--hours`),
  `llm/breakdown` (+priority), `llm/planner` (full-mode only), DTOs + `render.ts` + web `Today` (due
  badges, time-budget readout, cut line).
- Persistence: a plan still saves to `daily_plans`/`plan_items`; lane membership additionally persists
  on `tasks.lane` so it survives replans.

## Build order (phased, each shippable + tested)
1. **Auto-priority** — `priority.ts`, wire into `add`/`service`, `+priority` in breakdown schema. Tests.
2. **Sticky lanes** — schema + `meta`, `lanes.ts`, `deterministicPlan` mode, `--reset`, epoch promotion,
   rebalance. Tests for "insert leaves others unchanged" + rebalance-is-local.
3. **Time-awareness** — due band (floor + float), effort→minutes, time budget + cut line, `--hours`,
   web/render badges. Tests for band ordering + cut line.

## Testing
Unit: priority heuristic (keywords/due/blocks); incremental insert leaves other lanes byte-identical;
overload → local rebalance only; epoch-stale promotes to full; due-band floor + float; time-fit cut line.
Integration: add mid-day → existing lane membership unchanged; `--reset` re-clusters; `today --hours 2`
moves the cut line.

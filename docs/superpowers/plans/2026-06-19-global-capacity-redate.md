# Global, capacity-based date replanning — implementation plan

> **For agentic workers:** implement task-by-task; steps use `- [ ]` checkboxes.

**Goal:** Re-date all open tasks with a single global LLM call that respects a configurable
"tasks/day" capacity (default = lane count), effort-weighted, robust to lane reordering.

**Architecture:** Add a `dailyTaskCapacity` config field; a pure `capacity` util (slots +
deterministic schedule); a global LLM dating function; rework `redateCurrentPlan` to order all
open tasks by priority and call it once with a non-decreasing clamp + deterministic fallback;
expose a `tasks/day` header control; collapse the redate progress to an indeterminate bar.

**Tech Stack:** Node/TS (ESM), Fastify, React/Vite, vitest, Claude CLI (`claudeStructured`).

---

### Task 1: capacity util (pure, tested)

**Files:**
- Create: `src/util/capacity.ts`
- Test: `src/util/capacity.test.ts`

- [ ] Write `effortSlots(effort: Effort | null): number` — `large → 2`, else `1`.
- [ ] Write `effectiveCapacity(dailyTaskCapacity: number, maxLanes: number): number` —
  `dailyTaskCapacity > 0 ? dailyTaskCapacity : maxLanes`, min 1.
- [ ] Write `deterministicDates(tasks: {task_id, effort}[], capacity, today): Map<number,string>`:
  walk in order, `dayIndex = floor(usedSlotsBefore / capacity)`, date = `addDaysLocal(today, dayIndex)`,
  then `usedSlotsBefore += effortSlots(effort)`. Uses `addDaysLocal`/`todayLocal` from `util/time.ts`.
- [ ] Tests: cap 2 with 4 small tasks → days [0,0,1,1]; a `large` first (2 slots) fills a day alone;
  capacity 0 coerces to maxLanes via `effectiveCapacity`.
- [ ] Run `npm test -- capacity` → PASS. Commit.

### Task 2: config field

**Files:** Modify `src/config/index.ts`

- [ ] Add `dailyTaskCapacity: number` to `SpearConfig` (doc: "0 = auto = maxLanes").
- [ ] Add `dailyTaskCapacity: 0` to `DEFAULT_CONFIG`. (mergeConfig already spreads top-level scalars.)
- [ ] Run `npm run build` (tsc) → no errors. Commit.

### Task 3: global LLM dating fn

**Files:** Modify `src/llm/replanDates.ts`

- [ ] Replace `LaneTaskForDating`/`LaneForDating` usage: keep a `TaskForDating { task_id, title, type, priority, effort }`.
- [ ] New `replanDatesGlobal(today, tasks: TaskForDating[], capacity: number, opts, run=claudeJson): Promise<DateAssignment[]>`.
- [ ] New SYSTEM prompt: "assign a completion date to EVERY task across the whole flow… operator finishes
  about N tasks per day in total; a 'large' task counts ~2 (up to a full day); tasks listed highest-priority
  first → higher-priority sooner-or-equal; dates NON-DECREASING down the list; start today; YYYY-MM-DD today-or-later;
  output ONLY {"dates":[{"task_id","date"}]}". Interpolate `capacity` into the prompt.
- [ ] Validate with `ReplanDatesSchema`, filter to known ids + today-or-later (same as before).
- [ ] Remove the old `replanDatesForLane` export (only caller is redatePass, rewritten in Task 4).
- [ ] `npm run build` → no errors (redatePass will temporarily break; fix in Task 4 before building).

### Task 4: global redate pass + fallback

**Files:** Modify `src/server/redatePass.ts`; Test `src/server/redatePass.test.ts`

- [ ] Rewrite `redateCurrentPlan(store, cfg, onProgress?, run=claudeJson)`:
  - Gather open tasks (dedup by task_id, skip `done`), capturing each task's plan position (lane, order_in_lane).
  - Order globally by `PRIORITY_RANK[priority]`, tiebreak `(lane, order_in_lane)`.
  - `capacity = effectiveCapacity(cfg.dailyTaskCapacity, cfg.maxLanes)`.
  - `onProgress?.(0, 1)`.
  - Try `assignments = await replanDatesGlobal(today, tasks, capacity, {model: cfg.models.dates, effort: cfg.effort.dates}, run)`;
    on throw → `assignments = []`.
  - `fallback = deterministicDates(tasks, capacity, today)`.
  - Walk tasks in order with a `prev` non-decreasing clamp: pick `byId.get(id)` if valid & ≥ prev & ≥ today,
    else `fallback.get(id)`, clamp ≥ prev; `store.updateTask(id, {due})`; advance `prev`.
  - `onProgress?.(1, 1)`; return count.
- [ ] Test (fake runner): 3 tasks, runner returns out-of-order/earlier dates → result is non-decreasing and today-or-later.
- [ ] Test: runner throws → deterministic fallback still dates all tasks by capacity.
- [ ] `npm test -- redatePass` → PASS. `npm run build` → no errors. Commit.

### Task 5: redate SSE start/end only

**Files:** Modify `src/server/replan.ts`

- [ ] In `redate()`, broadcast `{type:"redate", phase:"start"}` then run `redateCurrentPlan` (drop the
  per-progress broadcast or keep onProgress as a no-op), then `{type:"redate", phase:"end"}`. (done/total no longer meaningful.)
- [ ] `npm run build` → no errors. Commit.

### Task 6: config route + GET

**Files:** Modify `src/server/app.ts`

- [ ] `GET /api/config` → `{ maxLanes, theme, dailyTaskCapacity: cfg.dailyTaskCapacity }`.
- [ ] New `POST /api/config/capacity` `{capacity}`: `n=Number(...)`; reject if `!Number.isInteger(n) || n<0 || n>20`
  → 400 "capacity must be an integer 0–20 (0 = auto)"; else `cfg.dailyTaskCapacity=n; saveConfig(cfg); replanner.requestRedate(); return {dailyTaskCapacity:n}`.
- [ ] `npm run build` → no errors. Commit.

### Task 7: web api client

**Files:** Modify `src/web/api.ts`

- [ ] `fetchConfig` return type → `{ maxLanes: number; theme: string; dailyTaskCapacity: number }`.
- [ ] New `setCapacity(capacity: number): Promise<{dailyTaskCapacity:number}>` → `POST /api/config/capacity`.
- [ ] Update the `replanDates` doc comment to "global, capacity-based".

### Task 8: header control + indeterminate bar

**Files:** Modify `src/web/App.tsx`, `src/web/components/Today.tsx`

- [ ] App: add `capacity` state (default 0), seed from `fetchConfig`. Add `changeCapacity(n)` (optimistic + `setCapacity`).
- [ ] App: add a "tasks/day" `<label className="lanes-ctl">` `<select>` after the lanes control: option `0` label `auto (${lanes})`, then `1..20`.
- [ ] App: change `redate` state to `boolean` (active). SSE: `phase==="end"` → `setRedate(false)`, else `setRedate(true)` + `load()`.
- [ ] App: pass `redate={redate}` (boolean) to `Today`.
- [ ] Today: `redate?: boolean`. Replace the `done/total` progress block with an indeterminate bar (`<div className="redate-progress redate-indeterminate">…⟳ re-dating…</div>`) shown when `redate`.
- [ ] Today: button `disabled={!!redate}`; tooltip → "Re-decide every task's completion date globally by your tasks/day capacity".
- [ ] Add a `.redate-indeterminate` animation rule in the stylesheet (an animated sweep fill is fine here — it's a working indicator, not a progress %).
- [ ] `npm run build` (vite) → no errors.

### Task 9: ship v0.1.31

- [ ] Bump `package.json` to `0.1.31`.
- [ ] Update `CHANGELOG.md` + README (replan-dates section) + memory note.
- [ ] `npm test` (full) + `npm run build` → all green.
- [ ] Commit, tag `v0.1.31`, push tag; poll the release workflow; refresh local install (established dmg-swap flow).

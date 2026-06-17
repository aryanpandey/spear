# spear v0.1.24 — "Replan dates" with per-lane percentage progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Replan dates" button (and an auto-trigger on lane-count change) that re-decides every open task's completion date from the current lane order — assuming ~2 tasks/lane/day, clamped non-decreasing — via one LLM call per lane, with a determinate percentage progress bar.

**Architecture:** Per-lane LLM calls (`replanDatesForLane`) drive genuine progress; `redateCurrentPlan` orchestrates them sequentially, clamps within-lane order, writes `due` via `store.updateTask` (no re-plan), and reports progress. The `Replanner` wraps it in new `redate` SSE events; the Today header shows a determinate bar.

**Tech Stack:** Node/TS ESM, better-sqlite3, Fastify, React/Vite, vitest, zod/v4, the Claude CLI.

**Spec:** `docs/superpowers/specs/2026-06-17-replan-dates-design.md`

---

## File Structure

**New files**
- `src/llm/replanDates.ts` (+ test) — `replanDatesForLane` (one lane → dates).
- `src/server/redatePass.ts` (+ test) — `redateCurrentPlan` (orchestrate + clamp + write + progress).

**Modified files**
- `src/llm/schemas.ts` — `ReplanDatesSchema`.
- `src/config/index.ts` — `models.dates`, `effort.dates`.
- `src/server/replan.ts` — `requestRedate`, `requestReplanThenRedate`, `redate` SSE events.
- `src/server/app.ts` — `POST /api/plan/replan-dates`; `config/lanes` uses `requestReplanThenRedate`.
- `src/web/api.ts` — `replanDates()`.
- `src/web/App.tsx` — `redate` state + SSE handling + pass to `<Today>`.
- `src/web/components/Today.tsx` — button + determinate progress bar.
- `src/web/styles.css` — button + progress-bar styles.
- `CHANGELOG.md`, `package.json`.

---

## Task 1: Config — dates model + effort

**Files:** Modify `src/config/index.ts`

- [ ] **Step 1: Implement.** In `src/config/index.ts`, change the `models`/`effort` types on `SpearConfig`:

Replace:
```ts
  /** Claude model ids for the LLM calls. */
  models: { breakdown: string; planner: string; duplicate: string };
  /** Effort levels for the LLM calls. */
  effort: {
    breakdown: "low" | "medium" | "high" | "max";
    planner: "low" | "medium" | "high" | "max";
    duplicate: "low" | "medium" | "high" | "max";
  };
```
with:
```ts
  /** Claude model ids for the LLM calls. */
  models: { breakdown: string; planner: string; duplicate: string; dates: string };
  /** Effort levels for the LLM calls. */
  effort: {
    breakdown: "low" | "medium" | "high" | "max";
    planner: "low" | "medium" | "high" | "max";
    duplicate: "low" | "medium" | "high" | "max";
    dates: "low" | "medium" | "high" | "max";
  };
```

In `DEFAULT_CONFIG`, replace:
```ts
  models: { breakdown: "claude-opus-4-8", planner: "claude-opus-4-8", duplicate: "claude-sonnet-4-6" },
  effort: { breakdown: "low", planner: "medium", duplicate: "low" },
```
with:
```ts
  models: { breakdown: "claude-opus-4-8", planner: "claude-opus-4-8", duplicate: "claude-sonnet-4-6", dates: "claude-opus-4-8" },
  effort: { breakdown: "low", planner: "medium", duplicate: "low", dates: "medium" },
```

- [ ] **Step 2: Verify typecheck.** Run: `npm run typecheck` — Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add src/config/index.ts
git commit -m "feat(config): models.dates + effort.dates for replan-dates"
```

---

## Task 2: Per-lane dating call (`replanDatesForLane`)

**Files:** Modify `src/llm/schemas.ts`; Create `src/llm/replanDates.ts`, `src/llm/replanDates.test.ts`

- [ ] **Step 1: Add the schema** — append to `src/llm/schemas.ts`:
```ts
// ---- Replan dates (per lane) ----

export const ReplanDatesSchema = z.object({
  dates: z.array(
    z.object({
      task_id: z.number().int(),
      date: z.string().describe("YYYY-MM-DD, today or later"),
    }),
  ),
});
export type ReplanDatesOutput = z.infer<typeof ReplanDatesSchema>;
```

- [ ] **Step 2: Write the failing test** — create `src/llm/replanDates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { replanDatesForLane, type LaneForDating } from "./replanDates.js";

const opts = { model: "m", effort: "medium" as const };
const lane: LaneForDating = {
  lane: 0,
  tasks: [
    { task_id: 1, title: "a", type: "chore", priority: "high", effort: "small" },
    { task_id: 2, title: "b", type: "feature", priority: "medium", effort: "large" },
  ],
};

describe("replanDatesForLane", () => {
  it("returns validated dates keyed by task id", async () => {
    const run = async () => ({ dates: [{ task_id: 1, date: "2026-06-17" }, { task_id: 2, date: "2026-06-19" }] });
    const out = await replanDatesForLane("2026-06-17", lane, opts, run);
    expect(out).toEqual([{ taskId: 1, date: "2026-06-17" }, { taskId: 2, date: "2026-06-19" }]);
  });

  it("drops unparseable and past dates", async () => {
    const run = async () => ({ dates: [{ task_id: 1, date: "nope" }, { task_id: 2, date: "2026-06-10" }] });
    const out = await replanDatesForLane("2026-06-17", lane, opts, run);
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test, verify it fails** — Run: `npx vitest run src/llm/replanDates.test.ts` — Expected: FAIL (no module).

- [ ] **Step 4: Implement** — create `src/llm/replanDates.ts`:
```ts
import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { ReplanDatesSchema } from "./schemas.js";
import { parseDateLocal } from "../util/time.js";
import type { Effort, Priority, TaskType } from "../types.js";

export interface LaneTaskForDating {
  task_id: number;
  title: string;
  type: TaskType;
  priority: Priority;
  effort: Effort | null;
}
export interface LaneForDating {
  lane: number;
  tasks: LaneTaskForDating[];
}
export interface DateAssignment {
  taskId: number;
  date: string;
}

const SYSTEM = `You assign a completion (due) date to each task in ONE lane of a founder's execution flow.

Rules:
- The operator finishes about 2 tasks per lane per day; a "large" task may take a full day on its own.
- Keep the dates NON-DECREASING down the lane (a task later in the list never finishes before an earlier one).
- Lanes run in parallel, so start this lane from today.
- All dates are YYYY-MM-DD, today or later.

Output ONLY a JSON object: {"dates":[{"task_id":number,"date":"YYYY-MM-DD"}]} — one per task, no prose, no fences.`;

function buildPrompt(today: string, lane: LaneForDating): string {
  return `${SYSTEM}\n\nToday is ${today}.\nLane ${lane.lane} tasks (in order):\n${JSON.stringify(lane.tasks)}`;
}

/**
 * Ask the Claude CLI for completion dates for one lane's tasks (in order). Returns
 * only well-formed dates (parseable, today-or-later) keyed by task id. The caller
 * clamps for non-decreasing order and fills any gaps.
 */
export async function replanDatesForLane(
  today: string,
  lane: LaneForDating,
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<DateAssignment[]> {
  if (lane.tasks.length === 0) return [];
  const ids = new Set(lane.tasks.map((t) => t.task_id));
  const todayDate = parseDateLocal(today);
  const parsed = await claudeStructured(buildPrompt(today, lane), (x) => ReplanDatesSchema.parse(x), opts, run);

  const out: DateAssignment[] = [];
  for (const d of parsed.dates) {
    if (!ids.has(d.task_id)) continue;
    const dt = parseDateLocal(d.date);
    if (!dt || !todayDate) continue;
    if (dt.getTime() < todayDate.getTime()) continue; // no past dates
    out.push({ taskId: d.task_id, date: d.date });
  }
  return out;
}
```

- [ ] **Step 5: Run test, verify it passes** — Run: `npx vitest run src/llm/replanDates.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/llm/replanDates.ts src/llm/replanDates.test.ts src/llm/schemas.ts
git commit -m "feat(llm): replanDatesForLane — per-lane completion dates"
```

---

## Task 3: Orchestration (`redateCurrentPlan`) — clamp + progress

**Files:** Create `src/server/redatePass.ts`, `src/server/redatePass.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/server/redatePass.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { addTask } from "../service.js";
import { redateCurrentPlan } from "./redatePass.js";

function makeStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}
function planItem(task_id: number, stage_id: number, lane: number, order: number) {
  return { task_id, stage_id, lane, order_in_lane: order, executor_id: null, is_delegation_candidate: false, scheduled_state: "start_now" as const, rationale: "" };
}

describe("redateCurrentPlan", () => {
  it("clamps within-lane dates non-decreasing, skips done, reports progress", async () => {
    const store = makeStore();
    const a = addTask(store, { title: "a", stages: [{ name: "s", kind: "generic" }] });
    const b = addTask(store, { title: "b", stages: [{ name: "s", kind: "generic" }] });
    const c = addTask(store, { title: "c", stages: [{ name: "s", kind: "generic" }] });
    const done = addTask(store, { title: "done", stages: [{ name: "s", kind: "generic" }] });
    store.updateTask(done.task.id, { status: "done" });
    store.savePlan(
      { plan_date: "2026-06-17", trigger: "manual", narrative: "", model: "m" },
      [
        planItem(a.task.id, a.stages[0].id, 0, 0),
        planItem(b.task.id, b.stages[0].id, 0, 1),
        planItem(done.task.id, done.stages[0].id, 0, 2),
        planItem(c.task.id, c.stages[0].id, 1, 0),
      ],
    );
    // out-of-order: lane-0 second task (b) earlier than first (a) → must clamp up to a's date
    const planned: Record<number, string> = { [a.task.id]: "2026-06-20", [b.task.id]: "2026-06-18", [c.task.id]: "2026-06-19" };
    const run = async (prompt: string) => ({
      dates: Object.entries(planned)
        .filter(([id]) => prompt.includes(`"task_id":${id}`))
        .map(([id, date]) => ({ task_id: Number(id), date })),
    });
    const progress: Array<[number, number]> = [];
    const n = await redateCurrentPlan(store, DEFAULT_CONFIG, (d, t) => progress.push([d, t]), run);

    expect(store.getTask(a.task.id)!.due).toBe("2026-06-20");
    expect(store.getTask(b.task.id)!.due).toBe("2026-06-20"); // clamped, not 2026-06-18
    expect(store.getTask(c.task.id)!.due).toBe("2026-06-19");
    expect(store.getTask(done.task.id)!.due).toBeNull(); // done task skipped
    expect(n).toBe(3);
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]); // (0,total) then per-lane
  });

  it("returns 0 when there is no current plan", async () => {
    const store = makeStore();
    const run = async () => ({ dates: [] });
    expect(await redateCurrentPlan(store, DEFAULT_CONFIG, undefined, run)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — Run: `npx vitest run src/server/redatePass.test.ts` — Expected: FAIL (no module).

- [ ] **Step 3: Implement** — create `src/server/redatePass.ts`:
```ts
import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { todayLocal, parseDateLocal } from "../util/time.js";
import { replanDatesForLane, type LaneForDating, type LaneTaskForDating } from "../llm/replanDates.js";
import { claudeJson, type ClaudeRunner } from "../llm/cli.js";

export type RedateProgress = (done: number, total: number) => void;

/**
 * Re-decide every open task's completion date from the CURRENT plan's lanes, one
 * LLM call per lane (sequential, for percentage progress). Within each lane the
 * dates are clamped non-decreasing; gaps fall back to the previous date (or today).
 * Writes `due` directly (no re-plan, so lane order is preserved). Returns the count.
 */
export async function redateCurrentPlan(
  store: Store,
  cfg: SpearConfig,
  onProgress?: RedateProgress,
  run: ClaudeRunner = claudeJson,
): Promise<number> {
  const plan = store.getCurrentPlan();
  if (!plan) return 0;
  const today = todayLocal();

  // Group plan items into ordered lanes; one entry per task, skipping done tasks.
  const items = store.getPlanItems(plan.id); // ordered by lane, order_in_lane
  const laneMap = new Map<number, LaneTaskForDating[]>();
  const seen = new Set<number>();
  for (const it of items) {
    if (seen.has(it.task_id)) continue;
    const task = store.getTask(it.task_id);
    if (!task || task.status === "done") continue;
    seen.add(it.task_id);
    if (!laneMap.has(it.lane)) laneMap.set(it.lane, []);
    laneMap.get(it.lane)!.push({ task_id: task.id, title: task.title, type: task.type, priority: task.priority, effort: task.effort });
  }

  const lanes: LaneForDating[] = [...laneMap.keys()].sort((x, y) => x - y).map((lane) => ({ lane, tasks: laneMap.get(lane)! }));
  const total = lanes.length;
  onProgress?.(0, total);

  let dated = 0;
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    let assignments: { taskId: number; date: string }[] = [];
    try {
      assignments = await replanDatesForLane(today, lane, { model: cfg.models.dates, effort: cfg.effort.dates }, run);
    } catch {
      assignments = []; // best-effort: a failed lane falls back to clamp/today below
    }
    const byId = new Map(assignments.map((a) => [a.taskId, a.date]));

    let prev: string | null = null;
    for (const t of lane.tasks) {
      let date = byId.get(t.task_id) ?? prev ?? today;
      if (prev) {
        const a = parseDateLocal(date);
        const b = parseDateLocal(prev);
        if (a && b && a.getTime() < b.getTime()) date = prev; // clamp non-decreasing
      }
      store.updateTask(t.task_id, { due: date });
      prev = date;
      dated += 1;
    }
    onProgress?.(i + 1, total);
  }
  return dated;
}
```

- [ ] **Step 4: Run test, verify it passes** — Run: `npx vitest run src/server/redatePass.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/server/redatePass.ts src/server/redatePass.test.ts
git commit -m "feat(server): redateCurrentPlan — per-lane dating, clamp, progress"
```

---

## Task 4: Replanner — redate + replan-then-redate + SSE

**Files:** Modify `src/server/replan.ts`

- [ ] **Step 1: Implement.** In `src/server/replan.ts`, add the import after the suggestDuePass import:
```ts
import { redateCurrentPlan } from "./redatePass.js";
```

Add the public request methods after `requestReplan`:
```ts
  /** Re-decide completion dates on the current lanes (button). */
  requestRedate(): void {
    void this.redate();
  }

  /** Re-plan the lanes (e.g. after a lane-count change), then re-date them. */
  requestReplanThenRedate(): void {
    void this.replanThenRedate();
  }
```

Add the private implementations after `run`:
```ts
  private async redate(): Promise<void> {
    this.hub.broadcast({ type: "redate", phase: "start", done: 0, total: 0 });
    try {
      await redateCurrentPlan(this.store, this.cfg, (done, total) =>
        this.hub.broadcast({ type: "redate", phase: "progress", done, total }),
      );
    } catch (err) {
      process.stderr.write(`spear: redate failed (${err instanceof Error ? err.message : String(err)})\n`);
    }
    this.hub.broadcast({ type: "redate", phase: "end", done: 0, total: 0 });
    this.hub.broadcast({ type: "update", source: "refresh" });
  }

  private async replanThenRedate(): Promise<void> {
    this.hub.broadcast({ type: "replan", phase: "start" });
    const { error } = await buildAndSavePlan(this.store, this.cfg, "manual");
    if (error) process.stderr.write(`spear: re-plan failed (${error})\n`);
    this.hub.broadcast({ type: "replan", phase: "end", ...(error ? { error } : {}) });
    void this.refreshSuggestedDue();
    if (!error) await this.redate();
  }
```

- [ ] **Step 2: Verify build + suite.** Run: `npm run typecheck && npx vitest run` — Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add src/server/replan.ts
git commit -m "feat(server): Replanner.requestRedate + requestReplanThenRedate + redate SSE"
```

---

## Task 5: Routes + web client

**Files:** Modify `src/server/app.ts`, `src/web/api.ts`

- [ ] **Step 1: Add the route.** In `src/server/app.ts`, add right after the existing `app.post("/api/config/lanes", …)` handler block:
```ts
  // ---- re-decide completion dates on the current lanes (no re-plan) ----
  app.post("/api/plan/replan-dates", async () => {
    replanner.requestRedate();
    return { ok: true };
  });
```

- [ ] **Step 2: Auto-redate on lane-count change.** In the `app.post("/api/config/lanes", …)` handler, replace:
```ts
    replanner.requestReplan("manual"); // reorder everything into the new lane count
```
with:
```ts
    replanner.requestReplanThenRedate(); // reorder into the new lane count, then re-date
```

- [ ] **Step 3: Web client.** In `src/web/api.ts`, after `setMaxLanes`:
```ts
/** Re-decide completion dates on the current lanes (server runs per-lane LLM calls). */
export async function replanDates(): Promise<void> {
  const r = await fetch("/api/plan/replan-dates", { method: "POST" });
  if (!r.ok) throw new Error(`replan-dates ${r.status}`);
}
```

- [ ] **Step 4: Verify build + suite.** Run: `npm run typecheck && npx vitest run` — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/server/app.ts src/web/api.ts
git commit -m "feat: /api/plan/replan-dates route + lane-change auto-redate + client"
```

---

## Task 6: App — redate progress state + SSE

**Files:** Modify `src/web/App.tsx`

- [ ] **Step 1: Add state + pass to Today.** In `src/web/App.tsx`:

Add the import for `replanDates` is NOT needed here (Today calls it). Add the state after `const [lanes, setLanes] = useState<number>(6);`:
```ts
  const [redate, setRedate] = useState<{ done: number; total: number } | null>(null);
```

In the SSE `es.onmessage` handler, add handling for `redate` events — insert right before the final `load();` call, after the `replan` `end` block:
```ts
      if (msg?.type === "redate") {
        const m = msg as { phase?: string; done?: number; total?: number };
        if (m.phase === "end") {
          setRedate(null);
        } else {
          setRedate({ done: m.done ?? 0, total: m.total ?? 0 });
        }
        load();
        return;
      }
```

> Note: the `msg` local is typed `{ type?: string; phase?: string }`; the cast above reads `done`/`total`.

Pass `redate` to Today — change:
```tsx
            {today && <Today data={today} onChange={load} />}
```
to:
```tsx
            {today && <Today data={today} onChange={load} redate={redate} />}
```

- [ ] **Step 2: Verify build.** Run: `npm run build:web` — Expected: no type errors (Today's new prop is added in Task 7; if you build before Task 7, expect a prop-type error — do Task 7 then build).

- [ ] **Step 3: Commit** (after Task 7 builds clean, or commit now and let Task 7 finish the prop)
```bash
git add src/web/App.tsx
git commit -m "feat(web): App tracks redate progress from SSE"
```

---

## Task 7: Today — replan-dates button + determinate progress bar

**Files:** Modify `src/web/components/Today.tsx`, `src/web/styles.css`

- [ ] **Step 1: Implement.** In `src/web/components/Today.tsx`:

Add to the existing `../api` import list a `replanDates` import. The file imports several names from `"../api"`; add `replanDates` to that import (it's a value import, alongside `setTaskStatus` etc.):
```ts
import { replanDates } from "../api";
```
(If the file already has a `import { … } from "../api";` value-import block, add `replanDates` to it instead of a second import line.)

Change the `Today` signature + header. Replace:
```tsx
export function Today({ data, onChange }: { data: TodayData; onChange: () => void }) {
  if (!data.plan) {
    return <div className="empty">No current plan. Run <code>spear plan</code> to generate today's execution flow.</div>;
  }
  return (
    <div>
      <div className="narrative">
        <div className="head">
          ░ Execution Flow — {data.plan.plan_date} · {data.plan.trigger} ·{" "}
          {data.plan.model ? "llm" : "deterministic"}
        </div>
        {data.plan.narrative}
      </div>
```
with:
```tsx
export function Today({
  data,
  onChange,
  redate,
}: {
  data: TodayData;
  onChange: () => void;
  redate?: { done: number; total: number } | null;
}) {
  if (!data.plan) {
    return <div className="empty">No current plan. Run <code>spear plan</code> to generate today's execution flow.</div>;
  }
  const pct = redate && redate.total ? Math.round((redate.done / redate.total) * 100) : 0;
  return (
    <div>
      <div className="narrative">
        <div className="head">
          <span>
            ░ Execution Flow — {data.plan.plan_date} · {data.plan.trigger} ·{" "}
            {data.plan.model ? "llm" : "deterministic"}
          </span>
          <button
            className="redate-btn"
            disabled={!!redate}
            title="Re-decide every task's completion date from the current lane order (keeps lane order)"
            onClick={() => void replanDates()}
          >
            ⟳ replan dates
          </button>
        </div>
        {redate && (
          <div className="redate-progress" title="re-deciding completion dates">
            <div className="redate-fill" style={{ width: `${pct}%` }} />
            <span className="redate-label">re-dating lanes… {redate.done}/{redate.total} ({pct}%)</span>
          </div>
        )}
        {data.plan.narrative}
      </div>
```

- [ ] **Step 2: Add styles.** Append to `src/web/styles.css`:
```css
/* ---- v0.1.24: replan-dates button + determinate progress bar ---- */
.narrative .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.redate-btn {
  background: transparent;
  color: var(--green, #00ff41);
  border: 1px solid var(--green, #00ff41);
  border-radius: 3px;
  font: inherit;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.redate-btn:hover:not(:disabled) { background: var(--green, #00ff41); color: var(--bg, #060a06); box-shadow: var(--glow); }
.redate-btn:disabled { opacity: 0.5; cursor: default; }
.redate-progress {
  position: relative;
  height: 16px;
  margin: 6px 0;
  border: 1px solid var(--green, #00ff41);
  border-radius: 3px;
  background: rgba(0, 255, 65, 0.08);
  overflow: hidden;
}
.redate-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: var(--green, #00ff41);
  opacity: 0.35;
  transition: width 0.3s ease;
}
.redate-label {
  position: relative;
  z-index: 1;
  display: block;
  line-height: 16px;
  font-size: 11px;
  text-align: center;
  color: var(--green, #00ff41);
}
```

- [ ] **Step 3: Verify build.** Run: `npm run build:web` — Expected: no type errors.

- [ ] **Step 4: Commit**
```bash
git add src/web/components/Today.tsx src/web/styles.css
git commit -m "feat(web): Today replan-dates button + determinate progress bar"
```

---

## Task 8: CHANGELOG, version, verify, smoke, release, local refresh

**Files:** Modify `CHANGELOG.md`, `package.json`

- [ ] **Step 1: CHANGELOG.** Insert above `## [0.1.23]`:
```markdown
## [0.1.24] — 2026-06-17
### Added
- **Replan dates.** A "⟳ replan dates" button on the Today flow re-decides every task's completion date
  from the current lane order (without changing the order), assuming ~2 tasks per lane per day, via one
  LLM call per lane with a live percentage progress bar. Within-lane dates are clamped non-decreasing.
  It also runs automatically after a lane-count change. New `models.dates` / `effort.dates` config keys.

```

- [ ] **Step 2: Version.** In `package.json`, set `"version": "0.1.24"`.

- [ ] **Step 3: Full verification.** Run: `npm run typecheck && npm test && npm run build` — Expected: typecheck clean, all tests PASS, build produces `dist/` + `dist/web/`.

- [ ] **Step 4: Live smoke (throwaway home).**
```bash
export SPEAR_HOME=/tmp/spear-v24-$$
mkdir -p "$SPEAR_HOME"
node dist/cli.js serve --port 4405 >/tmp/spear-v24.log 2>&1 &
SRV=$!; sleep 2
# seed a couple of tasks + a plan
node dist/cli.js add "task one" --force </dev/null >/dev/null 2>&1
node dist/cli.js add "task two" --force </dev/null >/dev/null 2>&1
node dist/cli.js plan >/dev/null 2>&1   # build a current plan (LLM)
echo "dues BEFORE: $(sqlite3 "$SPEAR_HOME/spear.db" "SELECT id||':'||COALESCE(due,'-') FROM tasks ORDER BY id;")"
curl -s -X POST localhost:4405/api/plan/replan-dates >/dev/null
# wait for the per-lane LLM call(s) to write dates
until [ "$(sqlite3 "$SPEAR_HOME/spear.db" "SELECT COUNT(*) FROM tasks WHERE due IS NOT NULL;")" != "0" ]; do sleep 3; done
echo "dues AFTER:  $(sqlite3 "$SPEAR_HOME/spear.db" "SELECT id||':'||COALESCE(due,'-') FROM tasks ORDER BY id;")"
kill $SRV 2>/dev/null; rm -rf "$SPEAR_HOME"; unset SPEAR_HOME
```
Expected: AFTER shows the tasks with `YYYY-MM-DD` due dates (today or later). (Run this in the background — it makes real LLM calls; ~30-60s.)

> The progress bar is a UI interaction — verify it in the live app during Step 8 (click ⟳ replan dates → the bar fills lane-by-lane with a percentage).

- [ ] **Step 5: Commit.**
```bash
git add CHANGELOG.md package.json
git commit -m "chore: release v0.1.24 — replan dates with per-lane progress"
```

- [ ] **Step 6: Install locally.** Run: `npm run build && npm link` — Expected: `spear --version` → `0.1.24`.

- [ ] **Step 7: Push + tag.**
```bash
git push origin main
git tag v0.1.24
git push origin v0.1.24
```

- [ ] **Step 8: Confirm release + refresh the local desktop app.** Poll the release run to `completed/success`, then `gh release view v0.1.24 --json assets --jq '.assets[].name'` (expect `spear-0.1.24-arm64.dmg`). Then refresh the installed app (download → verify sha512 → quit → swap into /Applications → de-quarantine → relaunch), as done for prior releases. In the running app, click **⟳ replan dates** and confirm the bar fills with a percentage and dates update.

---

## Self-Review

**Spec coverage:**
- A (`replanDatesForLane`, per-lane, 2/day, validate): Task 2. ✔
- B (`redateCurrentPlan`: group lanes, skip done, clamp + fallback, write due, progress incl. `(0,total)`): Task 3. ✔
- C (Replanner `requestRedate` / `requestReplanThenRedate` + `redate` SSE): Task 4. ✔
- D (route `/api/plan/replan-dates`; lane-change → `requestReplanThenRedate`): Task 5. ✔
- E (web `replanDates`, App redate state + SSE, Today button + determinate bar): Tasks 5, 6, 7. ✔
- F (config `models.dates` / `effort.dates`): Task 1. ✔
- G (tests for `replanDatesForLane` + `redateCurrentPlan` clamp/progress/done-skip): Tasks 2, 3. ✔
- Release v0.1.24 + CHANGELOG: Task 8. ✔

**Placeholder scan:** No TBD/TODO. Task 6/7 notes about import placement and build-order are concrete guidance, not placeholders.

**Type consistency:** `LaneForDating` / `LaneTaskForDating` / `DateAssignment` (Task 2) are reused by `redateCurrentPlan` (Task 3). `RedateProgress = (done, total) => void` matches the Replanner's `(done, total)` callback (Task 4) and the test (Task 3). The `redate` SSE shape `{ type:"redate", phase, done, total }` is produced in Task 4 and consumed in Task 6. `redate?: { done, total } | null` prop matches between App (Task 6) and Today (Task 7). `cfg.models.dates` / `cfg.effort.dates` (Task 1) are used in Task 3.

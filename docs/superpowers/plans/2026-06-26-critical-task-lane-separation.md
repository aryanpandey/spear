# Critical-task Lane Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that no two distinct critical tasks share a planner lane, unless there are more critical tasks than lanes.

**Architecture:** A pure deterministic post-pass (`separateCriticalLanes`) rewrites lane assignments after the LLM plan + backfill, called from the single chokepoint `buildAndSavePlan` before `savePlan`. A one-line system-prompt addition nudges the LLM toward compliant plans so the pass rarely has to move anything.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), better-sqlite3, Vitest. Tasks (one row each) carry a `priority`; "sub-tasks" are the multiple *stages* of one `task_id`. A lane is emergent from `plan_items.lane`; each item carries its own `executor_id`.

**Key facts the implementer needs:**
- `PlanItemInput` (exported from `src/db/store.ts`): `{ task_id: number; stage_id: number; lane: number; order_in_lane: number; executor_id: number | null; is_delegation_candidate: boolean; scheduled_state: ScheduledState; rationale: string }`. Each `stage_id` is unique within a plan.
- `criticalTaskIds` = the set of `task_id`s whose task `priority === "critical"`, read from `context.flows` (`PlanContextFlow` has `taskId` and `priority`).
- "Lanes available" = `cfg.maxLanes` (default 6). The pass may place criticals in unused lane indices `0..maxLanes-1`.
- Critical block goes to the **head** of its lane (matches the existing "ready critical → head of lane" convention).
- Run tests: `npm test` (vitest run) or targeted `npx vitest run <file>`. Typecheck: `npm run typecheck`.

---

### Task 1: `separateCriticalLanes` pure function + unit tests

**Files:**
- Modify: `src/planner/build.ts` (add exported function next to `backfillReadyStages`)
- Test: `src/planner/build.test.ts` (add a new `describe` block + helpers)

- [ ] **Step 1: Write the failing unit tests**

Add to the **top** of `src/planner/build.test.ts`, update the existing import line, and append a new `describe` block. The import line currently reads `import { buildAndSavePlan } from "./build.js";` — change it to also import the new function and the type:

```ts
import { buildAndSavePlan, separateCriticalLanes } from "./build.js";
import type { PlanItemInput } from "../db/store.js";
```

Append this block at the end of the file:

```ts
// ---- helpers for separateCriticalLanes ----
let sid = 0;
function item(task_id: number, lane: number, order_in_lane: number, extra: Partial<PlanItemInput> = {}): PlanItemInput {
  return {
    task_id,
    stage_id: ++sid,
    lane,
    order_in_lane,
    executor_id: null,
    is_delegation_candidate: false,
    scheduled_state: "waiting",
    rationale: "r",
    ...extra,
  };
}
const laneOf = (out: PlanItemInput[], taskId: number) => out.find((i) => i.task_id === taskId)!.lane;
function maxCriticalsPerLane(out: PlanItemInput[], crit: Set<number>): number {
  const m = new Map<number, Set<number>>();
  for (const i of out) {
    if (!crit.has(i.task_id)) continue;
    if (!m.has(i.lane)) m.set(i.lane, new Set());
    m.get(i.lane)!.add(i.task_id);
  }
  return Math.max(0, ...[...m.values()].map((s) => s.size));
}

describe("separateCriticalLanes", () => {
  it("splits two distinct critical tasks sharing a lane when capacity exists", () => {
    const out = separateCriticalLanes([item(1, 0, 0), item(2, 0, 1)], new Set([1, 2]), 6);
    expect(laneOf(out, 1)).not.toBe(laneOf(out, 2));
    expect(maxCriticalsPerLane(out, new Set([1, 2]))).toBe(1);
  });

  it("leaves a single critical task's multiple stages in one lane (sub-tasks allowed)", () => {
    const input = [item(1, 0, 0), item(1, 0, 1), item(1, 0, 2)];
    const out = separateCriticalLanes(input, new Set([1]), 6);
    expect(out).toHaveLength(3);
    expect(out.every((i) => i.lane === 0)).toBe(true);
  });

  it("separates criticals but never moves non-critical work", () => {
    const out = separateCriticalLanes(
      [item(1, 0, 0), item(2, 0, 1), item(3, 0, 2)],
      new Set([1, 2]),
      6,
    );
    expect(laneOf(out, 1)).not.toBe(laneOf(out, 2));
    expect(laneOf(out, 3)).toBe(0); // non-critical stays put
    expect(maxCriticalsPerLane(out, new Set([1, 2]))).toBe(1);
  });

  it("distributes evenly when there are more criticals than lanes", () => {
    const crit = new Set([1, 2, 3, 4, 5]);
    const input = [item(1, 0, 0), item(2, 0, 1), item(3, 0, 2), item(4, 0, 3), item(5, 0, 4)];
    const out = separateCriticalLanes(input, crit, 2);
    const lanesUsed = new Set(out.map((i) => i.lane));
    expect(lanesUsed.size).toBeLessThanOrEqual(2);
    expect(maxCriticalsPerLane(out, crit)).toBeLessThanOrEqual(Math.ceil(5 / 2)); // 3
  });

  it("is a no-op on an already-compliant plan (idempotent)", () => {
    const crit = new Set([1, 2]);
    const input = [item(1, 0, 0), item(2, 1, 0)];
    const once = separateCriticalLanes(input, crit, 6);
    const twice = separateCriticalLanes(once, crit, 6);
    expect(laneOf(once, 1)).toBe(0);
    expect(laneOf(once, 2)).toBe(1);
    expect(twice).toEqual(once);
  });

  it("consolidates a critical task the LLM split across two lanes", () => {
    const crit = new Set([1, 2]);
    const out = separateCriticalLanes(
      [item(1, 0, 0), item(1, 1, 0), item(2, 1, 1)],
      crit,
      6,
    );
    expect(new Set(out.filter((i) => i.task_id === 1).map((i) => i.lane)).size).toBe(1);
    expect(maxCriticalsPerLane(out, crit)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/planner/build.test.ts`
Expected: FAIL — `separateCriticalLanes` is not exported from `./build.js` (import/type error or "is not a function").

- [ ] **Step 3: Implement `separateCriticalLanes`**

Append this exported function to `src/planner/build.ts` (after `backfillReadyStages`, before `buildAndSavePlan`):

```ts
/**
 * Hard rule: no two DISTINCT critical tasks may share a lane. The multiple stages
 * of a single critical task (its "sub-tasks") may share a lane freely. When there
 * are more critical tasks than lanes (`maxLanes`), doubling up is unavoidable, so
 * criticals are spread across the available lanes as evenly as possible.
 *
 * Pure and idempotent: a compliant plan is returned unchanged; never drops items.
 */
export function separateCriticalLanes(
  items: PlanItemInput[],
  criticalTaskIds: Set<number>,
  maxLanes: number,
): PlanItemInput[] {
  const isCritical = (taskId: number) => criticalTaskIds.has(taskId);

  const presentCritical = [...new Set(items.filter((it) => isCritical(it.task_id)).map((it) => it.task_id))];
  if (presentCritical.length <= 1) return items; // 0 or 1 critical task — nothing to separate

  // Original position of each item (stage_id is unique) — for stable ordering after moves.
  const origPos = new Map<number, { lane: number; order: number }>();
  for (const it of items) origPos.set(it.stage_id, { lane: it.lane, order: it.order_in_lane });

  // Each critical task's current head (lowest lane, then lowest order).
  const head = new Map<number, { lane: number; order: number }>();
  for (const it of items) {
    if (!isCritical(it.task_id)) continue;
    const cur = head.get(it.task_id);
    if (!cur || it.lane < cur.lane || (it.lane === cur.lane && it.order_in_lane < cur.order)) {
      head.set(it.task_id, { lane: it.lane, order: it.order_in_lane });
    }
  }

  // Assign each critical task one target lane, most-prominent (lowest head) first.
  const assignOrder = [...presentCritical].sort((a, b) => {
    const ha = head.get(a)!;
    const hb = head.get(b)!;
    return ha.lane - hb.lane || ha.order - hb.order || a - b;
  });
  const criticalsInLane = new Map<number, number>();
  for (let l = 0; l < maxLanes; l++) criticalsInLane.set(l, 0);
  const target = new Map<number, number>();
  for (const taskId of assignOrder) {
    const cur = head.get(taskId)!.lane;
    let lane: number;
    if (cur < maxLanes && criticalsInLane.get(cur) === 0) {
      lane = cur; // keep it where it is — no churn
    } else {
      lane = 0;
      let fewest = Infinity;
      for (let l = 0; l < maxLanes; l++) {
        const c = criticalsInLane.get(l)!;
        if (c < fewest) {
          fewest = c;
          lane = l;
        }
      }
    }
    target.set(taskId, lane);
    criticalsInLane.set(lane, criticalsInLane.get(lane)! + 1);
  }

  // Move every critical task's items to its target lane; non-critical items stay.
  const moved = items.map((it) =>
    target.has(it.task_id) ? { ...it, lane: target.get(it.task_id)! } : it,
  );

  // Renumber order_in_lane per lane: critical blocks at the head, each task kept
  // contiguous, ordered stably by original position.
  const byLane = new Map<number, PlanItemInput[]>();
  for (const it of moved) {
    const arr = byLane.get(it.lane) ?? [];
    arr.push(it);
    byLane.set(it.lane, arr);
  }
  const blockKey = (laneItems: PlanItemInput[], taskId: number) => {
    let best = { lane: Infinity, order: Infinity };
    for (const it of laneItems) {
      if (it.task_id !== taskId) continue;
      const p = origPos.get(it.stage_id)!;
      if (p.lane < best.lane || (p.lane === best.lane && p.order < best.order)) best = p;
    }
    return best;
  };
  const out: PlanItemInput[] = [];
  for (const lane of [...byLane.keys()].sort((a, b) => a - b)) {
    const laneItems = byLane.get(lane)!;
    const taskIds = [...new Set(laneItems.map((it) => it.task_id))];
    taskIds.sort((a, b) => {
      const ca = isCritical(a) ? 0 : 1;
      const cb = isCritical(b) ? 0 : 1;
      if (ca !== cb) return ca - cb; // critical blocks first
      const ka = blockKey(laneItems, a);
      const kb = blockKey(laneItems, b);
      return ka.lane - kb.lane || ka.order - kb.order || a - b;
    });
    let order = 0;
    for (const taskId of taskIds) {
      const stages = laneItems
        .filter((it) => it.task_id === taskId)
        .sort((x, y) => {
          const px = origPos.get(x.stage_id)!;
          const py = origPos.get(y.stage_id)!;
          return px.lane - py.lane || px.order - py.order;
        });
      for (const it of stages) out.push({ ...it, order_in_lane: order++ });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/planner/build.test.ts`
Expected: PASS — all 6 `separateCriticalLanes` cases plus the 3 existing `buildAndSavePlan` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/planner/build.ts src/planner/build.test.ts
git commit -m "$(cat <<'EOF'
feat: separateCriticalLanes — keep distinct critical tasks in separate lanes

Pure, idempotent post-pass: reassigns lanes so no two distinct critical
task_ids share a lane unless there are more criticals than maxLanes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire `separateCriticalLanes` into `buildAndSavePlan` + integration test

**Files:**
- Modify: `src/planner/build.ts` (`buildAndSavePlan`, lines ~90-97)
- Test: `src/planner/build.test.ts` (add one case to the `buildAndSavePlan` describe block)

- [ ] **Step 1: Write the failing integration test**

Add this `it(...)` inside the existing `describe("buildAndSavePlan", ...)` block in `src/planner/build.test.ts`:

```ts
  it("keeps two distinct critical tasks out of the same lane", async () => {
    const store = freshStore();
    const a = addTask(store, { title: "Critical A", stages: [{ name: "Impl", kind: "implementation" }] });
    const b = addTask(store, { title: "Critical B", stages: [{ name: "Impl", kind: "implementation" }] });
    store.updateTask(a.task.id, { priority: "critical" });
    store.updateTask(b.task.id, { priority: "critical" });
    const exec = store.listExecutors(true)[0];
    // The LLM crams both criticals into lane 0.
    const run = async () => ({
      narrative: "n",
      lanes: [
        {
          lane: 0,
          executor_id: exec.id,
          items: [
            { task_id: a.task.id, stage_id: a.stages[0].id, order: 0, is_delegation_candidate: false, scheduled_state: "start_now", rationale: "r" },
            { task_id: b.task.id, stage_id: b.stages[0].id, order: 1, is_delegation_candidate: false, scheduled_state: "start_now", rationale: "r" },
          ],
        },
      ],
    });
    const { plan } = await buildAndSavePlan(store, DEFAULT_CONFIG, "manual", run);
    const items = store.getPlanItems(plan!.id);
    const laneA = items.find((it) => it.task_id === a.task.id)!.lane;
    const laneB = items.find((it) => it.task_id === b.task.id)!.lane;
    expect(laneA).not.toBe(laneB);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/planner/build.test.ts -t "keeps two distinct critical tasks"`
Expected: FAIL — `laneA` and `laneB` are both `0` (pass not yet wired in).

- [ ] **Step 3: Wire the pass into `buildAndSavePlan`**

In `src/planner/build.ts`, the `buildAndSavePlan` body currently reads:

```ts
    // Guard against the LLM dropping flows when folding into fewer lanes.
    const items = backfillReadyStages(context, res.items);
    if (items.length > res.items.length) {
      process.stderr.write(`spear: re-plan kept ${items.length - res.items.length} flow(s) the planner omitted\n`);
    }
    const plan = store.savePlan(
      { plan_date: todayLocal(), trigger, narrative: res.narrative, model: cfg.models.planner },
      items,
    );
    return { plan };
```

Replace that block with:

```ts
    // Guard against the LLM dropping flows when folding into fewer lanes.
    const items = backfillReadyStages(context, res.items);
    if (items.length > res.items.length) {
      process.stderr.write(`spear: re-plan kept ${items.length - res.items.length} flow(s) the planner omitted\n`);
    }
    // Hard rule: no two distinct critical tasks share a lane (unless we run out of lanes).
    const criticalTaskIds = new Set(context.flows.filter((f) => f.priority === "critical").map((f) => f.taskId));
    const laneBefore = new Map(items.map((it) => [it.stage_id, it.lane]));
    const separated = separateCriticalLanes(items, criticalTaskIds, cfg.maxLanes);
    const relocated = separated.filter((it) => laneBefore.get(it.stage_id) !== it.lane).length;
    if (relocated > 0) {
      process.stderr.write(`spear: re-plan moved ${relocated} item(s) to keep critical tasks in separate lanes\n`);
    }
    const plan = store.savePlan(
      { plan_date: todayLocal(), trigger, narrative: res.narrative, model: cfg.models.planner },
      separated,
    );
    return { plan };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/planner/build.test.ts`
Expected: PASS — the new integration case and all prior cases green.

- [ ] **Step 5: Commit**

```bash
git add src/planner/build.ts src/planner/build.test.ts
git commit -m "$(cat <<'EOF'
feat: enforce critical-task lane separation in buildAndSavePlan

Apply separateCriticalLanes after backfill, before savePlan; log when it
relocates items. Single chokepoint covers plan/morning/replan paths.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: System-prompt nudge (reduce churn)

**Files:**
- Modify: `src/llm/planner.ts` (`systemPrompt`, the CRITICAL OVERRIDE paragraph block)

- [ ] **Step 1: Add the rule to the planner system prompt**

In `src/llm/planner.ts`, the `systemPrompt` function contains this paragraph:

```ts
CRITICAL OVERRIDE: a flow whose priority is "critical" and that is ready (no open blockers) is a drop-everything task. Place it at the HEAD of its lane — ahead of phase order and ahead of any overdue or in-progress flow in that lane — and set its next step's scheduled_state to "start_now", superseding whatever was previously current there. A critical flow that is still blocked stays "waiting".
```

Insert a new paragraph immediately after it (before the `ORDER WITHIN EACH LANE` / `Then get the founder...` text — i.e. add a blank line then this line):

```ts
ONE CRITICAL TASK PER LANE: never place two DIFFERENT critical tasks (different task_id) in the same lane — each critical task gets its own lane. The multiple stages of a SINGLE critical task share one lane (that is fine). Only put two critical tasks in one lane if there are more critical tasks than the ${maxLanes} lanes available.
```

The string already interpolates `${maxLanes}` elsewhere, so the placeholder resolves correctly.

- [ ] **Step 2: Run the full suite + typecheck to confirm nothing broke**

Run: `npm test && npm run typecheck`
Expected: PASS — all tests green, no type errors. (No test asserts prompt text, so the planner tests are unaffected.)

- [ ] **Step 3: Commit**

```bash
git add src/llm/planner.ts
git commit -m "$(cat <<'EOF'
feat: nudge planner LLM to give each critical task its own lane

Soft hint that complements the deterministic separateCriticalLanes pass,
reducing how often it has to relocate items.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Rule "no two distinct critical tasks share a lane" → Task 1 (`separateCriticalLanes`) + Task 2 (wiring).
- "sub-tasks (stages of one task_id) may share a lane" → Task 1, test "leaves a single critical task's multiple stages in one lane".
- "lanes available = maxLanes; spread when #critical > maxLanes" → Task 1, test "distributes evenly when there are more criticals than lanes" (maxLanes=2).
- "applies to all critical tasks incl. blocked/waiting" → `criticalTaskIds` from `context.flows` regardless of `scheduled_state`; helper uses `scheduled_state: "waiting"` default.
- "non-critical tasks never moved" → Task 1, test "separates criticals but never moves non-critical work".
- "idempotent / compliant = unchanged" → Task 1, idempotency test.
- "consolidate a critical split across lanes" → Task 1, consolidation test.
- "deterministic post-pass at buildAndSavePlan chokepoint, before savePlan, with stderr note" → Task 2.
- "system-prompt nudge" → Task 3.
- "Out of scope: no schema/config/UI/sticky-lane changes" → none of the tasks touch those.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the command and expected result.

**Type consistency:** `separateCriticalLanes(items: PlanItemInput[], criticalTaskIds: Set<number>, maxLanes: number): PlanItemInput[]` — same signature in the implementation (Task 1), the unit tests (Task 1), and the call site (Task 2). `PlanItemInput` fields match `src/db/store.ts`. `context.flows[].taskId` / `.priority` match `PlanContextFlow`. `cfg.maxLanes` matches `SpearConfig`.

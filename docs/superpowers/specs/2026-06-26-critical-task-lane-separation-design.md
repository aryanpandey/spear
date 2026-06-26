# Critical-task lane separation

**Date:** 2026-06-26
**Status:** Approved, pending implementation

## Problem

The planner groups open work into lanes (at most `cfg.maxLanes`). A lane can hold
items from several distinct tasks. Today nothing stops two unrelated **critical**
tasks from landing in the same lane, which buries one drop-everything task behind
another.

We want a hard rule: **no two distinct critical tasks share a lane** — unless there
are more critical tasks than lanes, in which case doubling up is unavoidable.

## Definitions

- **Critical** — `task.priority === "critical"`.
- **Distinct tasks** — different `task_id`s. The rule is by task identity, not theme.
- **Sub-tasks of one overall task** — the multiple *stages* of a single task. They
  share one `task_id`, so they may always share a lane. The rule never separates them.
- **A lane** — emergent from `plan_items.lane`; there is no lane entity. `executor_id`
  rides on each item, so relocating a task preserves its executor and a freshly-opened
  lane inherits the moved task's items.
- **Lanes available** — `cfg.maxLanes` (1–12, default 6). The rule may spread critical
  tasks into currently-unused lane indices up to `maxLanes`. "No more lanes available"
  therefore means *the number of distinct critical tasks exceeds `maxLanes`*.

## The rule (formal)

After a plan's items are assembled (LLM output → `backfillReadyStages`), and before
`savePlan`:

> Each lane contains items from **at most one** distinct critical task — unless the
> number of distinct critical tasks in the plan exceeds `maxLanes`, in which case
> critical tasks are distributed across the `maxLanes` lanes as evenly as possible
> (minimizing the maximum number of critical tasks in any one lane).

The rule applies to **every** critical task present in the plan, including blocked /
`waiting` ones. Non-critical tasks are never moved by this rule; they may co-habit a
lane with anything.

## Enforcement: deterministic repair pass + prompt nudge

The hard guarantee is a deterministic post-pass that rewrites lane assignments
regardless of what the LLM produced. A one-line system-prompt addition reduces how
often the pass has to move anything, keeping lanes stable.

Rejected alternatives:
- **Prompt-only** — an LLM will not reliably honor a stated hard limit.
- **Reject & regenerate on violation** — wasteful and still offers no guarantee.

## New function

`separateCriticalLanes(items, criticalTaskIds, maxLanes)` — pure, exported, in
`src/planner/build.ts` (sibling to `backfillReadyStages`).

1. Map each critical task → lane(s) it occupies; map each lane → critical tasks in it.
2. Assign one **target lane** per critical task (greedy, stable order — e.g. by current
   head `order_in_lane` then `task_id`): keep a critical task in a lane it already
   occupies when that lane has no other critical task assigned yet (minimize churn);
   otherwise pick the lane in `0..maxLanes-1` with the fewest criticals assigned so far,
   preferring empty lanes, breaking ties by lowest index. This yields ≤1 critical per
   lane when `#critical ≤ maxLanes`, and a round-robin (minimized maximum) when
   `#critical > maxLanes`.
3. Move every critical task's items (all its stages, kept together) to that task's
   target lane. Non-critical items stay in their lane.
4. Renumber `order_in_lane` per lane, placing each critical task's block at the **head**
   (matches the existing "ready critical → head of lane" convention), preserving each
   task's internal stage order and the relative order of the rest.

Properties: **idempotent** (a compliant plan is returned unchanged), pure, never drops
or duplicates items, never moves non-critical work, never exceeds `maxLanes` lanes.

## Integration

`buildAndSavePlan` (`src/planner/build.ts`): call `separateCriticalLanes(...)`
immediately after `backfillReadyStages` and before `savePlan`. Derive `criticalTaskIds`
from `context.flows` (`priority === "critical"`); read `maxLanes` from `cfg.maxLanes`.
Emit a `process.stderr` note when the pass relocates a task, mirroring the existing
backfill note.

This is the single chokepoint: `spear plan`, `morning`, add-triggered replan, and the
dashboard replan all route through `buildAndSavePlan`.

Prompt nudge (`src/llm/planner.ts`, `systemPrompt`): a HARD RULE line — never place two
different critical tasks in the same lane; give each critical task its own lane; only
double up critical tasks in a lane when there are more critical tasks than lanes.

## Tests (Vitest, co-located)

Unit (`separateCriticalLanes`):
- Two distinct critical tasks in one lane, with a spare lane → separated.
- One critical task with multiple stages in one lane → untouched (sub-tasks allowed).
- Critical mixed with non-critical in a lane → only the criticals separate; non-criticals
  stay.
- `#critical > maxLanes` → distributed; no lane exceeds `ceil(#critical / maxLanes)`
  criticals; no crash.
- Already-compliant plan → no-op (idempotent).
- A single critical task the LLM split across two lanes → consolidated into one lane.

Integration (`build.test.ts`): a stubbed runner returning a violating plan →
`buildAndSavePlan` saves a compliant plan.

## Out of scope (YAGNI)

- No schema change.
- No config toggle — it is an always-on hard rule.
- No UI change — lanes render from `item.lane`.
- No change to the unused sticky `task.lane` column.

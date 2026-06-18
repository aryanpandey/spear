# spear: lane sort (due→priority), priority-aware dates, and fetch-from-link intake

**Date:** 2026-06-18
**Target version:** v0.1.28 (tagged dmg release + repo push)
**Status:** Approved design → ready for implementation plan

## Summary

Two bundled changes:
- **A. Lane ordering + priority-aware dates.** In a Today lane, sort items: **in-progress first**, then by
  **due date** (soonest first, undated last), then by **priority**. And `redateCurrentPlan` assigns each
  lane's completion dates in **priority order** (highest priority gets the earliest dates).
- **B. Fetch tasks from a link.** When the add-bar text contains a URL, the intake extraction call enables
  fetch tools (`WebFetch` + the Notion MCP fetch) so the model reads the page (incl. a Notion workspace
  share-link via the user's Notion connection) and extracts its tasks/phases. Spiked live against the
  user's Notion checklist — it works.

## A. Lane sort + priority-aware dates

### A1 — lane sort (`src/web/components/Today.tsx`)
The `Lane` component currently sorts only by "in-progress floats to top". Replace with a comparator that
keys on, in order: **in-progress** (first), **due date ascending** (dated before undated; earlier first),
then **priority** (critical → low).

New pure helper `src/util/laneSort.ts`:
```ts
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export interface LaneSortable { task: { status: string; priority: string }; due: string | null }
export function compareLaneItems(a: LaneSortable, b: LaneSortable): number {
  const ip = Number(b.task.status === "in_progress") - Number(a.task.status === "in_progress");
  if (ip) return ip;
  if (a.due !== b.due) { if (!a.due) return 1; if (!b.due) return -1; return a.due < b.due ? -1 : 1; }
  return (RANK[a.task.priority] ?? 9) - (RANK[b.task.priority] ?? 9);
}
```
`Lane`: `const items = [...lane.items].sort(compareLaneItems);`

### A2 — priority-aware dating (`src/server/redatePass.ts`, `src/llm/replanDates.ts`)
In `redateCurrentPlan`, when assembling each lane's task list for dating, **sort that lane's tasks by
`PRIORITY_RANK`** (critical first) before the per-lane dating. Because the dating clamp makes dates
non-decreasing down the lane, the highest-priority task gets the earliest (or equal) completion date:
```ts
import { PRIORITY_RANK } from "../types.js";
// …
const lanes = [...laneMap.keys()].sort((x, y) => x - y).map((lane) => ({
  lane,
  tasks: laneMap.get(lane)!.slice().sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]),
}));
```
The `replanDatesForLane` SYSTEM prompt gains a rule: *"The tasks are listed highest-priority first; give
higher-priority tasks sooner (earlier or equal) dates."* (The 2-tasks/lane/day pacing + effort still set
the actual dates; the clamp guarantees the priority order holds.)

## B. Fetch tasks from a link (`src/llm/intake.ts`)

- Detect a URL in the prompt: `const URL_RE = /https?:\/\/\S+/i;`.
- In `extractTaskSeeds`, build `allowedTools` from what's present:
  - image → `Read` (as today);
  - URL → `WebFetch` **and** `mcp__claude_ai_Notion__notion-fetch` (the Notion connector tool — confirmed
    available in the local headless `claude -p`; it reads workspace `app.notion.com` links via the user's
    Notion session. Allowing it when absent is harmless — the model falls back to WebFetch).
- `buildPrompt` adds, when a URL is present: *"If the capture contains a URL, fetch that page (use WebFetch,
  or the Notion fetch tool for a Notion link) and extract the tasks/phases listed on it."*
- The extracted seeds flow through the normal confirm-and-edit popup before anything is created.
- Latency: a Notion fetch+extract is ~60s (well under the 180s `claudeJson` timeout); the add bar's
  determinate progress bar covers it.

### Caveats
- `WebFetch` alone cannot read a workspace `app.notion.com` share-link (it redirects to login); the Notion
  MCP tool is what makes those work. Truly-public pages (`*.notion.site` / "Publish to web", blogs, etc.)
  work via `WebFetch` regardless. If the Notion connector is ever disconnected, workspace links would need
  a published-to-web URL.

## C. Testing

- `src/util/laneSort.test.ts` — `compareLaneItems`: in-progress first; among non-in-progress, dated before
  undated and earlier-due first; equal/none due → priority order.
- `src/server/redatePass.test.ts` — add a case: a lane with a low-priority task listed before a
  high-priority one yields a high-priority `due` that is ≤ the low-priority `due` (priority order honored).
- `src/llm/intake.test.ts` — a prompt containing a URL passes `allowedTools` including `WebFetch` and
  `mcp__claude_ai_Notion__notion-fetch`; a plain prompt does not.

## Cross-cutting

- No new runtime dependencies; no schema change.
- **Docs:** `## [0.1.28]` CHANGELOG entry. **Release** v0.1.28 + local refresh.

## Rejected alternatives

- **Server-side HTTP fetch + readability for Notion** — rejected; `app.notion.com` needs auth and Notion
  is JS-rendered. The Notion MCP (via the user's session) + WebFetch (for public pages) is the working path.
- **Drop the in-progress float** — rejected per the user; in-progress stays pinned on top, then due→priority.
- **Sort lane dates by the planner's order** — rejected; the user wants priority to drive the dates.

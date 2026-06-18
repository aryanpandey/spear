# spear v0.1.28 — lane sort (due→priority) + priority-aware dates + fetch-from-link

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort Today lane items (in-progress → due → priority), make `redateCurrentPlan` assign dates in priority order, and let the add bar extract tasks from a URL (incl. a Notion workspace link).

**Architecture:** A pure `compareLaneItems` drives the Today lane sort; `redateCurrentPlan` priority-sorts each lane before dating (the non-decreasing clamp then gives high-priority earlier dates); `extractTaskSeeds` enables WebFetch + the Notion MCP fetch when the prompt contains a URL.

**Tech Stack:** Node/TS ESM, React/Vite, the Claude CLI (`claude -p`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-lane-sort-and-link-intake-design.md`

---

## File Structure
**New:** `src/util/laneSort.ts` (+ test).
**Modified:** `src/web/components/Today.tsx`, `src/server/redatePass.ts` (+test), `src/llm/replanDates.ts`,
`src/llm/intake.ts` (+test), `CHANGELOG.md`, `package.json`.

---

## Task 1: Lane sort helper + wire into Today

**Files:** Create `src/util/laneSort.ts`, `src/util/laneSort.test.ts`; Modify `src/web/components/Today.tsx`

- [ ] **Step 1: Write the failing test** — `src/util/laneSort.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { compareLaneItems, type LaneSortable } from "./laneSort.js";

const mk = (status: string, priority: string, due: string | null): LaneSortable => ({ task: { status, priority }, due });

describe("compareLaneItems", () => {
  it("floats in-progress to the top", () => {
    expect(compareLaneItems(mk("todo", "low", "2026-01-01"), mk("in_progress", "low", null))).toBeGreaterThan(0);
  });
  it("orders by due date (soonest first, undated last) among non-in-progress", () => {
    expect(compareLaneItems(mk("todo", "low", "2026-06-10"), mk("todo", "low", "2026-06-20"))).toBeLessThan(0);
    expect(compareLaneItems(mk("todo", "low", null), mk("todo", "low", "2026-06-20"))).toBeGreaterThan(0); // undated after dated
  });
  it("breaks ties by priority", () => {
    expect(compareLaneItems(mk("todo", "critical", "2026-06-10"), mk("todo", "low", "2026-06-10"))).toBeLessThan(0);
    expect(compareLaneItems(mk("todo", "high", null), mk("todo", "medium", null))).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/util/laneSort.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement** — `src/util/laneSort.ts`:
```ts
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface LaneSortable {
  task: { status: string; priority: string };
  due: string | null;
}

/** Order a lane: in-progress first, then by due date (soonest first, undated last), then priority. */
export function compareLaneItems(a: LaneSortable, b: LaneSortable): number {
  const ip = Number(b.task.status === "in_progress") - Number(a.task.status === "in_progress");
  if (ip) return ip;
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  return (RANK[a.task.priority] ?? 9) - (RANK[b.task.priority] ?? 9);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/util/laneSort.test.ts` → PASS.

- [ ] **Step 5: Wire into Today.** In `src/web/components/Today.tsx`, add the import (with the other imports):
```ts
import { compareLaneItems } from "../../util/laneSort";
```
In `Lane`, replace:
```tsx
  // Float in-progress work to the top of the lane (stable otherwise).
  const items = [...lane.items].sort(
    (a, b) => Number(b.task.status === "in_progress") - Number(a.task.status === "in_progress"),
  );
```
with:
```tsx
  // In-progress first, then by due date (soonest first, undated last), then priority.
  const items = [...lane.items].sort(compareLaneItems);
```

- [ ] **Step 6: Verify build.** `npm run build:web` → no type errors. (`TodayItem` has `task.status`, `task.priority`, and `due` — matches `LaneSortable`.)

- [ ] **Step 7: Commit**
```bash
git add src/util/laneSort.ts src/util/laneSort.test.ts src/web/components/Today.tsx
git commit -m "feat(web): sort lane by in-progress → due → priority"
```

---

## Task 2: Priority-aware dating

**Files:** Modify `src/server/redatePass.ts`, `src/llm/replanDates.ts`; Test `src/server/redatePass.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/server/redatePass.test.ts` (inside the existing `describe("redateCurrentPlan", …)`, reusing its `makeStore`/`planItem` helpers):
```ts
  it("dates higher-priority tasks earlier within a lane, regardless of plan order", async () => {
    const store = makeStore();
    const low = addTask(store, { title: "low", priority: "low", stages: [{ name: "s", kind: "generic" }] });
    const high = addTask(store, { title: "high", priority: "critical", stages: [{ name: "s", kind: "generic" }] });
    store.savePlan(
      { plan_date: "2026-06-18", trigger: "manual", narrative: "", model: "m" },
      [planItem(low.task.id, low.stages[0].id, 0, 0), planItem(high.task.id, high.stages[0].id, 0, 1)],
    );
    const planned: Record<number, string> = { [low.task.id]: "2026-06-22", [high.task.id]: "2026-06-19" };
    const run = async (prompt: string) => ({
      dates: Object.entries(planned)
        .filter(([id]) => prompt.includes(`"task_id":${id}`))
        .map(([id, date]) => ({ task_id: Number(id), date })),
    });
    await redateCurrentPlan(store, DEFAULT_CONFIG, undefined, run);
    expect(store.getTask(high.task.id)!.due).toBe("2026-06-19"); // critical sorted first → its date
    expect(store.getTask(low.task.id)!.due).toBe("2026-06-22"); // clamped ≥ the critical date
    expect(store.getTask(high.task.id)!.due! <= store.getTask(low.task.id)!.due!).toBe(true);
  });
```
> Confirm `addTask` is imported in `redatePass.test.ts` (it is — the existing tests use it).

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/server/redatePass.test.ts -t "higher-priority"` → FAIL (low-priority currently dated first → high gets clamped up to 2026-06-22).

- [ ] **Step 3: Implement (redatePass).** In `src/server/redatePass.ts`, add the import:
```ts
import { PRIORITY_RANK } from "../types.js";
```
Replace:
```ts
  const lanes: LaneForDating[] = [...laneMap.keys()].sort((x, y) => x - y).map((lane) => ({ lane, tasks: laneMap.get(lane)! }));
```
with:
```ts
  const lanes: LaneForDating[] = [...laneMap.keys()].sort((x, y) => x - y).map((lane) => ({
    lane,
    // Date in priority order so the non-decreasing clamp gives higher-priority tasks earlier dates.
    tasks: laneMap.get(lane)!.slice().sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]),
  }));
```

- [ ] **Step 4: Implement (prompt).** In `src/llm/replanDates.ts`, in the `SYSTEM` string, add a rule after the NON-DECREASING line:
```
- The tasks are listed highest-priority first; give higher-priority tasks sooner (earlier or equal) dates.
```

- [ ] **Step 5: Run, verify pass** — `npx vitest run src/server/redatePass.test.ts` → PASS (existing + new).

- [ ] **Step 6: Commit**
```bash
git add src/server/redatePass.ts src/server/redatePass.test.ts src/llm/replanDates.ts
git commit -m "feat(server): replan-dates assigns earlier dates to higher-priority tasks"
```

---

## Task 3: Fetch tasks from a link (intake)

**Files:** Modify `src/llm/intake.ts`; Test `src/llm/intake.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/llm/intake.test.ts`:
```ts
describe("extractTaskSeeds URL fetch", () => {
  const opts = { model: "m", effort: "low" as const };
  it("enables WebFetch + Notion fetch when the prompt has a URL", async () => {
    let seen: any;
    const run = async (_p: string, o: any) => {
      seen = o;
      return { seeds: [{ title: "t", details: "d" }] };
    };
    await extractTaskSeeds("get tasks from https://app.notion.com/p/abc", undefined, opts, run);
    expect(seen.allowedTools).toContain("WebFetch");
    expect(seen.allowedTools).toContain("mcp__claude_ai_Notion__notion-fetch");
  });
  it("does not enable fetch tools for a plain prompt", async () => {
    let seen: any;
    const run = async (_p: string, o: any) => {
      seen = o;
      return { seeds: [{ title: "t", details: "d" }] };
    };
    await extractTaskSeeds("just a normal task", undefined, opts, run);
    expect(seen.allowedTools).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/llm/intake.test.ts -t "URL fetch"` → FAIL.

- [ ] **Step 3: Implement.** In `src/llm/intake.ts`:

Add near the top (after the imports / before `SYSTEM`):
```ts
const URL_RE = /https?:\/\/\S+/i;
```

Replace `buildPrompt`:
```ts
function buildPrompt(prompt: string, imagePath?: string): string {
  let s = SYSTEM + "\n\n";
  if (imagePath) s += `An image is attached at ${imagePath}. Read it and use its contents.\n`;
  if (URL_RE.test(prompt)) s += `If the capture contains a URL, fetch that page (use WebFetch, or the Notion fetch tool for a Notion link) and extract the tasks/phases listed on it.\n`;
  s += `Capture:\n${prompt || "(no text — use the image)"}`;
  return s;
}
```

Replace the tool-enabling block in `extractTaskSeeds`:
```ts
  const callOpts: ClaudeOpts = { ...opts };
  if (imagePath) callOpts.allowedTools = ["Read"];
```
with:
```ts
  const callOpts: ClaudeOpts = { ...opts };
  const tools: string[] = [];
  if (imagePath) tools.push("Read");
  if (URL_RE.test(prompt)) tools.push("WebFetch", "mcp__claude_ai_Notion__notion-fetch");
  if (tools.length) callOpts.allowedTools = tools;
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/llm/intake.test.ts` → PASS (existing image tests + new URL tests).

- [ ] **Step 5: Commit**
```bash
git add src/llm/intake.ts src/llm/intake.test.ts
git commit -m "feat(llm): intake fetches a URL (WebFetch + Notion) to extract tasks"
```

---

## Task 4: CHANGELOG, version, verify, smoke, release, local refresh

**Files:** Modify `CHANGELOG.md`, `package.json`

- [ ] **Step 1: CHANGELOG.** Insert above `## [0.1.27]`:
```markdown
## [0.1.28] — 2026-06-18
### Added
- **Fetch tasks from a link.** Paste a page URL into the add bar and spear reads it and extracts the
  tasks/phases — public pages via WebFetch, and Notion workspace share-links via the Notion connector.
### Changed
- **Lane ordering**: in-progress first, then by due date (soonest first), then priority.
- **Replan dates** now assigns earlier completion dates to higher-priority tasks within a lane.

```

- [ ] **Step 2: Version.** Set `"version": "0.1.28"` in `package.json`.

- [ ] **Step 3: Full verification.** `npm run typecheck && npm test && npm run build` → all PASS.

- [ ] **Step 4: Live smoke (link intake, throwaway home).**
```bash
export SPEAR_HOME=/tmp/spear-v28-$$
mkdir -p "$SPEAR_HOME"
node dist/cli.js serve --port 4409 >/tmp/spear-v28.log 2>&1 &
SRV=$!; sleep 2
echo "extracting from the Notion checklist (this makes a real fetch+LLM call, ~60s)…"
curl -s -X POST localhost:4409/api/tasks/intake/check -H 'content-type: application/json' \
  -d '{"prompt":"Add the phases as tasks from this notion page: https://app.notion.com/p/riverline/Flyways-Dock-Test-Scenario-Checklist-382eedaaab858110b1b9da5607963317?source=copy_link"}' --max-time 170 \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('seeds:',len(d.get('seeds',[])));[print(' -',s['title']) for s in d.get('seeds',[])[:6]]"
kill $SRV 2>/dev/null; rm -rf "$SPEAR_HOME"; unset SPEAR_HOME
```
Expected: several seeds with real phase titles from the page (e.g. "Master-toggle gating …", "A1 — Manager approval loop …"). (Run in the background; ~60s.)

- [ ] **Step 5: Commit.**
```bash
git add CHANGELOG.md package.json
git commit -m "chore: release v0.1.28 — lane sort + priority dates + link intake"
```

- [ ] **Step 6: Install locally.** `npm run build && npm link` → `spear --version` = `0.1.28`.

- [ ] **Step 7: Push + tag.**
```bash
git push origin main
git tag v0.1.28
git push origin v0.1.28
```

- [ ] **Step 8: Confirm release + refresh local app.** Poll the run to `completed/success`; `gh release view v0.1.28 --json assets --jq '.assets[].name'` (expect `spear-0.1.28-arm64.dmg`). Refresh the installed app (download → verify sha512 → quit → swap → de-quarantine → relaunch). In the app: confirm lane items order in-progress → due → priority; run **⟳ replan dates** and confirm high-priority tasks get earlier dates; paste the Notion link in the add bar and confirm the phases get extracted into the confirm popup.

---

## Self-Review

**Spec coverage:**
- A1 (lane sort in-progress→due→priority): Task 1 (`compareLaneItems` + wire). ✔
- A2 (priority-aware dating: redatePass priority sort + prompt): Task 2. ✔
- B (URL → WebFetch + Notion fetch + prompt): Task 3. ✔
- C tests (laneSort, redatePass priority, intake URL tools): Tasks 1, 2, 3. ✔
- Release v0.1.28: Task 4. ✔

**Placeholder scan:** none. The smoke uses the user's real Notion URL (intentional, matches the spike).

**Type consistency:** `LaneSortable` (Task 1) matches `TodayItem`'s `{ task: { status, priority }, due }`. `PRIORITY_RANK` (Task 2) is the existing `types.ts` export (keys critical/high/medium/low). The intake `allowedTools` strings (`"WebFetch"`, `"mcp__claude_ai_Notion__notion-fetch"`, `"Read"`) match the spike and the test assertions (Task 3). `extractTaskSeeds(prompt, imagePath, opts, run)` signature is unchanged.
```

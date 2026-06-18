# spear v0.1.29 — dynamic task search on Today

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search box on the Today view that, as you type, ranks open tasks by a deterministic relevance score and shows the matches as a flat most-relevant-first list (no LLM).

**Architecture:** A pure `rankTasks` scorer (title/stage/type/notes) in `src/util`; `Today` adds a `query` state and renders ranked results (reusing the `Item` card) instead of lanes while the query is non-empty. The Today item DTO gains `description` so notes are searchable.

**Tech Stack:** React/Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-today-search-design.md`

---

## File Structure
**New:** `src/util/taskSearch.ts` (+ test).
**Modified:** `src/server/dto.ts`, `src/web/api.ts`, `src/web/components/Today.tsx`, `src/web/styles.css`,
`CHANGELOG.md`, `package.json`.

---

## Task 1: Relevance scorer

**Files:** Create `src/util/taskSearch.ts`, `src/util/taskSearch.test.ts`

- [ ] **Step 1: Write the failing test** — `src/util/taskSearch.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { scoreMatch, rankTasks, type Searchable } from "./taskSearch.js";

const mk = (title: string, stageName = "", type = "other", description = ""): Searchable => ({ title, stageName, type, description });

describe("scoreMatch", () => {
  it("ranks exact > prefix > substring > token, and excludes non-matches", () => {
    const q = "login";
    expect(scoreMatch(mk("login"), q)).toBeGreaterThan(scoreMatch(mk("login button"), q));
    expect(scoreMatch(mk("login button"), q)).toBeGreaterThan(scoreMatch(mk("fix the login"), q));
    expect(scoreMatch(mk("fix the login"), q)).toBeGreaterThan(scoreMatch(mk("auth flow", "login stage"), q));
    expect(scoreMatch(mk("unrelated"), q)).toBe(0);
  });
  it("matches notes and is multi-token", () => {
    expect(scoreMatch(mk("X", "", "other", "needs csv export"), "csv")).toBeGreaterThan(0);
    expect(scoreMatch(mk("Add CSV export to reports"), "csv reports")).toBeGreaterThan(scoreMatch(mk("Add CSV export"), "csv reports"));
  });
});

describe("rankTasks", () => {
  const items = [{ t: mk("write report") }, { t: mk("login bug") }, { t: mk("login button broken") }];
  it("returns most-relevant first; all items when blank", () => {
    const r = rankTasks(items, "login", (x) => x.t).map((x) => x.t.title);
    expect(r).toEqual(["login bug", "login button broken"]); // both match; 'login bug' shorter/earlier on tie? both substring → stable order
    expect(rankTasks(items, "", (x) => x.t)).toHaveLength(3);
    expect(rankTasks(items, "zzz", (x) => x.t)).toHaveLength(0);
  });
});
```
> Note: "login bug" and "login button broken" both contain "login" → equal substring score; the test
> expects them in their original (stable) order, which `rankTasks` preserves on ties.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/util/taskSearch.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement** — `src/util/taskSearch.ts`:
```ts
export interface Searchable {
  title: string;
  stageName: string;
  type: string;
  description: string;
}

/** Deterministic relevance score of a task against a query (0 = no match). */
export function scoreMatch(s: Searchable, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = s.title.toLowerCase();
  const hay = `${title} ${s.stageName} ${s.type} ${s.description}`.toLowerCase();
  let score = 0;
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 40;
  if (title.includes(q)) score += 20;
  else if (hay.includes(q)) score += 8;
  for (const tok of q.split(/\s+/).filter(Boolean)) {
    if (title.includes(tok)) score += 5;
    else if (hay.includes(tok)) score += 2;
  }
  return score;
}

/** Filter + rank items by relevance (most relevant first; stable on ties). Blank query → all items. */
export function rankTasks<T>(items: T[], query: string, get: (i: T) => Searchable): T[] {
  if (!query.trim()) return items;
  return items
    .map((i, idx) => ({ i, idx, s: scoreMatch(get(i), query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map((x) => x.i);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/util/taskSearch.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/util/taskSearch.ts src/util/taskSearch.test.ts
git commit -m "feat(util): taskSearch relevance scorer + rankTasks"
```

---

## Task 2: Carry `description` on Today items

**Files:** Modify `src/server/dto.ts`, `src/web/api.ts`

- [ ] **Step 1: Server DTO.** In `src/server/dto.ts`, in the `TodayItemDto` interface, change the `task`
field to include `description`:
```ts
  task: { id: number; title: string; priority: Priority; type: TaskType; status: TaskStatus; description: string };
```
In `todayDto`, where each item's `task` object is built, add `description`:
```ts
      task: { id: task.id, title: task.title, priority: task.priority, type: task.type, status: task.status, description: task.description },
```

- [ ] **Step 2: Web type.** In `src/web/api.ts`, in the `TodayItem` interface, update `task`:
```ts
  task: { id: number; title: string; priority: Priority; type: TaskType; status: TaskStatus; description: string };
```

- [ ] **Step 3: Verify.** `npm run typecheck && npm run build:web` → PASS / no type errors.

- [ ] **Step 4: Commit**
```bash
git add src/server/dto.ts src/web/api.ts
git commit -m "feat(dto): include description on Today items (for search)"
```

---

## Task 3: Search UI on Today

**Files:** Modify `src/web/components/Today.tsx`, `src/web/styles.css`

- [ ] **Step 1: Import + state.** In `src/web/components/Today.tsx`, add the import:
```ts
import { rankTasks } from "../../util/taskSearch";
```
In the `Today` function body, right after the `const pct = …` line, add:
```ts
  const [query, setQuery] = useState("");
  const results = rankTasks(
    data.lanes.flatMap((l) => l.items),
    query,
    (it) => ({ title: it.task.title, stageName: it.stage.name, type: it.task.type, description: it.task.description }),
  );
  const searching = query.trim().length > 0;
```
(`useState` is already imported in this file.)

- [ ] **Step 2: Render the search box + conditional results.** Replace:
```tsx
      </div>
      {data.lanes.length === 0 ? (
        <div className="empty">inbox zero — no open work.</div>
      ) : (
        <div className="lanes">
          {data.lanes.map((l, i) => (
            <Lane key={l.lane} lane={l} number={i + 1} onChange={onChange} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
```
with:
```tsx
      </div>
      <div className="task-search">
        <span className="task-search-icon">⌕</span>
        <input
          className="task-search-input"
          placeholder="search tasks — title, stage, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && (
          <button className="task-search-x" title="clear" onClick={() => setQuery("")}>
            ✕
          </button>
        )}
      </div>
      {searching ? (
        <div className="search-results">
          <div className="muted" style={{ marginBottom: 8 }}>
            {results.length} match{results.length === 1 ? "" : "es"} for “{query.trim()}”
          </div>
          {results.map((it) => (
            <Item key={`${it.task.id}-${it.stage.id}`} item={it} onChange={onChange} onOpen={onOpen} />
          ))}
          {results.length === 0 && <div className="empty">no matching tasks.</div>}
        </div>
      ) : data.lanes.length === 0 ? (
        <div className="empty">inbox zero — no open work.</div>
      ) : (
        <div className="lanes">
          {data.lanes.map((l, i) => (
            <Lane key={l.lane} lane={l} number={i + 1} onChange={onChange} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Styles.** Append to `src/web/styles.css`:
```css
/* ---- v0.1.29: Today task search ---- */
.task-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 5px 10px;
}
.task-search:focus-within { border-color: var(--green); box-shadow: var(--glow); }
.task-search-icon { color: var(--green); }
.task-search-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  padding: 3px 2px;
}
.task-search-input:focus { outline: none; }
.task-search-input::placeholder { color: var(--text-dim); }
.task-search-x { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 12px; }
.task-search-x:hover { color: var(--crit); }
.search-results { max-width: 520px; }
```

- [ ] **Step 4: Verify.** `npm run build:web` → no type errors.

- [ ] **Step 5: Commit**
```bash
git add src/web/components/Today.tsx src/web/styles.css
git commit -m "feat(web): dynamic task search on Today (flat ranked results)"
```

---

## Task 4: CHANGELOG, version, verify, release, local refresh

**Files:** Modify `CHANGELOG.md`, `package.json`

- [ ] **Step 1: CHANGELOG.** Insert above `## [0.1.28]`:
```markdown
## [0.1.29] — 2026-06-18
### Added
- **Search tasks on Today.** A search box ranks open tasks by relevance (title, stage, type, notes) as
  you type and shows the matches as a flat most-relevant-first list. Instant, client-side, no LLM.

```

- [ ] **Step 2: Version.** Set `"version": "0.1.29"` in `package.json`.

- [ ] **Step 3: Full verification.** `npm run typecheck && npm test && npm run build` → all PASS.

- [ ] **Step 4: Live smoke (DTO has description; throwaway home).**
```bash
export SPEAR_HOME=/tmp/spear-v29-$$
mkdir -p "$SPEAR_HOME"
node dist/cli.js serve --port 4410 >/tmp/spear-v29.log 2>&1 &
SRV=$!; sleep 2
node dist/cli.js add "search smoke task" --force </dev/null >/dev/null 2>&1
node dist/cli.js plan </dev/null >/dev/null 2>&1
echo "today item has description field: $(curl -s localhost:4410/api/today | python3 -c 'import sys,json;d=json.load(sys.stdin);it=(d.get("lanes") or [{}])[0].get("items",[{}]) if d.get("lanes") else [];print("description" in (it[0]["task"] if it else {}))' 2>/dev/null)"
kill $SRV 2>/dev/null; rm -rf "$SPEAR_HOME"; unset SPEAR_HOME
```
Expected: `today item has description field: True`. (The search UI itself is client-side — verify it live in Step 8.)

- [ ] **Step 5: Commit.**
```bash
git add CHANGELOG.md package.json
git commit -m "chore: release v0.1.29 — Today task search"
```

- [ ] **Step 6: Install locally.** `npm run build && npm link` → `spear --version` = `0.1.29`.

- [ ] **Step 7: Push + tag.**
```bash
git push origin main
git tag v0.1.29
git push origin v0.1.29
```

- [ ] **Step 8: Confirm release + refresh local app.** Poll the run to `completed/success`; `gh release view v0.1.29 --json assets --jq '.assets[].name'` (expect `spear-0.1.29-arm64.dmg`). Refresh the installed app (download → verify sha512 → quit → swap → de-quarantine → relaunch). On Today, type in the search box and confirm the matching tasks appear ranked most-relevant first, that clicking a result still works (start/done/open detail), and that clearing the box restores the lanes.

---

## Self-Review

**Spec coverage:**
- A (scorer: title/stage/type/notes weighting; rankTasks): Task 1. ✔
- B (description on TodayItemDto.task + web TodayItem): Task 2. ✔
- C (search box, query state, flat ranked results reusing Item, empty state, clear): Task 3. ✔
- D (taskSearch tests): Task 1. ✔
- Release v0.1.29: Task 4. ✔

**Placeholder scan:** none. The test comment about stable-tie order is explanatory, not a placeholder.

**Type consistency:** `Searchable { title, stageName, type, description }` (Task 1) matches the accessor in
Task 3 (`it.task.title`, `it.stage.name`, `it.task.type`, `it.task.description`). `description` is added to
`TodayItemDto.task` (server, Task 2) and `TodayItem.task` (web, Task 2) so the accessor type-checks.
`rankTasks(items, query, get)` signature is identical between Task 1 and the Task 3 call site. `Item` props
`{ item, onChange, onOpen }` match the results map (Task 3).
```

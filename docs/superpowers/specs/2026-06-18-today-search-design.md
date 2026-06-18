# spear: dynamic task search on the Today view

**Date:** 2026-06-18
**Target version:** v0.1.29 (tagged dmg release + repo push)
**Status:** Approved design → ready for implementation plan

## Summary

A search box at the top of the Today view. As you type, a deterministic (no-LLM) relevance scorer ranks
the open tasks and the lanes are replaced by a **flat list of matches, most-relevant first**; clearing
the box restores the lanes. All client-side and instant.

## A. Relevance scoring (`src/util/taskSearch.ts`, pure + tested)

Search each task's **title, current stage name, type, and notes (`description`)**:
```ts
export interface Searchable { title: string; stageName: string; type: string; description: string }

export function scoreMatch(s: Searchable, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = s.title.toLowerCase();
  const hay = `${title} ${s.stageName} ${s.type} ${s.description}`.toLowerCase();
  let score = 0;
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 40;
  if (title.includes(q)) score += 20;        // full-query substring in the title
  else if (hay.includes(q)) score += 8;      // full-query substring elsewhere
  for (const tok of q.split(/\s+/).filter(Boolean)) {
    if (title.includes(tok)) score += 5;     // each query word in the title
    else if (hay.includes(tok)) score += 2;  // …or anywhere
  }
  return score;
}

export function rankTasks<T>(items: T[], query: string, get: (i: T) => Searchable): T[] {
  if (!query.trim()) return items;
  return items
    .map((i, idx) => ({ i, idx, s: scoreMatch(get(i), query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.idx - b.idx) // score desc, stable on ties
    .map((x) => x.i);
}
```
This ranks exact > prefix > substring > token matches, handles multi-word queries, and matches on notes
or the stage name too — without fuzzy/typo logic or any LLM.

## B. Data

Add `description` to the Today item's task DTO so search can match notes:
- `src/server/dto.ts`: `TodayItemDto.task` gains `description: string`; the `todayDto` item push adds
  `description: task.description`.
- `src/web/api.ts`: the `TodayItem.task` type gains `description: string`.
No other backend change — search is entirely client-side.

## C. UI (`src/web/components/Today.tsx`, `src/web/styles.css`)

- A `query` state and a `🔍 search tasks…` input rendered just below the execution-flow narrative.
- `const allItems = data.lanes.flatMap((l) => l.items);`
- `const results = rankTasks(allItems, query, (it) => ({ title: it.task.title, stageName: it.stage.name, type: it.task.type, description: it.task.description }));`
- **query non-empty** → render the results as a flat list, reusing the existing **`Item`** card (so
  start/done/rename/due/open-detail all still work), preceded by a `N match(es)` count; "no matching
  tasks." when empty.
- **query empty** → the normal `.lanes` view (unchanged).
- The input has an `✕` to clear (or just clearing the text). No debounce needed (instant client-side).

## D. Testing

- `src/util/taskSearch.test.ts` — `scoreMatch`/`rankTasks`: exact > prefix > substring; multi-token; a
  match only in the stage name / notes still ranks (low, >0); non-matches score 0 and are excluded;
  `rankTasks` returns most-relevant first and all items when the query is blank.

## Cross-cutting

- No new dependencies; no schema change.
- **Docs:** `## [0.1.29]` CHANGELOG entry. **Release** v0.1.29 + local refresh.

## Rejected alternatives

- **LLM/semantic search** — rejected per the request ("might not need an LLM"); a deterministic scorer is
  instant, offline, and good enough for finding tasks by keyword.
- **Filter within lanes** — rejected; the user chose a flat global ranked list for "most relevant".
- **Fuzzy/typo matching (Levenshtein/subsequence)** — deferred (YAGNI); substring + token ranking covers
  the common cases.

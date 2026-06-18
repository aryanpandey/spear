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

// Group tasks into lanes by title similarity, and rank a task's phase
// (design → implementation → testing) for ordering within a lane.

const STOP = new Set(
  "the for to to a an and with based by from see how use using better its into via at as or new all of on in".split(/\s+/),
);
// Phase / action words shouldn't drive *grouping* (they drive within-lane order).
const PHASE_WORDS = new Set(
  "design designs spec plan plans planning ideate implementation implement testing test development dev build builds review validate validation breakdown eval evaluation evaluate monitoring add adding".split(
    /\s+/,
  ),
);

export function titleTokens(title: string): string[] {
  return [
    ...new Set(
      (title || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOP.has(w) && !PHASE_WORDS.has(w)),
    ),
  ];
}

/**
 * Greedy clustering by shared *distinctive* title tokens (shared by ≥2 tasks but
 * not ubiquitous), then capped to at most `maxLanes` lanes. Items with no
 * distinctive tokens (e.g. empty titles) become singletons — so callers that
 * don't supply titles get one lane per task, unchanged.
 *
 * Input order should be importance order (priority first): the earliest themes
 * become the kept "anchor" lanes; once the cap is hit, later/lower-priority
 * themes are folded into the most related anchor (or the smallest, to balance).
 * Returns groups of ids preserving input order.
 */
export function clusterByTitle(items: { id: number; title: string }[], maxLanes = 8): number[][] {
  const docs = items.map((it) => ({ id: it.id, toks: titleTokens(it.title) }));
  const df: Record<string, number> = {};
  for (const d of docs) for (const w of d.toks) df[w] = (df[w] || 0) + 1;
  const n = docs.length;
  // Cluster on tokens shared by ≥2 tasks but not present in the majority of
  // titles (those are glue words, not a theme).
  const maxDf = Math.max(2, Math.floor(n * 0.6));
  const distinctive = (toks: string[]) => toks.filter((w) => df[w] >= 2 && df[w] <= maxDf);

  const clusters: { ids: number[]; tokens: Set<string> }[] = [];
  for (const d of docs) {
    const dt = distinctive(d.toks);
    let best = -1;
    let bestShared = 0;
    clusters.forEach((c, ci) => {
      const shared = dt.filter((w) => c.tokens.has(w)).length;
      if (shared > bestShared) {
        bestShared = shared;
        best = ci;
      }
    });
    if (best >= 0 && bestShared >= 1) {
      clusters[best].ids.push(d.id);
      dt.forEach((w) => clusters[best].tokens.add(w));
    } else {
      clusters.push({ ids: [d.id], tokens: new Set(dt) });
    }
  }

  return capLanes(clusters, maxLanes).map((c) => c.ids);
}

/** Fold clusters beyond the cap into the most-related (else smallest) kept lane. */
function capLanes(
  clusters: { ids: number[]; tokens: Set<string> }[],
  maxLanes: number,
): { ids: number[]; tokens: Set<string> }[] {
  if (maxLanes <= 0 || clusters.length <= maxLanes) return clusters;

  const anchors = clusters.slice(0, maxLanes);
  for (const leftover of clusters.slice(maxLanes)) {
    let best = -1;
    let bestShared = -1;
    anchors.forEach((a, ai) => {
      const shared = [...leftover.tokens].filter((t) => a.tokens.has(t)).length;
      if (shared > bestShared) {
        bestShared = shared;
        best = ai;
      }
    });
    if (bestShared <= 0) {
      // No thematic overlap → balance by folding into the smallest anchor.
      best = anchors.reduce((mi, a, ai) => (a.ids.length < anchors[mi].ids.length ? ai : mi), 0);
    }
    anchors[best].ids.push(...leftover.ids);
    leftover.tokens.forEach((t) => anchors[best].tokens.add(t));
  }
  return anchors;
}

/** design/planning = 0, implementation = 1, testing/stage_testing = 2. */
export function titlePhaseRank(title: string): number {
  const t = (title || "").toLowerCase();
  if (/\b(design|spec|plan|ideate|architect)/.test(t)) return 0;
  if (/\b(test|eval|validat|review|monitor|metric|visibility|qa|verbatim)/.test(t)) return 2;
  return 1;
}

export function phaseRank(title: string, firstStageKind?: string): number {
  if (firstStageKind === "planning") return 0;
  if (firstStageKind === "implementation") return 1;
  if (firstStageKind === "testing" || firstStageKind === "stage_testing") return 2;
  return titlePhaseRank(title); // generic/unknown → infer from the title
}

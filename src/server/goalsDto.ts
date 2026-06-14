import type { Store } from "../db/store.js";
import type { Goal, ScorecardBonus, ScorecardMetric } from "../types.js";

export interface ScorecardMetricDto extends ScorecardMetric {
  /** Score earned = weight × min(progress/goal, 1). */
  earned: number;
  /** Completion percentage = progress/goal × 100 (can exceed 100). */
  pct: number;
}

export interface ScorecardTotals {
  earned: number;
  weight: number;
  pct: number;
}

export interface ScorecardDto {
  id: number;
  title: string;
  week_of: string | null;
  bonus_reward: string;
  is_current: boolean;
  metrics: ScorecardMetricDto[];
  bonuses: ScorecardBonus[];
  totals: ScorecardTotals;
}

export interface ScorecardSummary {
  id: number;
  title: string;
  week_of: string | null;
  is_current: boolean;
}

export interface GoalsPageDto {
  goals: Goal[];
  scorecard: ScorecardDto | null;
  scorecards: ScorecardSummary[];
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Pure scoring for one metric row. */
export function scoreMetric(m: Pick<ScorecardMetric, "progress" | "goal" | "weight">): {
  earned: number;
  pct: number;
} {
  const ratio = m.goal > 0 ? m.progress / m.goal : 0;
  return { earned: m.weight * clamp01(ratio), pct: ratio * 100 };
}

export function scorecardDto(store: Store, id: number): ScorecardDto | null {
  const card = store.getScorecard(id);
  if (!card) return null;
  const metrics: ScorecardMetricDto[] = store.listMetrics(id).map((m) => ({ ...m, ...scoreMetric(m) }));
  const bonuses = store.listBonuses(id);
  const earned = metrics.reduce((s, m) => s + m.earned, 0);
  const weight = metrics.reduce((s, m) => s + m.weight, 0);
  return {
    id: card.id,
    title: card.title,
    week_of: card.week_of,
    bonus_reward: card.bonus_reward,
    is_current: card.is_current,
    metrics,
    bonuses,
    totals: { earned, weight, pct: weight > 0 ? (earned / weight) * 100 : 0 },
  };
}

/** Everything the Goals tab needs in one payload. */
export function goalsPageDto(store: Store): GoalsPageDto {
  const current = store.getCurrentScorecard();
  return {
    goals: store.listGoals(),
    scorecard: current ? scorecardDto(store, current.id) : null,
    scorecards: store
      .listScorecards()
      .map((c) => ({ id: c.id, title: c.title, week_of: c.week_of, is_current: c.is_current })),
  };
}

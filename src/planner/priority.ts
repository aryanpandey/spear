import { PRIORITY_RANK, type Priority } from "../types.js";
import { dueBand } from "../util/time.js";

const RANK_TO_PRIORITY: Priority[] = ["critical", "high", "medium", "low"]; // index === rank

const CRITICAL_RE = /\b(prod|production|down|outage|broken|urgent|asap|p0|blocker|security|breach|hotfix|critical|sev[012])\b/i;
const HIGH_RE = /\b(fix|bug|regression|failing|fails|error|p1|important|customer|incident)\b/i;

export interface PriorityInferInput {
  title: string;
  due?: string | null;
  /** Other open tasks depend on this one. */
  blocksOthers?: boolean;
  now?: Date;
}

export interface PriorityInferResult {
  priority: Priority;
  reason: string;
}

// Raise priority one tier, but never above HIGH and never below the current
// tier. CRITICAL is reserved for emergency wording / explicit user intent — a
// due date or a blocking relationship must not manufacture it, because CRITICAL
// now means "drop everything and supersede in-progress work".
const bump = (rank: number): number =>
  Math.min(rank, Math.max(PRIORITY_RANK.high, rank - 1));

/**
 * Heuristic priority for zero-decision capture. Starts at medium, then:
 * urgent wording sets a tier, a due date applies a floor (overdue/today→high,
 * soon→bump), and blocking others bumps one level. Floors only ever raise
 * priority, and only emergency wording reaches CRITICAL. Pure (pass `now`).
 */
export function inferPriority(input: PriorityInferInput): PriorityInferResult {
  const reasons: string[] = [];
  let rank = PRIORITY_RANK.medium;

  const t = input.title.toLowerCase();
  if (CRITICAL_RE.test(t)) {
    rank = Math.min(rank, PRIORITY_RANK.critical);
    reasons.push("urgent wording");
  } else if (HIGH_RE.test(t)) {
    rank = Math.min(rank, PRIORITY_RANK.high);
    reasons.push("looks like a fix/bug");
  }

  switch (dueBand(input.due, input.now ?? new Date())) {
    case "overdue":
      rank = Math.min(rank, PRIORITY_RANK.high);
      reasons.push("overdue");
      break;
    case "today":
      rank = Math.min(rank, PRIORITY_RANK.high);
      reasons.push("due today");
      break;
    case "soon":
      rank = bump(rank);
      reasons.push("due soon");
      break;
    default:
      break;
  }

  if (input.blocksOthers) {
    rank = bump(rank);
    reasons.push("blocks other tasks");
  }

  return { priority: RANK_TO_PRIORITY[rank], reason: reasons.length ? reasons.join("; ") : "default" };
}

import type { Priority, TaskType } from "../types.js";
import { genericStage, standardFeatureStages, type StageSpec } from "./standard.js";
import { inferPriority } from "../planner/priority.js";

export interface BreakdownRequest {
  title: string;
  description?: string;
  /** When set, classification is skipped and this type is used. */
  forcedType?: TaskType;
  useLlm: boolean;
  model: string;
  effort: "low" | "medium" | "high" | "max";
  /** Due date (for priority inference). */
  due?: string | null;
  /** If the user passed --priority, it wins over any inference. */
  explicitPriority?: Priority;
}

export interface BreakdownResult {
  title: string;
  type: TaskType;
  stages: StageSpec[];
  source: "llm" | "deterministic";
  /** Priority the LLM suggested (only set on the LLM path). */
  suggestedPriority?: Priority;
}

export interface ResolvedBreakdown extends BreakdownResult {
  /** Final priority to use for the task. */
  priority: Priority;
  /** Why this priority was chosen (for transparency). */
  priorityReason: string;
}

/** Deterministic fallback: features → 4 stages, everything else → one generic stage. */
export function deterministicBreakdown(title: string, type: TaskType): BreakdownResult {
  const stages = type === "feature" ? standardFeatureStages() : genericStage(title);
  return { title, type, stages, source: "deterministic" };
}

/** Resolve a task into {type, stages, priority}. Priority: explicit > LLM > heuristic. */
export async function breakdownForAdd(req: BreakdownRequest): Promise<ResolvedBreakdown> {
  let base: BreakdownResult;

  if (req.forcedType) {
    base = deterministicBreakdown(req.title, req.forcedType);
  } else {
    base = deterministicBreakdown(req.title, "other");
    if (req.useLlm) {
      try {
        const { llmBreakdown } = await import("../llm/breakdown.js");
        const llm = await llmBreakdown(req);
        if (llm) base = llm;
      } catch (err) {
        process.stderr.write(
          `spear: LLM breakdown failed (${err instanceof Error ? err.message : String(err)}); using deterministic breakdown.\n`,
        );
      }
    }
  }

  // Priority: explicit wins; else the LLM's suggestion; else the heuristic.
  if (req.explicitPriority) {
    return { ...base, priority: req.explicitPriority, priorityReason: "set explicitly" };
  }
  if (base.suggestedPriority) {
    return { ...base, priority: base.suggestedPriority, priorityReason: "LLM-inferred" };
  }
  const inferred = inferPriority({ title: base.title, due: req.due ?? null });
  return { ...base, priority: inferred.priority, priorityReason: inferred.reason };
}

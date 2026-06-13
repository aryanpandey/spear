import type { TaskType } from "../types.js";
import { genericStage, standardFeatureStages, type StageSpec } from "./standard.js";

export interface BreakdownRequest {
  title: string;
  description?: string;
  /** When set, classification is skipped and this type is used. */
  forcedType?: TaskType;
  useLlm: boolean;
  model: string;
  effort: "low" | "medium" | "high" | "max";
}

export interface BreakdownResult {
  title: string;
  type: TaskType;
  stages: StageSpec[];
  source: "llm" | "deterministic";
}

/** Deterministic fallback: features → 4 stages, everything else → one generic stage. */
export function deterministicBreakdown(title: string, type: TaskType): BreakdownResult {
  const stages = type === "feature" ? standardFeatureStages() : genericStage(title);
  return { title, type, stages, source: "deterministic" };
}

/**
 * Resolve a task into {type, stages}. The LLM path is wired in M4 via
 * `llmBreakdown`; until then (or with --no-llm / a forced type / no API key)
 * this returns the deterministic breakdown.
 */
export async function breakdownForAdd(req: BreakdownRequest): Promise<BreakdownResult> {
  if (req.forcedType) return deterministicBreakdown(req.title, req.forcedType);

  if (req.useLlm) {
    try {
      const { llmBreakdown } = await import("../llm/breakdown.js");
      const llm = await llmBreakdown(req);
      if (llm) return llm;
    } catch (err) {
      process.stderr.write(
        `spear: LLM breakdown failed (${err instanceof Error ? err.message : String(err)}); using deterministic breakdown.\n`,
      );
    }
  }
  // No type and no LLM (or no API key) → capture as 'other' with a single stage.
  return deterministicBreakdown(req.title, "other");
}

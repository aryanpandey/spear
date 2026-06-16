import type { Priority, TaskType } from "../types.js";
import type { StageSpec } from "./standard.js";
import type { ClaudeRunner } from "../llm/cli.js";

export interface BreakdownRequest {
  title: string;
  description?: string;
  /** When set, the LLM uses this type instead of classifying. */
  forcedType?: TaskType;
  /** Explicit capture intent: 'feature' forces the full feature flow, 'task' forces a lean non-feature. */
  intent?: "task" | "feature";
  model: string;
  effort: "low" | "medium" | "high" | "max";
  due?: string | null;
  /** If the user passed --priority, it wins over the LLM's suggestion. */
  explicitPriority?: Priority;
}

export interface BreakdownResult {
  title: string;
  type: TaskType;
  stages: StageSpec[];
  /** Priority the LLM suggested. */
  suggestedPriority?: Priority;
}

export interface ResolvedBreakdown extends BreakdownResult {
  priority: Priority;
  priorityReason: string;
}

/**
 * Resolve a task into {type, stages, priority} via the Claude CLI. There is no
 * deterministic fallback — if the CLI is unavailable or returns bad JSON, this
 * throws. Priority: explicit (user) > LLM suggestion > medium.
 */
export async function breakdownForAdd(req: BreakdownRequest, run?: ClaudeRunner): Promise<ResolvedBreakdown> {
  const { llmBreakdown } = await import("../llm/breakdown.js");
  const base = await llmBreakdown(req, run);
  const priority = req.explicitPriority ?? base.suggestedPriority ?? "medium";
  const priorityReason = req.explicitPriority ? "set explicitly" : base.suggestedPriority ? "LLM-inferred" : "default";
  return { ...base, priority, priorityReason };
}

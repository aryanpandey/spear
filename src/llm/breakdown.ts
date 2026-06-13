import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, type ParseClient } from "./client.js";
import { BreakdownSchema, type BreakdownOutput } from "./schemas.js";
import type { BreakdownRequest, BreakdownResult } from "../breakdown/index.js";
import { standardFeatureStages, type StageSpec } from "../breakdown/standard.js";
import type { ExecutorKind, StageKind } from "../types.js";

const SYSTEM = `You break a software founder's task description into a structured plan for a local task tracker.

Rules:
- Classify "type" as one of: feature, bug, chore, research, other.
- If type is "feature": produce EXACTLY four sequential stages — "Planning", "Implementation", "Testing", "Stage Testing" — with kinds planning, implementation, testing, stage_testing in that order.
- Otherwise: break the work into the smallest sensible set of sequential stages (often just one). Use kind "generic" unless a stage is clearly planning/implementation/testing/stage_testing. Don't add ceremony a small task doesn't need.
- For every stage, set "delegatable_to": the executor kinds that could own it. Always include "self". Add "ai_agent" for work a coding/AI agent could do (implementation, research, drafting, writing tests), "ci" for automated test/build/deploy runs, "teammate" for human review or QA.
- Estimate "effort" per stage and for the task overall: small, medium, or large.
- Suggest a "priority" (critical/high/medium/low) from the task's urgency and impact.
- Return a concise, cleaned "title".`;

function userPrompt(req: BreakdownRequest): string {
  let s = `Task: ${req.title}`;
  if (req.description) s += `\nDetails: ${req.description}`;
  return s;
}

const FEATURE_KINDS: StageKind[] = ["planning", "implementation", "testing", "stage_testing"];

function isStandardFeatureShape(stages: StageSpec[]): boolean {
  return stages.length === 4 && stages.every((s, i) => s.kind === FEATURE_KINDS[i]);
}

function ensureSelf(kinds: ExecutorKind[]): ExecutorKind[] {
  return kinds.includes("self") ? kinds : ["self", ...kinds];
}

function normalize(parsed: BreakdownOutput, req: BreakdownRequest): BreakdownResult {
  let stages: StageSpec[] = parsed.stages.map((s) => ({
    name: s.name,
    kind: s.kind,
    effort: s.effort,
    delegatable_to: ensureSelf(s.delegatable_to),
  }));

  if (parsed.type === "feature" && !isStandardFeatureShape(stages)) {
    stages = standardFeatureStages();
  }
  if (stages.length === 0) {
    stages = [{ name: parsed.title || req.title, kind: "generic", effort: parsed.effort, delegatable_to: ["self"] }];
  }
  return {
    title: parsed.title || req.title,
    type: parsed.type,
    stages,
    source: "llm",
    suggestedPriority: parsed.priority,
  };
}

/** Run the LLM breakdown. Returns null when no API key / client is available. */
export async function llmBreakdown(
  req: BreakdownRequest,
  client?: ParseClient,
): Promise<BreakdownResult | null> {
  const c = client ?? (getAnthropic() as unknown as ParseClient | null);
  if (!c) return null;

  const res = await c.messages.parse({
    model: req.model,
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { effort: req.effort, format: zodOutputFormat(BreakdownSchema) },
    messages: [{ role: "user", content: userPrompt(req) }],
  });

  const parsed = res.parsed_output as BreakdownOutput | null;
  if (!parsed) return null;
  return normalize(parsed, req);
}

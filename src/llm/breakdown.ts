import { claudeJson, claudeStructured, type ClaudeRunner } from "./cli.js";
import { BreakdownSchema, type BreakdownOutput } from "./schemas.js";
import type { BreakdownRequest, BreakdownResult } from "../breakdown/index.js";
import type { StageSpec } from "../breakdown/standard.js";
import type { ExecutorKind } from "../types.js";

const SYSTEM = `You break a software founder's task description into a structured plan for a local task tracker.

Rules:
- Classify "type" as one of: feature, bug, chore, research, other.
- Break the work into the smallest sensible set of sequential stages (often just one). Use kind "generic" unless a stage is clearly planning/implementation/testing/stage_testing. For a sizable feature a Planning → Implementation → Testing → Stage Testing flow is typical, but don't add ceremony a small task doesn't need.
- For every stage set "delegatable_to": the executor kinds that could own it. Always include "self". Add "ai_agent" for work a coding/AI agent could do, "ci" for automated test/build/deploy runs, "teammate" for human review or QA.
- Estimate "effort" per stage and overall: small, medium, or large.
- Suggest a "priority" (critical/high/medium/low). Reserve "critical" for genuine drop-everything emergencies (production outage, security incident, a hard external deadline already missed): a critical task supersedes all in-progress work and must be addressed immediately. Use "high" for important or urgent-but-not-emergency work, and default to "medium". A due date alone is NOT enough to make something critical.
- Return a concise, cleaned "title".`;

const SHAPE = `Output ONLY a JSON object (no prose, no markdown fences) of exactly this shape:
{"title": string, "type": "feature"|"bug"|"chore"|"research"|"other", "priority": "critical"|"high"|"medium"|"low", "effort": "small"|"medium"|"large", "stages": [{"name": string, "kind": "planning"|"implementation"|"testing"|"stage_testing"|"generic", "effort": "small"|"medium"|"large", "delegatable_to": ("self"|"ai_agent"|"teammate"|"ci")[]}]}`;

function buildPrompt(req: BreakdownRequest): string {
  let s = `${SYSTEM}\n\n${SHAPE}\n\nTask: ${req.title}`;
  if (req.description) s += `\nDetails: ${req.description}`;
  if (req.forcedType) s += `\nThe task type is "${req.forcedType}" — use it.`;
  return s;
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
  if (stages.length === 0) {
    stages = [{ name: parsed.title || req.title, kind: "generic", effort: parsed.effort, delegatable_to: ["self"] }];
  }
  return {
    title: parsed.title || req.title,
    type: req.forcedType ?? parsed.type,
    stages,
    suggestedPriority: parsed.priority,
  };
}

/** Break a task down via the Claude CLI. Throws if the CLI is unavailable or returns bad JSON. */
export async function llmBreakdown(req: BreakdownRequest, run: ClaudeRunner = claudeJson): Promise<BreakdownResult> {
  const parsed = await claudeStructured(buildPrompt(req), (x) => BreakdownSchema.parse(x), { model: req.model, effort: req.effort }, run);
  return normalize(parsed, req);
}

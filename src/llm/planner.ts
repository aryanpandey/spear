import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, type ParseClient } from "./client.js";
import { PlanSchema, type PlanOutput } from "./schemas.js";
import type { PlanContext } from "../planner/context.js";
import type { PlanItemInput } from "../db/store.js";
import type { ScheduledState } from "../types.js";

function systemPrompt(maxLanes: number): string {
  return `You are the daily execution planner for a solo software founder's task tracker.

You receive the open work as "flows" (each flow = one task with its remaining sequential stages), the roster of "executors", and a dependency-aware readiness signal per flow (ready + criticalPath + openBlockers).

GROUP flows into AT MOST ${maxLanes} lanes — do NOT create one lane per task; a long list of single-task lanes is useless. Group by TASK-NAME / THEME similarity: tasks that share a subject belong in the same lane (e.g. every "Collection Brain …" task shares one lane; all WhatsApp-agent tasks share one). If there are more themes than ${maxLanes}, fold the lower-priority / smaller themes into the most related existing lane and place them at the right position within it by priority. Never exceed ${maxLanes} lanes.

ORDER WITHIN EACH LANE strictly by phase: design / planning first, then implementation, then testing / stage-testing. Design takes priority over implementation; implementation takes priority over testing. Infer a task's phase from its stage kinds and its title (e.g. "… Design" = design, "… Implementation/Development" = implementation, "… Testing/Eval/Validate/Review" = testing).

Then get the founder through the day with the SHORTEST personal critical path:
- Order lanes so the highest-priority / longest-critical-path theme comes first.
- Assign each lane to an executor. Offload to a non-"self" executor whenever a stage's delegatable_to allows it, so the founder (the executor whose kind is "self") is not the bottleneck. If "self" is the only executor, still set is_delegation_candidate=true on any stage that COULD be handed to an ai_agent / teammate / ci — surface what is delegatable.
- scheduled_state: "start_now" for the lane's current head step the founder should pick up now; "background" for delegatable long-running work (tests/CI, agent-driven implementation, builds) to kick off early and let run unattended; "waiting" for a step blocked by an earlier step in its lane or an unfinished dependency.
- Respect dependencies (never start a flow whose openBlockers is non-empty) and priority.

Use the exact task_id and stage_id values from the input. Include the next actionable stage of every ready flow, placed in its lane. Keep "narrative" to 2-4 sentences of concrete "here's how to tackle the day" guidance.`;
}

function lanesToItems(plan: PlanOutput, validStageIds: Set<number>): PlanItemInput[] {
  const items: PlanItemInput[] = [];
  for (const lane of plan.lanes) {
    for (const it of lane.items) {
      if (!validStageIds.has(it.stage_id)) continue;
      items.push({
        task_id: it.task_id,
        stage_id: it.stage_id,
        lane: lane.lane,
        order_in_lane: it.order,
        executor_id: lane.executor_id ?? null,
        is_delegation_candidate: it.is_delegation_candidate,
        scheduled_state: it.scheduled_state as ScheduledState,
        rationale: it.rationale,
      });
    }
  }
  return items;
}

export interface LlmPlanResult {
  items: PlanItemInput[];
  narrative: string;
}

/** Ask the LLM to lay out the day. Returns null when no client / no valid items. */
export async function llmPlan(
  context: PlanContext,
  opts: { model: string; effort: "low" | "medium" | "high" | "max"; maxLanes?: number },
  client?: ParseClient,
  validStageIds: Set<number> = new Set(),
): Promise<LlmPlanResult | null> {
  const c = client ?? (getAnthropic() as unknown as ParseClient | null);
  if (!c) return null;

  const res = await c.messages.parse({
    model: opts.model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: systemPrompt(opts.maxLanes ?? 8),
    output_config: { effort: opts.effort, format: zodOutputFormat(PlanSchema) },
    messages: [{ role: "user", content: JSON.stringify(context) }],
  });

  const parsed = res.parsed_output as PlanOutput | null;
  if (!parsed) return null;
  const items = lanesToItems(parsed, validStageIds);
  if (items.length === 0) return null;
  return { items, narrative: parsed.narrative };
}

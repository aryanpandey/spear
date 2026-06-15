import { claudeJson, claudeStructured, type ClaudeRunner } from "./cli.js";
import { PlanSchema, type PlanOutput } from "./schemas.js";
import type { PlanContext } from "../planner/context.js";
import type { PlanItemInput } from "../db/store.js";
import type { ScheduledState } from "../types.js";

function systemPrompt(maxLanes: number): string {
  return `You are the daily execution planner for a solo software founder's task tracker.

You receive the open work as "flows" and the roster of "executors". Each flow has: taskId, title, priority, status, due, openBlockers (task ids still blocking it), and its remaining sequential stages.

GROUP flows into AT MOST ${maxLanes} lanes — do NOT create one lane per task; a long list of single-task lanes is useless. Group by TASK-NAME / THEME similarity: tasks that share a subject belong in the same lane (e.g. every "Collection Brain …" task shares one lane). If there are more themes than ${maxLanes}, fold the lower-priority / smaller themes into the most related existing lane. Never exceed ${maxLanes} lanes.

ORDER WITHIN EACH LANE strictly by phase: design / planning first, then implementation, then testing / stage-testing. Design takes priority over implementation; implementation takes priority over testing.

CRITICAL OVERRIDE: a flow whose priority is "critical" and that is ready (no open blockers) is a drop-everything task. Place it at the HEAD of its lane — ahead of phase order and ahead of any overdue or in-progress flow in that lane — and set its next step's scheduled_state to "start_now", superseding whatever was previously current there. A critical flow that is still blocked stays "waiting".

Then get the founder through the day with the SHORTEST personal critical path:
- Order lanes so the highest-priority / most urgent theme comes first.
- Assign each lane to an executor. Offload to a non-"self" executor whenever a stage's delegatable_to allows it, so the founder (the "self" executor) is not the bottleneck. If "self" is the only executor, still set is_delegation_candidate=true on any stage that COULD be handed to an ai_agent / teammate / ci.
- scheduled_state: "start_now" for the lane's current head step to pick up now; "background" for delegatable long-running work (tests/CI, agent-driven implementation, builds); "waiting" for a step blocked by an earlier step in its lane or an unfinished dependency.
- Respect dependencies: never set start_now on a flow whose openBlockers is non-empty. Honor priority and due dates — overdue / due-today work is more urgent.

Use the exact task_id and stage_id values from the input. Include the next actionable stage of every ready flow, placed in its lane. Keep "narrative" to 2-4 sentences of concrete "here's how to tackle the day" guidance.`;
}

const SHAPE = `Output ONLY a JSON object (no prose, no markdown fences) of exactly this shape:
{"narrative": string, "lanes": [{"lane": integer (0-based), "executor_id": integer or null, "items": [{"task_id": integer, "stage_id": integer, "order": integer (0-based in lane), "is_delegation_candidate": boolean, "scheduled_state": "start_now"|"background"|"waiting", "rationale": string}]}]}`;

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

/**
 * Plan the day via the Claude CLI. Returns null when the model produced no valid
 * items (after filtering to real, open stage ids). Throws if the CLI fails.
 */
export async function llmPlan(
  context: PlanContext,
  opts: { model: string; maxLanes?: number },
  validStageIds: Set<number> = new Set(),
  run: ClaudeRunner = claudeJson,
): Promise<LlmPlanResult | null> {
  const prompt = `${systemPrompt(opts.maxLanes ?? 8)}\n\n${SHAPE}\n\nPlan this board (use its exact task_id / stage_id values):\n${JSON.stringify(context)}`;
  const parsed = await claudeStructured(prompt, (x) => PlanSchema.parse(x), { model: opts.model }, run);
  const items = lanesToItems(parsed, validStageIds);
  if (items.length === 0) return null;
  return { items, narrative: parsed.narrative };
}

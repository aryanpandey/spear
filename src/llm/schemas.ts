import { z } from "zod/v4";

export const StageSchema = z.object({
  name: z.string().describe("Short stage name"),
  kind: z.enum(["planning", "implementation", "testing", "stage_testing", "generic"]),
  effort: z.enum(["small", "medium", "large"]),
  delegatable_to: z
    .array(z.enum(["self", "ai_agent", "teammate", "ci"]))
    .describe("Executor kinds that could own this stage; always include 'self'."),
});

export const BreakdownSchema = z.object({
  title: z.string().describe("Cleaned, concise task title"),
  type: z.enum(["feature", "bug", "chore", "research", "other"]),
  effort: z.enum(["small", "medium", "large"]).describe("Overall task effort"),
  stages: z.array(StageSchema),
});
export type BreakdownOutput = z.infer<typeof BreakdownSchema>;

// ---- Planner (used in M5) ----

export const PlanItemSchema = z.object({
  task_id: z.number().int(),
  stage_id: z.number().int(),
  order: z.number().int().describe("Order of this item within its lane (0-based)"),
  is_delegation_candidate: z.boolean(),
  scheduled_state: z.enum(["start_now", "background", "waiting"]),
  rationale: z.string().describe("One short clause on why it's placed here"),
});

export const PlanLaneSchema = z.object({
  lane: z.number().int().describe("Parallel lane index (0-based)"),
  executor_id: z.number().int().nullable().describe("Executor assigned to this lane, or null"),
  items: z.array(PlanItemSchema),
});

export const PlanSchema = z.object({
  narrative: z.string().describe("A short 'how to tackle the day' summary"),
  lanes: z.array(PlanLaneSchema),
});
export type PlanOutput = z.infer<typeof PlanSchema>;

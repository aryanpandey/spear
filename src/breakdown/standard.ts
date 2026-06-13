import type { Effort, ExecutorKind, StageKind } from "../types.js";

export interface StageSpec {
  name: string;
  kind: StageKind;
  effort?: Effort | null;
  /** Executor kinds this stage could be handed to (drives delegation flagging). */
  delegatable_to?: ExecutorKind[];
}

/**
 * The fixed 4-stage flow every feature gets. Sequential. The `delegatable_to`
 * defaults encode what each stage *could* be offloaded to, so the planner can
 * flag delegation candidates even while "Me" is the only configured executor.
 */
export function standardFeatureStages(): StageSpec[] {
  return [
    { name: "Planning", kind: "planning", effort: "small", delegatable_to: ["self", "ai_agent"] },
    { name: "Implementation", kind: "implementation", effort: "large", delegatable_to: ["self", "ai_agent", "teammate"] },
    { name: "Testing", kind: "testing", effort: "medium", delegatable_to: ["self", "ai_agent", "ci"] },
    { name: "Stage Testing", kind: "stage_testing", effort: "small", delegatable_to: ["self", "teammate"] },
  ];
}

/** A single generic stage for a non-feature task captured without the LLM. */
export function genericStage(title: string): StageSpec[] {
  return [{ name: title, kind: "generic", effort: "medium", delegatable_to: ["self"] }];
}

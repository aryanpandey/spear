import type { Effort, ExecutorKind, StageKind } from "../types.js";

export interface StageSpec {
  name: string;
  kind: StageKind;
  effort?: Effort | null;
  /** Executor kinds this stage could be handed to (drives delegation flagging). */
  delegatable_to?: ExecutorKind[];
}

/** A single generic stage, used when a breakdown doesn't supply its own stages. */
export function genericStage(title: string): StageSpec[] {
  return [{ name: title, kind: "generic", effort: "medium", delegatable_to: ["self"] }];
}

import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { Priority } from "../types.js";
import { addTask } from "../service.js";
import { breakdownForAdd } from "../breakdown/index.js";
import { extractTaskSeeds, type TaskSeed } from "../llm/intake.js";
import type { ClaudeRunner } from "../llm/cli.js";

export interface IntakeParams {
  prompt: string;
  imagePath?: string;
  intent?: "task" | "feature";
  priority?: Priority;
}

export interface IntakeDeps {
  /** Override the extraction step (tests). */
  extract?: (prompt: string, imagePath: string | undefined, opts: { model: string; effort: "low" }) => Promise<TaskSeed[]>;
  /** Runner for the per-seed breakdown (tests). */
  breakdownRun?: ClaudeRunner;
}

/** image/* mime → file extension for the temp file the model reads. */
export function mimeExt(mime?: string): string {
  switch (mime) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

/** Extraction half: prompt (+ optional image) → task seeds. */
export async function extractSeedsForIntake(
  cfg: SpearConfig,
  params: IntakeParams,
  deps: IntakeDeps = {},
): Promise<TaskSeed[]> {
  const extract =
    deps.extract ??
    ((prompt: string, imagePath: string | undefined) =>
      extractTaskSeeds(prompt, imagePath, { model: cfg.models.breakdown, effort: "low" }));
  return extract(params.prompt, params.imagePath, { model: cfg.models.breakdown, effort: "low" });
}

/**
 * Create half: break each seed down in parallel and insert it. Per-seed failures
 * are skipped (the rest still land). Returns the ids created. Does NOT re-plan —
 * the caller decides when to trigger that.
 */
export async function createTasksFromSeeds(
  store: Store,
  cfg: SpearConfig,
  seeds: TaskSeed[],
  params: { intent?: "task" | "feature"; priority?: Priority },
  deps: IntakeDeps = {},
): Promise<{ taskIds: number[] }> {
  const settled = await Promise.allSettled(
    seeds.map(async (seed) => {
      const broken = await breakdownForAdd(
        {
          title: seed.title,
          description: seed.details,
          intent: params.intent,
          model: cfg.models.breakdown,
          effort: cfg.effort.breakdown,
          explicitPriority: params.priority,
        },
        deps.breakdownRun,
      );
      return addTask(store, {
        title: broken.title,
        description: seed.details,
        type: broken.type,
        priority: broken.priority,
        stages: broken.stages,
        source: "web",
      }).task.id;
    }),
  );

  const taskIds = settled.filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled").map((r) => r.value);
  return { taskIds };
}

/** Combined intake (extract → create) — unchanged behavior. */
export async function intakeTasks(
  store: Store,
  cfg: SpearConfig,
  params: IntakeParams,
  deps: IntakeDeps = {},
): Promise<{ taskIds: number[] }> {
  const seeds = await extractSeedsForIntake(cfg, params, deps);
  return createTasksFromSeeds(store, cfg, seeds, params, deps);
}

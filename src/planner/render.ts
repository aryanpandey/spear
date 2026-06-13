import type { Store } from "../db/store.js";
import type { DailyPlan } from "../types.js";
import { c, scheduledBadge } from "../util/render.js";

/** Render a persisted plan as a Matrix-flavored terminal view. */
export function renderPlan(store: Store, plan: DailyPlan): string {
  const items = store.getPlanItems(plan.id);
  const execName = new Map(store.listExecutors().map((e) => [e.id, e.name]));
  const lines: string[] = [];

  const tag = plan.model ? "llm" : "deterministic";
  lines.push(c.brightGreen(`░ EXECUTION FLOW — ${plan.plan_date} ${c.dim(`(${plan.trigger} · ${tag})`)}`));
  lines.push(c.green(wrap(plan.narrative, 92)));
  lines.push("");

  if (items.length === 0) {
    lines.push(c.dim("no open work — inbox zero."));
    return lines.join("\n");
  }

  const byLane = new Map<number, typeof items>();
  for (const it of items) {
    if (!byLane.has(it.lane)) byLane.set(it.lane, []);
    byLane.get(it.lane)!.push(it);
  }

  const sortedLanes = [...byLane.keys()].sort((a, b) => a - b);
  sortedLanes.forEach((lane, idx) => {
    const laneItems = byLane.get(lane)!.sort((a, b) => a.order_in_lane - b.order_in_lane);
    const owner = laneItems[0].executor_id ? execName.get(laneItems[0].executor_id) ?? "?" : "unassigned";
    lines.push(c.dim(`lane ${idx + 1} · `) + c.bold(owner));
    for (const it of laneItems) {
      const task = store.getTask(it.task_id);
      const stage = store.getStage(it.stage_id);
      const badge = scheduledBadge(it.scheduled_state);
      const deleg = it.is_delegation_candidate ? c.cyan("  ⇄ delegate") : "";
      const why = it.rationale ? c.dim(`  — ${it.rationale}`) : "";
      lines.push(
        `  ${badge}  ${c.bold(stage?.name ?? `stage#${it.stage_id}`)} ${c.dim(`(#${it.task_id} ${task?.title ?? ""})`)}${deleg}${why}`,
      );
    }
  });
  return lines.join("\n");
}

function wrap(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else {
      line += " " + w;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

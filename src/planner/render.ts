import type { Store } from "../db/store.js";
import { todayDto } from "../server/dto.js";
import { formatMinutes, type TimeOpts } from "./timefit.js";
import type { DueBand } from "../util/time.js";
import { c, scheduledBadge } from "../util/render.js";

function dueBadge(band: DueBand): string {
  if (band === "overdue") return "  " + c.red("⌛ overdue");
  if (band === "today") return "  " + c.yellow("⏰ today");
  return "";
}

/** Render the current plan as a Matrix-flavored terminal view (lanes numbered 1..N). */
export function renderPlan(store: Store, time?: TimeOpts): string {
  const dto = todayDto(store, time);
  const lines: string[] = [];
  if (!dto.plan) return c.dim("no current plan — run `spear plan`.");

  const tag = dto.plan.model ? "llm" : "deterministic";
  lines.push(c.brightGreen(`░ EXECUTION FLOW — ${dto.plan.plan_date} ${c.dim(`(${dto.plan.trigger} · ${tag})`)}`));
  lines.push(c.green(wrap(dto.plan.narrative, 92)));
  if (dto.timeBudget) {
    const b = dto.timeBudget;
    lines.push(
      c.dim(
        `time left ${formatMinutes(b.leftMin)} · planned ${formatMinutes(b.plannedMin)} · ${b.fitsCount} fit / ${b.spillCount} spill`,
      ),
    );
  }
  lines.push("");

  if (dto.lanes.length === 0) {
    lines.push(c.dim("no open work — inbox zero."));
    return lines.join("\n");
  }

  dto.lanes.forEach((lane, idx) => {
    lines.push(c.dim(`lane ${idx + 1} · `) + c.bold(lane.executor?.name ?? "unassigned"));
    for (const it of lane.items) {
      const name = it.fitsToday ? c.bold(it.stage.name) : c.dim(it.stage.name);
      const deleg = it.is_delegation_candidate ? c.cyan("  ⇄ delegate") : "";
      const spill = it.fitsToday ? "" : c.gray("  · spills to tomorrow");
      const why = it.rationale ? c.dim(`  — ${it.rationale}`) : "";
      lines.push(
        `  ${scheduledBadge(it.scheduled_state)}  ${name} ${c.dim(`(#${it.task.id} ${it.task.title})`)}${dueBadge(it.dueBand)}${deleg}${spill}${why}`,
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

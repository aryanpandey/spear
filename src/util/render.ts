import type { Priority, ScheduledState, Stage, Task, TaskStatus } from "../types.js";

const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const code = (n: string) => (s: string) => (enabled ? `\x1b[${n}m${s}\x1b[0m` : s);

export const c = {
  green: code("32"),
  brightGreen: code("92"),
  dim: code("2"),
  bold: code("1"),
  red: code("31"),
  yellow: code("33"),
  orange: code("38;5;208"),
  gray: code("90"),
  cyan: code("36"),
};

export function priorityColor(p: Priority, s: string): string {
  switch (p) {
    case "critical": return c.red(s);
    case "high": return c.orange(s);
    case "medium": return c.green(s);
    case "low": return c.gray(s);
  }
}

export function statusColor(st: TaskStatus | Stage["status"], s: string): string {
  switch (st) {
    case "done": return c.dim(s);
    case "in_progress": return c.brightGreen(s);
    case "blocked": return c.red(s);
    case "backlog": return c.gray(s);
    default: return c.green(s);
  }
}

export function scheduledBadge(state: ScheduledState): string {
  switch (state) {
    case "start_now": return c.brightGreen("▶ now");
    case "background": return c.cyan("⟳ bg");
    case "waiting": return c.gray("… wait");
  }
}

/** Minimal fixed-width table. rows: array of cell arrays; widths auto-computed. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(visibleLen(h), ...rows.map((r) => visibleLen(r[i] ?? ""))),
  );
  const fmtRow = (cells: string[]) =>
    cells.map((cell, i) => pad(cell, widths[i])).join("  ");
  const lines = [c.dim(fmtRow(headers)), c.dim(fmtRow(widths.map((w) => "─".repeat(w))))];
  for (const r of rows) lines.push(fmtRow(r));
  return lines.join("\n");
}

// Account for ANSI escapes when measuring/padding.
const ANSI = /\x1b\[[0-9;]*m/g;
function visibleLen(s: string): number {
  return s.replace(ANSI, "").length;
}
function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleLen(s)));
}

export function taskOneLiner(t: Task, nextStage?: string): string {
  const id = c.dim(`#${t.id}`);
  return `${id} ${priorityColor(t.priority, `[${t.priority}]`)} ${statusColor(t.status, t.status)} ${c.bold(t.title)}${nextStage ? c.dim(`  → ${nextStage}`) : ""}`;
}

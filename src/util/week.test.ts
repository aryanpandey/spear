import { describe, it, expect } from "vitest";
import { buildWeek, type WeekTask } from "./week.js";

const NOW = new Date(2026, 5, 17); // Wed 2026-06-17

function t(
  id: number,
  due: string | null,
  opts: { status?: string; priority?: WeekTask["priority"] } = {},
): WeekTask {
  return { id, due, status: opts.status ?? "todo", priority: opts.priority ?? "medium" };
}

describe("buildWeek", () => {
  it("spans Monday→Sunday of the week containing now", () => {
    const w = buildWeek([], NOW);
    expect(w.weekStart).toBe("2026-06-15");
    expect(w.weekEnd).toBe("2026-06-21");
    expect(w.days).toHaveLength(7);
    expect(w.days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(w.days[0].date).toBe("2026-06-15");
  });

  it("marks only today's column isToday", () => {
    const w = buildWeek([], NOW);
    expect(w.days.filter((d) => d.isToday).map((d) => d.date)).toEqual(["2026-06-17"]);
  });

  it("buckets a task under its due day", () => {
    const w = buildWeek([t(1, "2026-06-18")], NOW);
    expect(w.days[3].weekday).toBe("Thu");
    expect(w.days[3].tasks.map((x) => x.id)).toEqual([1]);
  });

  it("puts still-open past-due tasks in overdue, excluding done", () => {
    const w = buildWeek([t(1, "2026-06-10"), t(2, "2026-06-10", { status: "done" })], NOW);
    expect(w.overdue.map((x) => x.id)).toEqual([1]);
  });

  it("lists open no-due tasks as unscheduled, excluding done", () => {
    const w = buildWeek([t(1, null), t(2, null, { status: "done" })], NOW);
    expect(w.unscheduled.map((x) => x.id)).toEqual([1]);
  });

  it("drops tasks due after this week", () => {
    const w = buildWeek([t(1, "2026-07-01")], NOW);
    expect(w.days.every((d) => d.tasks.length === 0)).toBe(true);
    expect(w.overdue).toEqual([]);
    expect(w.unscheduled).toEqual([]);
  });

  it("sorts within a day by priority then id", () => {
    const w = buildWeek(
      [t(5, "2026-06-18", { priority: "medium" }), t(2, "2026-06-18", { priority: "critical" })],
      NOW,
    );
    expect(w.days[3].tasks.map((x) => x.id)).toEqual([2, 5]); // critical first
  });
});

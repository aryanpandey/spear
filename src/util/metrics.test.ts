import { describe, it, expect } from "vitest";
import { buildMetrics, type MetricsTaskRecord } from "./metrics.js";

// Encode/decode in local time so the assertions are timezone-independent.
const at = (y: number, m: number, d: number): string => new Date(y, m - 1, d, 12).toISOString();
const rec = (created: [number, number, number], completed: [number, number, number] | null): MetricsTaskRecord => ({
  created_at: at(...created),
  completed_at: completed ? at(...completed) : null,
});

describe("buildMetrics", () => {
  // Wednesday, 2026-06-17 → running week Mon 06-15 … Sun 06-21.
  const now = new Date(2026, 5, 17, 12);
  const tasks = [
    rec([2026, 6, 10], null), // T1: old backlog, still open
    rec([2026, 6, 15], [2026, 6, 16]), // T2: added Mon, done Tue
    rec([2026, 6, 16], null), // T3: added Tue, open
    rec([2026, 6, 17], [2026, 6, 17]), // T4: added + done today
  ];
  const m = buildMetrics(tasks, now);

  it("counts today's added and completed", () => {
    expect(m.today.date).toBe("2026-06-17");
    expect(m.today.added).toBe(1); // T4
    expect(m.today.completed).toBe(1); // T4
  });

  it("counts the week's added and completed and the open total", () => {
    expect(m.week.weekStart).toBe("2026-06-15");
    expect(m.week.weekEnd).toBe("2026-06-21");
    expect(m.week.added).toBe(3); // T2, T3, T4
    expect(m.week.completed).toBe(2); // T2, T4
    expect(m.totalOpen).toBe(2); // T1, T3
  });

  it("builds a Mon→Sun burndown of remaining + cumulative completed, stopping at today", () => {
    expect(m.burndown).toHaveLength(7);
    expect(m.burndown[0]).toMatchObject({ weekday: "Mon", remaining: 2, completed: 0, isFuture: false });
    expect(m.burndown[1]).toMatchObject({ weekday: "Tue", remaining: 2, completed: 1 });
    expect(m.burndown[2]).toMatchObject({ weekday: "Wed", remaining: 2, completed: 2, isToday: true });
    expect(m.burndown[3].isFuture).toBe(true); // Thu and beyond
    expect(m.burndown[6].isFuture).toBe(true);
  });
});

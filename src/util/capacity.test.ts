import { describe, it, expect } from "vitest";
import { effortSlots, effectiveCapacity, deterministicDates } from "./capacity.js";

describe("effortSlots", () => {
  it("large counts as 2, everything else as 1", () => {
    expect(effortSlots("large")).toBe(2);
    expect(effortSlots("medium")).toBe(1);
    expect(effortSlots("small")).toBe(1);
    expect(effortSlots(null)).toBe(1);
    expect(effortSlots(undefined)).toBe(1);
  });
});

describe("effectiveCapacity", () => {
  it("uses the explicit capacity when positive", () => {
    expect(effectiveCapacity(3, 6)).toBe(3);
  });
  it("falls back to lane count when 0 (auto)", () => {
    expect(effectiveCapacity(0, 6)).toBe(6);
  });
  it("never goes below 1", () => {
    expect(effectiveCapacity(0, 0)).toBe(1);
    expect(effectiveCapacity(-2, 0)).toBe(1);
  });
});

describe("deterministicDates", () => {
  const today = "2026-06-19";

  it("packs `capacity` 1-slot tasks per day", () => {
    const tasks = [1, 2, 3, 4].map((id) => ({ id, effort: "small" as const }));
    const m = deterministicDates(tasks, 2, today);
    expect(m.get(1)).toBe("2026-06-19");
    expect(m.get(2)).toBe("2026-06-19");
    expect(m.get(3)).toBe("2026-06-20");
    expect(m.get(4)).toBe("2026-06-20");
  });

  it("a leading large task (2 slots) fills its day alone", () => {
    const tasks = [
      { id: 1, effort: "large" as const },
      { id: 2, effort: "small" as const },
      { id: 3, effort: "small" as const },
    ];
    const m = deterministicDates(tasks, 2, today);
    expect(m.get(1)).toBe("2026-06-19"); // fills slots 0+1 → day 0
    expect(m.get(2)).toBe("2026-06-20"); // slot 2 → day 1
    expect(m.get(3)).toBe("2026-06-20"); // slot 3 → day 1
  });

  it("produces non-decreasing dates and coerces capacity to >= 1", () => {
    const tasks = [1, 2, 3].map((id) => ({ id, effort: null }));
    const m = deterministicDates(tasks, 0, today); // 0 coerced to 1 → one per day
    expect(m.get(1)).toBe("2026-06-19");
    expect(m.get(2)).toBe("2026-06-20");
    expect(m.get(3)).toBe("2026-06-21");
  });
});

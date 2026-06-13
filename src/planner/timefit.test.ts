import { describe, it, expect } from "vitest";
import { buildTimeOpts, formatMinutes, timeBudget } from "./timefit.js";

const EM = { small: 30, medium: 120, large: 240 };

describe("timeBudget", () => {
  it("marks items past the budget as spills with a cut index", () => {
    // estimates 30,120,240,30 → cumulative 30,150,390,420; budget 180
    const fit = timeBudget(["small", "medium", "large", "small"], EM, 180);
    expect(fit.perItem.map((p) => p.fits)).toEqual([true, true, false, false]);
    expect(fit.cutIndex).toBe(2);
    expect(fit.fitsCount).toBe(2);
    expect(fit.spillCount).toBe(2);
    expect(fit.plannedMin).toBe(420);
  });

  it("treats null effort as medium", () => {
    expect(timeBudget([null], EM, 200).perItem[0].estMin).toBe(120);
  });

  it("returns cutIndex -1 when everything fits", () => {
    expect(timeBudget(["small", "small"], EM, 600).cutIndex).toBe(-1);
  });
});

describe("buildTimeOpts", () => {
  it("uses the hours override when given", () => {
    expect(buildTimeOpts(EM, { hour: 18, minute: 0 }, 3).timeLeftMin).toBe(180);
  });

  it("falls back to the workday end", () => {
    const now = new Date(2026, 5, 13, 16, 0, 0); // 16:00 → 2h to 18:00
    expect(buildTimeOpts(EM, { hour: 18, minute: 0 }, undefined, now).timeLeftMin).toBe(120);
  });
});

describe("formatMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatMinutes(150)).toBe("2h30m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(45)).toBe("45m");
  });
});

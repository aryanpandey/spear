import { describe, it, expect } from "vitest";
import { coerceTheme, THEMES } from "./theme.js";

describe("coerceTheme", () => {
  it("keeps valid themes", () => {
    for (const t of THEMES) expect(coerceTheme(t)).toBe(t);
  });
  it("falls back to matrix for unknown/empty values", () => {
    expect(coerceTheme("neon")).toBe("matrix");
    expect(coerceTheme(null)).toBe("matrix");
    expect(coerceTheme(undefined)).toBe("matrix");
    expect(coerceTheme("")).toBe("matrix");
  });
});

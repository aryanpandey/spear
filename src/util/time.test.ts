import { describe, it, expect } from "vitest";
import { parseDueInput } from "./time.js";

const NOW = new Date(2026, 5, 13); // 2026-06-13 local

describe("parseDueInput", () => {
  it("passes through a valid YYYY-MM-DD", () => {
    expect(parseDueInput("2026-06-20", NOW)).toBe("2026-06-20");
  });

  it("resolves relative +Nd offsets", () => {
    expect(parseDueInput("+3d", NOW)).toBe("2026-06-16");
  });

  it("resolves today / tomorrow", () => {
    expect(parseDueInput("today", NOW)).toBe("2026-06-13");
    expect(parseDueInput("tomorrow", NOW)).toBe("2026-06-14");
  });

  it("clears with clear / none / empty", () => {
    expect(parseDueInput("clear", NOW)).toBeNull();
    expect(parseDueInput("none", NOW)).toBeNull();
    expect(parseDueInput("", NOW)).toBeNull();
  });

  it("is case- and whitespace-tolerant", () => {
    expect(parseDueInput("  Tomorrow ", NOW)).toBe("2026-06-14");
  });

  it("throws on unrecognized input and impossible dates", () => {
    expect(() => parseDueInput("next-week", NOW)).toThrow();
    expect(() => parseDueInput("2026-13-40", NOW)).toThrow();
  });
});

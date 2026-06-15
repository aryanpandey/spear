import { describe, it, expect } from "vitest";
import { inferPriority } from "./priority.js";

const NOW = new Date(2026, 5, 13); // 2026-06-13 local

describe("inferPriority", () => {
  it("flags urgent wording as critical", () => {
    expect(inferPriority({ title: "Fix prod outage in billing", now: NOW }).priority).toBe("critical");
  });

  it("bumps fix/bug wording to high", () => {
    expect(inferPriority({ title: "Fix flaky login test", now: NOW }).priority).toBe("high");
  });

  it("defaults to medium for neutral tasks", () => {
    expect(inferPriority({ title: "Write release notes", now: NOW }).priority).toBe("medium");
  });

  it("caps overdue and due-today at high (critical is reserved)", () => {
    expect(inferPriority({ title: "Write notes", due: "2026-06-10", now: NOW }).priority).toBe("high");
    expect(inferPriority({ title: "Write notes", due: "2026-06-13", now: NOW }).priority).toBe("high");
  });

  it("never lowers an already-higher priority via the due band", () => {
    expect(inferPriority({ title: "prod outage", due: "2026-07-01", now: NOW }).priority).toBe("critical");
  });

  it("bumps on blocks-others and due-soon", () => {
    expect(inferPriority({ title: "Write notes", blocksOthers: true, now: NOW }).priority).toBe("high");
    expect(inferPriority({ title: "Write notes", due: "2026-06-15", now: NOW }).priority).toBe("high");
  });

  it("never manufactures critical from due date or blocking — only wording/explicit", () => {
    // overdue + blocks-others on a fix/bug task still caps at high, never critical
    expect(
      inferPriority({ title: "Fix login bug", due: "2026-06-10", blocksOthers: true, now: NOW }).priority,
    ).toBe("high");
  });

  it("reports a human reason", () => {
    expect(inferPriority({ title: "Fix prod", now: NOW }).reason).toMatch(/urgent/);
    expect(inferPriority({ title: "Write notes", now: NOW }).reason).toBe("default");
  });
});

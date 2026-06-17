import { describe, it, expect } from "vitest";
import { needsConfirm } from "./needsConfirm.js";

describe("needsConfirm", () => {
  it("confirms when an image was used", () => {
    expect(needsConfirm({ imageUsed: true, seedCount: 1, duplicateCount: 0 })).toBe(true);
  });
  it("confirms when 2+ tasks were extracted", () => {
    expect(needsConfirm({ imageUsed: false, seedCount: 2, duplicateCount: 0 })).toBe(true);
  });
  it("confirms when a duplicate was flagged", () => {
    expect(needsConfirm({ imageUsed: false, seedCount: 1, duplicateCount: 1 })).toBe(true);
  });
  it("does NOT confirm a single typed task with no image and no duplicate", () => {
    expect(needsConfirm({ imageUsed: false, seedCount: 1, duplicateCount: 0 })).toBe(false);
  });
});

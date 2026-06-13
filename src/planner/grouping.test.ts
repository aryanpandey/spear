import { describe, it, expect } from "vitest";
import { clusterByTitle, phaseRank, titleTokens } from "./grouping.js";

describe("clusterByTitle", () => {
  it("groups tasks sharing a subject and isolates unrelated ones", () => {
    const items = [
      { id: 1, title: "Collection Brain Design" },
      { id: 2, title: "Collection Brain Eval Design" },
      { id: 3, title: "Collection Brain Implementation Breakdown" },
      { id: 4, title: "Renew SSL cert" },
      { id: 5, title: "Upgrade billing webhook" },
    ];
    const groups = clusterByTitle(items);
    const cb = groups.find((g) => g.includes(1))!;
    expect(cb).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(cb).not.toContain(4);
    expect(cb).not.toContain(5);
    expect(groups.length).toBeLessThan(items.length);
  });

  it("caps the number of lanes, folding overflow into existing lanes", () => {
    // 20 distinct (unrelated) titles would be 20 singleton lanes; cap to 8.
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Unique subject alpha${i} beta${i}` }));
    const groups = clusterByTitle(items, 8);
    expect(groups.length).toBe(8);
    // every task is still present exactly once
    const all = groups.flat().sort((a, b) => a - b);
    expect(all).toEqual(items.map((it) => it.id));
    // the earliest (highest-priority) tasks anchor their own lanes
    expect(groups[0][0]).toBe(1);
  });

  it("treats title-less items as singletons (one lane per task)", () => {
    const groups = clusterByTitle([
      { id: 1, title: "" },
      { id: 2, title: "" },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("drops phase words so design/impl/test tasks of one subject still group", () => {
    expect(titleTokens("Collection Brain Design")).toEqual(expect.arrayContaining(["collection", "brain"]));
    expect(titleTokens("Collection Brain Design")).not.toContain("design");
  });
});

describe("phaseRank", () => {
  it("orders design < implementation < testing from titles", () => {
    expect(phaseRank("Collection Brain Design")).toBe(0);
    expect(phaseRank("Collection Brain Implementation Breakdown")).toBe(1);
    expect(phaseRank("Image Processing Testing")).toBe(2);
  });

  it("prefers the stage kind when available", () => {
    expect(phaseRank("anything", "planning")).toBe(0);
    expect(phaseRank("anything", "implementation")).toBe(1);
    expect(phaseRank("anything", "stage_testing")).toBe(2);
  });
});

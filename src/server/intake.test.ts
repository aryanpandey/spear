import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { intakeTasks, extractSeedsForIntake, createTasksFromSeeds, mimeExt } from "./intake.js";

function makeStore(): Store {
  return new Store(openDb(":memory:"));
}

describe("mimeExt", () => {
  it("maps known mime types and defaults to png", () => {
    expect(mimeExt("image/jpeg")).toBe("jpg");
    expect(mimeExt("image/webp")).toBe("webp");
    expect(mimeExt(undefined)).toBe("png");
  });
});

describe("intakeTasks", () => {
  const breakdownRun = async () => ({
    title: "Cleaned",
    type: "chore",
    priority: "medium",
    effort: "small",
    stages: [{ name: "do it", kind: "generic", effort: "small", delegatable_to: ["self"] }],
  });

  it("creates one task per extracted seed", async () => {
    const store = makeStore();
    const extract = async () => [
      { title: "one", details: "d1" },
      { title: "two", details: "d2" },
    ];
    const { taskIds } = await intakeTasks(store, DEFAULT_CONFIG, { prompt: "p" }, { extract, breakdownRun });
    expect(taskIds).toHaveLength(2);
    expect(store.listTasks()).toHaveLength(2);
  });

  it("applies the chosen priority to every seed", async () => {
    const store = makeStore();
    const extract = async () => [{ title: "one", details: "d1" }];
    await intakeTasks(store, DEFAULT_CONFIG, { prompt: "p", priority: "high" }, { extract, breakdownRun });
    expect(store.listTasks()[0].priority).toBe("high");
  });

  it("inserts the seeds that succeed even if one breakdown throws", async () => {
    const store = makeStore();
    const extract = async () => [
      { title: "ok", details: "d" },
      { title: "boom", details: "d" },
    ];
    // Key the failure on the prompt (which carries the seed title) so it throws
    // on BOTH the call and claudeStructured's one retry — i.e. the seed truly fails.
    const flaky = async (prompt: string) => {
      if (prompt.includes("boom")) throw new Error("breakdown failed");
      return {
        title: "ok",
        type: "chore",
        priority: "medium",
        effort: "small",
        stages: [{ name: "s", kind: "generic", effort: "small", delegatable_to: ["self"] }],
      };
    };
    const { taskIds } = await intakeTasks(store, DEFAULT_CONFIG, { prompt: "p" }, { extract, breakdownRun: flaky });
    expect(taskIds).toHaveLength(1);
  });
});

describe("createTasksFromSeeds", () => {
  const breakdownRun = async () => ({
    title: "Cleaned",
    type: "chore",
    priority: "medium",
    effort: "small",
    stages: [{ name: "do it", kind: "generic", effort: "small", delegatable_to: ["self"] }],
  });

  it("creates one task per provided seed and applies priority", async () => {
    const store = new Store(openDb(":memory:"));
    const seeds = [
      { title: "one", details: "d1" },
      { title: "two", details: "d2" },
    ];
    const { taskIds } = await createTasksFromSeeds(store, DEFAULT_CONFIG, seeds, { priority: "high" }, { breakdownRun });
    expect(taskIds).toHaveLength(2);
    expect(store.listTasks().every((t) => t.priority === "high")).toBe(true);
  });
});

describe("extractSeedsForIntake", () => {
  it("returns the extracted seeds via the injected extractor", async () => {
    const extract = async () => [{ title: "x", details: "y" }];
    const seeds = await extractSeedsForIntake(DEFAULT_CONFIG, { prompt: "p" }, { extract });
    expect(seeds).toEqual([{ title: "x", details: "y" }]);
  });
});

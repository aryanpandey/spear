import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { addTask } from "../service.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { buildAndSavePlan, saveStickyPlan } from "./build.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}
const cfg = { ...DEFAULT_CONFIG, maxLanes: 6 };

describe("sticky lanes", () => {
  it("keeps existing tasks' lanes when a new task is added (incremental)", async () => {
    const s = freshStore();
    const a = addTask(s, { title: "Search Ranking Design", type: "chore" }).task;
    addTask(s, { title: "Checkout Flow Design", type: "chore" });
    addTask(s, { title: "Notifications Service Design", type: "chore" });
    await buildAndSavePlan(s, { trigger: "manual", useLlm: false, model: "m", effort: "high", maxLanes: 6, mode: "full" });

    const lanesBefore = new Map(s.listOpenTasks().map((t) => [t.id, t.lane]));
    expect([...lanesBefore.values()].every((l) => l != null)).toBe(true);

    // Add a new task that clearly belongs with "Search".
    const d = addTask(s, { title: "Search Indexing Implementation", type: "chore" }).task;
    saveStickyPlan(s, cfg, "adhoc");

    for (const [id, lane] of lanesBefore) expect(s.getTask(id)!.lane).toBe(lane); // unchanged
    expect(s.getTask(d.id)!.lane).toBe(s.getTask(a.id)!.lane); // joined the Search lane
  });

  it("promotes to full when no lanes were assigned today (epoch stale)", () => {
    const s = freshStore();
    addTask(s, { title: "Task one", type: "chore" });
    saveStickyPlan(s, cfg, "adhoc");
    expect(s.getTask(1)!.lane).not.toBeNull();
    expect(s.getMeta("lane_epoch")).not.toBeNull();
  });

  it("does not reshuffle unrelated lanes when an unrelated task is added", async () => {
    const s = freshStore();
    addTask(s, { title: "Billing webhook retries", type: "chore" });
    addTask(s, { title: "Search ranking tweaks", type: "chore" });
    await buildAndSavePlan(s, { trigger: "manual", useLlm: false, model: "m", effort: "high", maxLanes: 6, mode: "full" });
    const before = new Map(s.listOpenTasks().map((t) => [t.id, t.lane]));

    addTask(s, { title: "Totally unrelated infra upgrade", type: "chore" });
    saveStickyPlan(s, cfg, "adhoc");

    for (const [id, lane] of before) expect(s.getTask(id)!.lane).toBe(lane);
  });
});

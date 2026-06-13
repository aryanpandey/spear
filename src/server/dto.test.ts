import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { addTask, blockTask } from "../service.js";
import { buildAndSavePlan } from "../planner/build.js";
import { boardDto, todayDto } from "./dto.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}

describe("boardDto", () => {
  it("includes stages, open blockers and executors", async () => {
    const store = freshStore();
    const a = addTask(store, { title: "Build login", type: "feature", priority: "high" }).task;
    const b = addTask(store, { title: "Cert", type: "chore" }).task;
    blockTask(store, b.id, a.id);

    const dto = boardDto(store);
    expect(dto.executors.map((e) => e.name)).toEqual(["Me"]);
    const ta = dto.tasks.find((t) => t.id === a.id)!;
    expect(ta.stages.map((s) => s.name)).toEqual(["Planning", "Implementation", "Testing", "Stage Testing"]);
    const tb = dto.tasks.find((t) => t.id === b.id)!;
    expect(tb.openBlockers).toEqual([a.id]);
    expect(tb.status).toBe("blocked");
  });
});

describe("todayDto", () => {
  it("returns null plan when none generated", () => {
    const store = freshStore();
    expect(todayDto(store).plan).toBeNull();
  });

  it("groups plan items into lanes with resolved task/stage/executor", async () => {
    const store = freshStore();
    addTask(store, { title: "Build login", type: "feature", priority: "high" });
    await buildAndSavePlan(store, { trigger: "manual", useLlm: false, model: "m", effort: "high", maxLanes: 8 });

    const dto = todayDto(store);
    expect(dto.plan).not.toBeNull();
    expect(dto.lanes.length).toBeGreaterThan(0);
    const first = dto.lanes[0].items[0];
    expect(first.stage.name).toBe("Planning");
    expect(first.scheduled_state).toBe("start_now");
    expect(dto.lanes[0].executor?.name).toBe("Me");
  });
});

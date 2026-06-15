import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { addTask, blockTask } from "../service.js";
import { buildPlanContext, openStageIds } from "./context.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}

describe("buildPlanContext", () => {
  it("emits open flows with their remaining stages and open blockers", () => {
    const store = freshStore();
    const a = addTask(store, { title: "A", stages: [{ name: "s", kind: "generic" }] });
    const b = addTask(store, { title: "B", stages: [{ name: "s", kind: "generic" }] });
    blockTask(store, b.task.id, a.task.id);

    const ctx = buildPlanContext(store, "2026-06-15");
    expect(ctx.flows.map((f) => f.taskId).sort((x, y) => x - y)).toEqual([a.task.id, b.task.id]);

    const bf = ctx.flows.find((f) => f.taskId === b.task.id)!;
    expect(bf.openBlockers).toEqual([a.task.id]);
    expect(bf.stages).toHaveLength(1);
    expect(ctx.executors[0].kind).toBe("self");
  });

  it("openStageIds lists every open stage id", () => {
    const store = freshStore();
    const a = addTask(store, { title: "A", stages: [{ name: "s", kind: "generic" }] });
    expect(openStageIds(store).has(a.stages[0].id)).toBe(true);
  });
});

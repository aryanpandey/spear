import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "./db/index.js";
import { Store } from "./db/store.js";
import {
  addTask,
  advanceTask,
  blockTask,
  completeStage,
  completeTask,
  nextOpenStage,
  openDependencies,
  recomputeTaskStatus,
  setTaskStatus,
  unblockTask,
} from "./service.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}

describe("service.addTask", () => {
  let store: Store;
  beforeEach(() => (store = freshStore()));

  it("gives a feature the fixed 4-stage flow", () => {
    const { task, stages } = addTask(store, { title: "Build X", type: "feature", priority: "high" });
    expect(task.type).toBe("feature");
    expect(stages.map((s) => s.name)).toEqual(["Planning", "Implementation", "Testing", "Stage Testing"]);
    expect(stages[1].delegatable_to).toContain("ai_agent");
  });

  it("gives a non-feature a single generic stage", () => {
    const { stages } = addTask(store, { title: "Fix typo", type: "chore" });
    expect(stages).toHaveLength(1);
    expect(stages[0].kind).toBe("generic");
  });

  it("uses explicit stages when provided (LLM path)", () => {
    const { stages } = addTask(store, {
      title: "Investigate flake",
      type: "bug",
      stages: [
        { name: "Reproduce", kind: "generic", effort: "small" },
        { name: "Fix", kind: "implementation", effort: "medium" },
        { name: "Verify", kind: "testing", effort: "small", delegatable_to: ["ci"] },
      ],
    });
    expect(stages.map((s) => s.name)).toEqual(["Reproduce", "Fix", "Verify"]);
    expect(stages[2].delegatable_to).toEqual(["ci"]);
  });

  it("marks a task blocked when created with open dependencies", () => {
    const a = addTask(store, { title: "A", type: "chore" }).task;
    const b = addTask(store, { title: "B", type: "chore", blockedBy: [a.id] }).task;
    expect(b.status).toBe("blocked");
    expect(openDependencies(store, b.id)).toEqual([a.id]);
  });
});

describe("service flow advance + status rollup", () => {
  let store: Store;
  beforeEach(() => (store = freshStore()));

  it("advances stage by stage, then marks the task done", () => {
    const { task } = addTask(store, { title: "Feature", type: "feature" });
    expect(nextOpenStage(store, task.id)?.name).toBe("Planning");

    advanceTask(store, task.id); // Planning done
    expect(nextOpenStage(store, task.id)?.name).toBe("Implementation");

    advanceTask(store, task.id); // Implementation
    advanceTask(store, task.id); // Testing
    let t = store.getTask(task.id)!;
    expect(t.status).toBe("in_progress");

    advanceTask(store, task.id); // Stage Testing → all done
    t = store.getTask(task.id)!;
    expect(t.status).toBe("done");
    expect(nextOpenStage(store, task.id)).toBeUndefined();
  });

  it("unblocks a dependent when its blocker completes", () => {
    const a = addTask(store, { title: "A", type: "chore" }).task;
    const b = addTask(store, { title: "B", type: "chore", blockedBy: [a.id] }).task;
    expect(store.getTask(b.id)!.status).toBe("blocked");

    completeTask(store, a.id);
    expect(store.getTask(b.id)!.status).toBe("todo");
  });

  it("completeStage settles the owning task", () => {
    const { task, stages } = addTask(store, { title: "Feature", type: "feature" });
    completeStage(store, stages[0].id);
    expect(store.getStages(task.id)[0].status).toBe("done");
    expect(store.getTask(task.id)!.status).toBe("in_progress");
  });

  it("block/unblock toggles blocked status", () => {
    const a = addTask(store, { title: "A", type: "chore" }).task;
    const b = addTask(store, { title: "B", type: "chore" }).task;
    blockTask(store, b.id, a.id);
    expect(store.getTask(b.id)!.status).toBe("blocked");
    unblockTask(store, b.id, a.id);
    expect(store.getTask(b.id)!.status).toBe("todo");
  });

  it("preserves explicit backlog status unless complete", () => {
    const { task } = addTask(store, { title: "Later", type: "chore" });
    setTaskStatus(store, task.id, "backlog");
    recomputeTaskStatus(store, task.id);
    expect(store.getTask(task.id)!.status).toBe("backlog");
  });
});

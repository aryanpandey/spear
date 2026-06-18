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
  removeTask,
  setTaskDescription,
  setTaskDue,
  setTaskPriority,
  setTaskStatus,
  setTaskTitle,
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

  it("uses provided stages, else a single generic stage (no built-in feature flow)", () => {
    const { task, stages } = addTask(store, { title: "Build X", type: "feature", priority: "high" });
    expect(task.type).toBe("feature");
    expect(stages).toHaveLength(1);
    expect(stages[0].kind).toBe("generic");
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
    const { task } = addTask(store, {
      title: "Feature",
      type: "feature",
      stages: [
        { name: "Planning", kind: "planning" },
        { name: "Implementation", kind: "implementation" },
        { name: "Testing", kind: "testing" },
        { name: "Stage Testing", kind: "stage_testing" },
      ],
    });
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
    const { task, stages } = addTask(store, {
      title: "Feature",
      stages: [
        { name: "Planning", kind: "planning" },
        { name: "Implementation", kind: "implementation" },
      ],
    });
    completeStage(store, stages[0].id);
    expect(store.getStages(task.id)[0].status).toBe("done");
    expect(store.getTask(task.id)!.status).toBe("in_progress");
  });

  it("setTaskStatus cannot un-complete a fully-done task (rapid start→done race)", () => {
    const { task } = addTask(store, { title: "Race", stages: [{ name: "s", kind: "generic" }] });
    completeTask(store, task.id);
    expect(store.getTask(task.id)!.status).toBe("done");
    // a racing 'start' (set in_progress) arriving AFTER 'done' must not revert it
    expect(setTaskStatus(store, task.id, "in_progress").status).toBe("done");
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

  it("removeTask deletes the task, its stages, and re-settles dependents", () => {
    const a = addTask(store, { title: "A", type: "feature" }).task;
    const b = addTask(store, { title: "B", type: "chore", blockedBy: [a.id] }).task;
    expect(store.getTask(b.id)!.status).toBe("blocked");

    removeTask(store, a.id);
    expect(store.getTask(a.id)).toBeUndefined();
    expect(store.getStages(a.id)).toHaveLength(0);
    // b no longer has an open blocker → unblocked
    expect(openDependencies(store, b.id)).toEqual([]);
    expect(store.getTask(b.id)!.status).toBe("todo");
  });
});

describe("service.setTaskDue", () => {
  let store: Store;
  beforeEach(() => (store = freshStore()));

  it("sets a normalized deadline on a task", () => {
    const { task } = addTask(store, { title: "Ship it" });
    const updated = setTaskDue(store, task.id, "2026-06-20");
    expect(updated.due).toBe("2026-06-20");
    expect(store.getTask(task.id)!.due).toBe("2026-06-20");
  });

  it("clears the deadline with 'clear'", () => {
    const { task } = addTask(store, { title: "Ship it", due: "2026-06-20" });
    expect(setTaskDue(store, task.id, "clear").due).toBeNull();
  });

  it("throws on an unknown task or an invalid date", () => {
    const { task } = addTask(store, { title: "Ship it" });
    expect(() => setTaskDue(store, 9999, "today")).toThrow();
    expect(() => setTaskDue(store, task.id, "whenever")).toThrow();
  });
});

describe("service.setTaskPriority", () => {
  let store: Store;
  beforeEach(() => (store = freshStore()));

  it("changes a task's priority", () => {
    const { task } = addTask(store, { title: "T", priority: "medium", stages: [{ name: "s", kind: "generic" }] });
    expect(setTaskPriority(store, task.id, "critical").priority).toBe("critical");
    expect(store.getTask(task.id)!.priority).toBe("critical");
  });

  it("throws on an unknown task", () => {
    expect(() => setTaskPriority(store, 9999, "high")).toThrow();
  });
});

describe("setTaskTitle", () => {
  let store: Store;
  beforeEach(() => (store = freshStore()));

  it("renames a task (trimmed)", () => {
    const t = addTask(store, { title: "old name" }).task;
    const updated = setTaskTitle(store, t.id, "  new name  ");
    expect(updated.title).toBe("new name");
    expect(store.getTask(t.id)!.title).toBe("new name");
  });

  it("rejects an empty / whitespace title", () => {
    const t = addTask(store, { title: "keep" }).task;
    expect(() => setTaskTitle(store, t.id, "   ")).toThrow();
    expect(store.getTask(t.id)!.title).toBe("keep");
  });

  it("syncs a lone generic stage's name to the new title", () => {
    const t = addTask(store, { title: "old name" }).task; // one generic stage named "old name"
    setTaskTitle(store, t.id, "renamed");
    expect(store.getStages(t.id)[0].name).toBe("renamed");
  });

  it("does not rename the stages of a multi-stage task", () => {
    const t = addTask(store, {
      title: "feat",
      stages: [
        { name: "Plan", kind: "planning" },
        { name: "Impl", kind: "implementation" },
      ],
    }).task;
    setTaskTitle(store, t.id, "renamed feat");
    expect(store.getStages(t.id).map((s) => s.name)).toEqual(["Plan", "Impl"]);
  });
});

describe("setTaskDescription", () => {
  let store: Store;
  beforeEach(() => (store = freshStore()));

  it("sets the description (incl. empty) and throws on unknown", () => {
    const t = addTask(store, { title: "t" }).task;
    expect(setTaskDescription(store, t.id, "some notes").description).toBe("some notes");
    expect(setTaskDescription(store, t.id, "").description).toBe("");
    expect(() => setTaskDescription(store, 9999, "x")).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { importSeed, mapPriority, mapStatus, type NotionSeedTask } from "./import.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}

const OPTS = { breakdown: false, model: "claude-opus-4-8", effort: "medium" as const };

describe("notion field mapping", () => {
  it("normalizes Notion statuses and priorities", () => {
    expect(mapStatus("To Do")).toBe("todo");
    expect(mapStatus("In Progress")).toBe("in_progress");
    expect(mapStatus("Done")).toBe("done");
    expect(mapStatus("Not started")).toBe("todo");
    expect(mapStatus(undefined)).toBe("todo");
    expect(mapPriority("High")).toBe("high");
    expect(mapPriority("Critical")).toBe("critical");
    expect(mapPriority(undefined)).toBe("medium");
  });
});

describe("importSeed", () => {
  const seed: NotionSeedTask[] = [
    { external_id: "notion-1", title: "Build login", status: "In Progress", priority: "High", notes: "from notion" },
    { external_id: "notion-2", title: "Old chore", status: "Done", priority: "Low" },
  ];

  it("creates tasks with mapped status/priority and a single generic stage", async () => {
    const store = freshStore();
    const res = await importSeed(store, seed, OPTS);
    expect(res).toEqual({ created: 2, updated: 0, skipped: 0 });

    const login = store.getTaskByExternalId("notion-1")!;
    expect(login.priority).toBe("high");
    expect(login.status).toBe("in_progress");
    expect(login.source).toBe("notion");
    expect(login.description).toBe("from notion");
    expect(store.getStages(login.id)).toHaveLength(1);

    const done = store.getTaskByExternalId("notion-2")!;
    expect(done.status).toBe("done");
    // a 'done' import marks its stage done too
    expect(store.getStages(done.id).every((s) => s.status === "done")).toBe(true);
  });

  it("is idempotent: re-importing updates in place, not duplicates", async () => {
    const store = freshStore();
    await importSeed(store, seed, OPTS);
    const updated: NotionSeedTask[] = [
      { external_id: "notion-1", title: "Build login v2", status: "Blocked", priority: "Critical" },
    ];
    const res = await importSeed(store, updated, OPTS);
    expect(res).toEqual({ created: 0, updated: 1, skipped: 0 });

    expect(store.listTasks()).toHaveLength(2); // still 2, not 3
    const login = store.getTaskByExternalId("notion-1")!;
    expect(login.title).toBe("Build login v2");
    expect(login.priority).toBe("critical");
    expect(login.status).toBe("blocked");
  });

  it("skips rows with no title", async () => {
    const store = freshStore();
    const res = await importSeed(store, [{ external_id: "x", status: "To Do" }], OPTS);
    expect(res.skipped).toBe(1);
    expect(res.created).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { checkSeedsForDuplicates } from "./duplicateCheck.js";

function makeStore(): Store {
  return new Store(openDb(":memory:"));
}

describe("checkSeedsForDuplicates", () => {
  it("enriches matches with the existing task title + status (incl. done)", async () => {
    const store = makeStore();
    const a = store.createTask({ title: "Renew SSL cert" });
    store.updateTask(a.id, { status: "done" }); // a is done — must still be checked
    const seeds = [{ title: "Renew the SSL certificate", details: "" }];
    const run = async () => ({ matches: [{ candidate_index: 0, task_id: a.id, reason: "same cert renewal" }] });
    const out = await checkSeedsForDuplicates(store, DEFAULT_CONFIG, seeds, run);
    expect(out).toEqual([{ seedIndex: 0, taskId: a.id, title: "Renew SSL cert", status: "done", reason: "same cert renewal" }]);
  });

  it("returns [] when nothing matches", async () => {
    const store = makeStore();
    store.createTask({ title: "Totally unrelated" });
    const run = async () => ({ matches: [] });
    const out = await checkSeedsForDuplicates(store, DEFAULT_CONFIG, [{ title: "new thing", details: "" }], run);
    expect(out).toEqual([]);
  });
});

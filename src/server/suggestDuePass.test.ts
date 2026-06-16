import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { runSuggestedDuePass } from "./suggestDuePass.js";

function makeStore(): Store {
  return new Store(openDb(":memory:"));
}

describe("runSuggestedDuePass", () => {
  it("stores suggestions for undated tasks only", async () => {
    const store = makeStore();
    const a = store.createTask({ title: "a", priority: "high" });
    const b = store.createTask({ title: "b", due: "2026-06-30" });
    const run = async () => ({ suggestions: [{ task_id: a.id, date: "2026-06-20", reason: "soon" }] });
    const n = await runSuggestedDuePass(store, DEFAULT_CONFIG, "2026-06-16", run);
    expect(n).toBe(1);
    expect(store.getTask(a.id)!.suggested_due).toBe("2026-06-20");
    expect(store.getTask(b.id)!.suggested_due).toBeNull();
  });

  it("returns 0 and stores nothing when there are no undated open tasks", async () => {
    const store = makeStore();
    store.createTask({ title: "done one", due: "2026-07-01" });
    let called = false;
    const run = async () => {
      called = true;
      return { suggestions: [] };
    };
    const n = await runSuggestedDuePass(store, DEFAULT_CONFIG, "2026-06-16", run);
    expect(n).toBe(0);
    expect(called).toBe(false); // short-circuits before the LLM call
  });
});

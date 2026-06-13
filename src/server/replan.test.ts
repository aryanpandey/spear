import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { addTask } from "../service.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { triggerReplan } from "../replan/trigger.js";
import { Replanner } from "./replan.js";
import type { SseHub } from "./sse.js";

function freshStore(): Store {
  const s = new Store(openDb(":memory:"));
  s.seedDefaults();
  return s;
}

function fakeHub(): SseHub & { events: Record<string, unknown>[] } {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    add() {},
    remove() {},
    broadcast(e) {
      events.push(e);
    },
    count() {
      return 0;
    },
    close() {},
  };
}

describe("Replanner.requestReplan (no API key)", () => {
  it("persists a deterministic current plan and broadcasts once", () => {
    const store = freshStore();
    addTask(store, { title: "Build login", type: "feature", priority: "high" });
    const hub = fakeHub();
    const replanner = new Replanner(store, hub, DEFAULT_CONFIG);

    replanner.requestReplan("adhoc");

    const plan = store.getCurrentPlan();
    expect(plan).not.toBeNull();
    expect(plan!.trigger).toBe("adhoc");
    expect(plan!.model).toBeNull(); // deterministic
    expect(store.getPlanItems(plan!.id).length).toBeGreaterThan(0);
    expect(hub.events).toHaveLength(1);
    expect(hub.events[0]).toMatchObject({ type: "update", source: "deterministic" });
    replanner.dispose();
  });
});

describe("triggerReplan inline fallback (no server running)", () => {
  it("persists a deterministic plan inline when no server answers", async () => {
    const store = freshStore();
    addTask(store, { title: "Renew cert", type: "chore" });
    // Use a port nothing is listening on so the handoff fetch fails fast.
    const where = await triggerReplan(store, { ...DEFAULT_CONFIG, port: 4599 });
    expect(where).toBe("inline");
    expect(store.getCurrentPlan()).not.toBeNull();
  });
});

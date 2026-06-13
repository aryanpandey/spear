import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { scoreMetric, scorecardDto, goalsPageDto } from "./goalsDto.js";

function freshStore(): Store {
  return new Store(openDb(":memory:"));
}

describe("scoreMetric", () => {
  it("caps earned score at the weight when over 100%", () => {
    // Code Sessions from the reference card: 12/10 → 120%, score capped at 2.5.
    expect(scoreMetric({ progress: 12, goal: 10, weight: 2.5 })).toEqual({ earned: 2.5, pct: 120 });
  });
  it("is zero when no progress", () => {
    expect(scoreMetric({ progress: 0, goal: 4, weight: 1.5 })).toEqual({ earned: 0, pct: 0 });
  });
  it("scales linearly below the goal", () => {
    expect(scoreMetric({ progress: 5, goal: 10, weight: 2 })).toEqual({ earned: 1, pct: 50 });
  });
  it("treats a zero goal as 0% (no divide-by-zero)", () => {
    expect(scoreMetric({ progress: 3, goal: 0, weight: 2 })).toEqual({ earned: 0, pct: 0 });
  });
});

describe("scorecardDto", () => {
  let store: Store;
  beforeEach(() => {
    store = freshStore();
  });

  it("reproduces the reference weekly card totals", () => {
    const card = store.createScorecard({ title: "Weekly Focus: Crypto", is_current: true });
    const rows: [string, number, number, number][] = [
      ["Gym Sessions", 0, 4, 1.5],
      ["Kms Run", 0, 20, 1],
      ["Backtesting", 0, 60, 1.5],
      ["Code Sessions", 12, 10, 2.5],
      ["Crypto Streams", 0, 3, 1],
      ["Papers/Articles", 0, 6, 2.5],
    ];
    for (const [name, progress, goal, weight] of rows) {
      store.addMetric({ scorecard_id: card.id, name, progress, goal, weight });
    }
    const dto = scorecardDto(store, card.id)!;
    expect(dto.metrics).toHaveLength(6);
    expect(dto.totals.earned).toBeCloseTo(2.5);
    expect(dto.totals.weight).toBeCloseTo(10);
    expect(dto.totals.pct).toBeCloseTo(25);
    const code = dto.metrics.find((m) => m.name === "Code Sessions")!;
    expect(code.pct).toBeCloseTo(120);
    expect(code.earned).toBeCloseTo(2.5);
  });

  it("includes bonus tasks", () => {
    const card = store.createScorecard({ title: "W", is_current: true });
    store.addBonus({ scorecard_id: card.id, task: "Run 10K", reward: "2 Anime Episodes" });
    const dto = scorecardDto(store, card.id)!;
    expect(dto.bonuses).toHaveLength(1);
    expect(dto.bonuses[0].reward).toBe("2 Anime Episodes");
  });
});

describe("goals list + current scorecard", () => {
  let store: Store;
  beforeEach(() => {
    store = freshStore();
  });

  it("creates, toggles and deletes goals", () => {
    const g = store.createGoal({ title: "Ship the agent" });
    expect(store.listGoals()).toHaveLength(1);
    const toggled = store.updateGoal(g.id, { status: "done" })!;
    expect(toggled.status).toBe("done");
    store.deleteGoal(g.id);
    expect(store.listGoals()).toHaveLength(0);
  });

  it("keeps exactly one current scorecard", () => {
    const a = store.createScorecard({ title: "A", is_current: true });
    const b = store.createScorecard({ title: "B", is_current: true });
    expect(store.getCurrentScorecard()!.id).toBe(b.id);
    store.setCurrentScorecard(a.id);
    expect(store.getCurrentScorecard()!.id).toBe(a.id);
    expect(store.listScorecards().filter((s) => s.is_current)).toHaveLength(1);
  });

  it("goalsPageDto returns goals + current scorecard together", () => {
    store.createGoal({ title: "x" });
    const card = store.createScorecard({ title: "Wk", is_current: true });
    store.addMetric({ scorecard_id: card.id, name: "Reps", progress: 1, goal: 2, weight: 4 });
    const page = goalsPageDto(store);
    expect(page.goals).toHaveLength(1);
    expect(page.scorecard?.title).toBe("Wk");
    expect(page.scorecard?.metrics[0].earned).toBeCloseTo(2);
  });
});

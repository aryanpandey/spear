import { describe, it, expect } from "vitest";
import { scoreMatch, rankTasks, type Searchable } from "./taskSearch.js";

const mk = (title: string, stageName = "", type = "other", description = ""): Searchable => ({ title, stageName, type, description });

describe("scoreMatch", () => {
  it("ranks exact > prefix > substring > token, and excludes non-matches", () => {
    const q = "login";
    expect(scoreMatch(mk("login"), q)).toBeGreaterThan(scoreMatch(mk("login button"), q));
    expect(scoreMatch(mk("login button"), q)).toBeGreaterThan(scoreMatch(mk("fix the login"), q));
    expect(scoreMatch(mk("fix the login"), q)).toBeGreaterThan(scoreMatch(mk("auth flow", "login stage"), q));
    expect(scoreMatch(mk("unrelated"), q)).toBe(0);
  });
  it("matches notes and is multi-token", () => {
    expect(scoreMatch(mk("X", "", "other", "needs csv export"), "csv")).toBeGreaterThan(0);
    expect(scoreMatch(mk("Add CSV export to reports"), "csv reports")).toBeGreaterThan(scoreMatch(mk("Add CSV export"), "csv reports"));
  });
});

describe("rankTasks", () => {
  const items = [{ t: mk("write report") }, { t: mk("login bug") }, { t: mk("login button broken") }];
  it("returns most-relevant first; all items when blank", () => {
    const r = rankTasks(items, "login", (x) => x.t).map((x) => x.t.title);
    expect(r).toEqual(["login bug", "login button broken"]); // both substring → stable original order
    expect(rankTasks(items, "", (x) => x.t)).toHaveLength(3);
    expect(rankTasks(items, "zzz", (x) => x.t)).toHaveLength(0);
  });
});

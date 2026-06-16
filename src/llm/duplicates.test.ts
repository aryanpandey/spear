import { describe, it, expect } from "vitest";
import { findDuplicates, type DupCandidate, type ExistingTaskRef } from "./duplicates.js";

const opts = { model: "sonnet", effort: "low" as const };
const candidates: DupCandidate[] = [{ title: "Fix login button" }, { title: "Write Q3 report" }];
const existing: ExistingTaskRef[] = [
  { id: 5, title: "Login button unresponsive on mobile", status: "todo" },
  { id: 6, title: "Renew SSL cert", status: "done" },
];

describe("findDuplicates", () => {
  it("returns validated matches keyed to candidate index + existing id", async () => {
    const run = async () => ({ matches: [{ candidate_index: 0, task_id: 5, reason: "same login button bug" }] });
    const out = await findDuplicates(candidates, existing, opts, run);
    expect(out).toEqual([{ candidateIndex: 0, taskId: 5, reason: "same login button bug" }]);
  });

  it("drops matches with an out-of-range candidate index or unknown task id", async () => {
    const run = async () => ({
      matches: [
        { candidate_index: 9, task_id: 5, reason: "bad index" },
        { candidate_index: 0, task_id: 999, reason: "unknown task" },
      ],
    });
    const out = await findDuplicates(candidates, existing, opts, run);
    expect(out).toHaveLength(0);
  });

  it("short-circuits without calling the runner when there are no candidates or none existing", async () => {
    let called = false;
    const run = async () => {
      called = true;
      return { matches: [] };
    };
    expect(await findDuplicates([], existing, opts, run)).toEqual([]);
    expect(await findDuplicates(candidates, [], opts, run)).toEqual([]);
    expect(called).toBe(false);
  });
});

# spear v0.1.18 Implementation Plan — intake, type toggle, feature flow, suggested due, lane count

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multimodal/multi-task intake (image + text → 1..N tasks), an Auto/Task/Feature toggle, reliable feature breakdown (planning+impl+testing), pre-computed suggested due dates, and a configurable lane count — then ship v0.1.18.

**Architecture:** All intelligence stays in the Claude CLI (no deterministic planning logic). New isolated modules: `llm/intake.ts` (extraction), `llm/suggestDue.ts` (due suggestions), `server/intake.ts` + `server/suggestDuePass.ts` (testable orchestration with injected runners). The breakdown prompt is strengthened for features; an `intent` field forces task/feature. Two new task columns store the pre-computed suggestion. The lane count reuses the existing `cfg.maxLanes` → planner path.

**Tech Stack:** Node/TS ESM, better-sqlite3, Fastify, React/Vite, vitest, zod/v4, the `claude` CLI (`claude -p --output-format json`).

**Spec:** `docs/superpowers/specs/2026-06-16-intake-type-toggle-feature-flow-suggested-due-design.md`

**Spike already done:** `claude -p "<prompt referencing /tmp/img.png>" --output-format json --allowedTools Read --effort low` reads a local image and returns JSON (`permission_denials: []`, ~10s). Feature A's image path is confirmed.

---

## File Structure

**New files**
- `src/llm/intake.ts` — `extractTaskSeeds()` (prompt + optional image → task seeds).
- `src/llm/suggestDue.ts` — `suggestDueDates()` (board snapshot → per-undated-task suggestion).
- `src/server/intake.ts` — `intakeTasks()` + `mimeExt()` (orchestrate extraction → parallel breakdown → addTask).
- `src/server/suggestDuePass.ts` — `runSuggestedDuePass()` (snapshot → suggest → store).
- Test files alongside each (`*.test.ts`).

**Modified files**
- `src/llm/cli.ts` — add `allowedTools` opt; extract `buildClaudeArgs()`.
- `src/llm/schemas.ts` — `IntakeSchema`, `SuggestDueSchema`.
- `src/llm/breakdown.ts` — `intent` handling + feature-stage prompt; export `buildPrompt`.
- `src/breakdown/index.ts` — add `intent` to `BreakdownRequest`.
- `src/db/schema.ts`, `src/db/index.ts` — new columns + migration.
- `src/db/store.ts`, `src/types.ts` — `suggested_due` / `suggested_due_reason` + `setSuggestedDue()`.
- `src/server/dto.ts` — expose suggestion on `TodayItemDto`.
- `src/server/app.ts` — intake route, config routes, boot backfill call.
- `src/server/replan.ts` — run the suggested-due pass after each plan.
- `src/web/api.ts` — `TodayItem` fields, `createTasksFromIntake()`, `fetchConfig()`, `setMaxLanes()`.
- `src/web/components/AddTask.tsx` — intent select + image paste.
- `src/web/components/Today.tsx` — suggestion chip in `DueEditor`.
- `src/web/App.tsx` — lane-count selector.
- `src/web/styles.css` — chip + lane-control styles.
- `src/commands/add.ts` — `--task` / `--feature` flags.
- `package.json` — version bump.

---

## Task 1: CLI runner — `allowedTools` option + testable arg builder

**Files:**
- Modify: `src/llm/cli.ts`
- Test: `src/llm/cli.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/llm/cli.test.ts`:

```ts
import { buildClaudeArgs } from "./cli.js";

describe("buildClaudeArgs", () => {
  it("includes model, effort and allowedTools when provided", () => {
    const args = buildClaudeArgs("hi", { model: "m", effort: "low", allowedTools: ["Read"] });
    expect(args.slice(0, 4)).toEqual(["-p", "hi", "--output-format", "json"]);
    expect(args).toContain("--model");
    expect(args).toContain("--effort");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read");
  });

  it("omits allowedTools when not provided", () => {
    const args = buildClaudeArgs("hi", {});
    expect(args).not.toContain("--allowedTools");
  });

  it("joins multiple allowed tools with a space", () => {
    const args = buildClaudeArgs("hi", { allowedTools: ["Read", "Glob"] });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("Read Glob");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/llm/cli.test.ts -t buildClaudeArgs`
Expected: FAIL — `buildClaudeArgs is not a function`.

- [ ] **Step 3: Implement** — in `src/llm/cli.ts`, add `allowedTools` to `ClaudeOpts` and extract the arg builder. Replace the `ClaudeOpts` interface and the body of `claudeJson` that builds args:

In `ClaudeOpts`, add after `timeoutMs?: number;`:
```ts
  /** Tool names to allow in headless mode (e.g. ["Read"] so the model can open an attached image). */
  allowedTools?: string[];
```

Add this exported function just above `export const claudeJson`:
```ts
/** Build the argv for a `claude -p` headless JSON call. Pure, so it can be unit-tested. */
export function buildClaudeArgs(prompt: string, opts: ClaudeOpts): string[] {
  const args = ["-p", prompt, "--output-format", "json"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.allowedTools && opts.allowedTools.length) args.push("--allowedTools", opts.allowedTools.join(" "));
  return args;
}
```

In `claudeJson`, replace the inline arg construction:
```ts
  const args = ["-p", prompt, "--output-format", "json"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
```
with:
```ts
  const args = buildClaudeArgs(prompt, opts);
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/llm/cli.test.ts`
Expected: PASS (all cli tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/cli.ts src/llm/cli.test.ts
git commit -m "feat(cli): allowedTools option + testable buildClaudeArgs"
```

---

## Task 2: Intake extraction module (`extractTaskSeeds`)

**Files:**
- Create: `src/llm/intake.ts`
- Modify: `src/llm/schemas.ts`
- Test: `src/llm/intake.test.ts`

- [ ] **Step 1: Add the schema** — append to `src/llm/schemas.ts`:

```ts
// ---- Intake (image/text → task seeds) ----

export const IntakeSchema = z.object({
  seeds: z.array(
    z.object({
      title: z.string().describe("Short imperative task title"),
      details: z.string().describe("One or two sentences of context for the breakdown"),
    }),
  ),
});
export type IntakeOutput = z.infer<typeof IntakeSchema>;
```

- [ ] **Step 2: Write the failing test** — create `src/llm/intake.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractTaskSeeds } from "./intake.js";

const opts = { model: "m", effort: "low" as const };

describe("extractTaskSeeds", () => {
  it("returns the model's seeds", async () => {
    const run = async () => ({
      seeds: [
        { title: "Fix login", details: "login button dead on safari" },
        { title: "Add CSV export", details: "reports page" },
      ],
    });
    const seeds = await extractTaskSeeds("from this image", "/tmp/x.png", opts, run);
    expect(seeds).toHaveLength(2);
    expect(seeds[0].title).toBe("Fix login");
  });

  it("falls back to a single seed from the prompt when the model returns none", async () => {
    const run = async () => ({ seeds: [] });
    const seeds = await extractTaskSeeds("just one thing to do", undefined, opts, run);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].title).toBe("just one thing to do");
  });

  it("passes allowedTools:[Read] to the runner when an image is attached", async () => {
    let seen: any;
    const run = async (_p: string, o: any) => {
      seen = o;
      return { seeds: [{ title: "t", details: "d" }] };
    };
    await extractTaskSeeds("p", "/tmp/x.png", opts, run);
    expect(seen.allowedTools).toEqual(["Read"]);
  });

  it("does not set allowedTools when there is no image", async () => {
    let seen: any;
    const run = async (_p: string, o: any) => {
      seen = o;
      return { seeds: [{ title: "t", details: "d" }] };
    };
    await extractTaskSeeds("p", undefined, opts, run);
    expect(seen.allowedTools).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run src/llm/intake.test.ts`
Expected: FAIL — cannot find module `./intake.js`.

- [ ] **Step 4: Implement** — create `src/llm/intake.ts`:

```ts
import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { IntakeSchema } from "./schemas.js";

export interface TaskSeed {
  title: string;
  details: string;
}

const SYSTEM = `You turn a founder's raw capture into a list of distinct, actionable task seeds for a task tracker.

Rules:
- Identify each SEPARATE actionable task. If the input (text and/or image) describes one thing, return one seed; if it lists several, return one seed per item.
- Each seed: a short imperative "title" and one or two sentences of "details" giving the breakdown step enough context.
- Do NOT plan, prioritize, or break into stages — that happens later. Just split and summarize.
- Output ONLY a JSON object: {"seeds":[{"title":string,"details":string}]} — no prose, no markdown fences.`;

function buildPrompt(prompt: string, imagePath?: string): string {
  let s = SYSTEM + "\n\n";
  if (imagePath) s += `An image is attached at ${imagePath}. Read it and use its contents.\n`;
  s += `Capture:\n${prompt || "(no text — use the image)"}`;
  return s;
}

/**
 * Extract 1..N task seeds from a prompt and optional image. When an image is
 * attached the runner is told it may use the Read tool to open it. Falls back to
 * a single seed built from the prompt if the model returns none.
 */
export async function extractTaskSeeds(
  prompt: string,
  imagePath: string | undefined,
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<TaskSeed[]> {
  const callOpts: ClaudeOpts = { ...opts };
  if (imagePath) callOpts.allowedTools = ["Read"];
  const parsed = await claudeStructured(buildPrompt(prompt, imagePath), (x) => IntakeSchema.parse(x), callOpts, run);
  if (!parsed.seeds.length) return [{ title: prompt.trim() || "Untitled task", details: prompt.trim() }];
  return parsed.seeds;
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run src/llm/intake.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/llm/intake.ts src/llm/intake.test.ts src/llm/schemas.ts
git commit -m "feat(llm): intake extraction — image/text to task seeds"
```

---

## Task 3: Breakdown — `intent` (task/feature) + feature-stage prompt

**Files:**
- Modify: `src/breakdown/index.ts` (add `intent` to `BreakdownRequest`)
- Modify: `src/llm/breakdown.ts` (prompt + normalize; export `buildPrompt`)
- Test: `src/llm/breakdown.test.ts`

- [ ] **Step 1: Add `intent` to the request type** — in `src/breakdown/index.ts`, inside `BreakdownRequest`, add after `forcedType?: TaskType;`:

```ts
  /** Explicit capture intent: 'feature' forces the full feature flow, 'task' forces a lean non-feature. */
  intent?: "task" | "feature";
```

- [ ] **Step 2: Write the failing tests** — append to `src/llm/breakdown.test.ts`:

```ts
import { buildPrompt } from "./breakdown.js";

describe("intent handling", () => {
  const stages = [{ name: "s", kind: "generic", effort: "small", delegatable_to: ["self"] }];

  it("forces type=feature when intent is feature", async () => {
    const run = async () => ({ title: "T", type: "chore", priority: "medium", effort: "small", stages });
    const res = await llmBreakdown({ ...req, intent: "feature" }, run);
    expect(res.type).toBe("feature");
  });

  it("coerces a feature classification to chore when intent is task", async () => {
    const run = async () => ({ title: "T", type: "feature", priority: "medium", effort: "small", stages });
    const res = await llmBreakdown({ ...req, intent: "task" }, run);
    expect(res.type).toBe("chore");
  });

  it("buildPrompt asks for the 3-stage feature flow and the feature intent line", () => {
    const p = buildPrompt({ ...req, intent: "feature" });
    expect(p).toMatch(/Planning/);
    expect(p).toMatch(/Implementation/);
    expect(p).toMatch(/Testing/);
    expect(p).toMatch(/FEATURE/);
  });

  it("buildPrompt marks a task-intent capture as a simple task", () => {
    const p = buildPrompt({ ...req, intent: "task" });
    expect(p).toMatch(/simple TASK/);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run src/llm/breakdown.test.ts -t "intent handling"`
Expected: FAIL — `buildPrompt` not exported / intent not honored.

- [ ] **Step 4: Implement** — edit `src/llm/breakdown.ts`.

Replace the stages bullet in `SYSTEM` (the line starting "- Break the work into the smallest sensible set…") with:
```ts
- Break the work into the smallest sensible set of sequential stages. Use kind "generic" unless a stage is clearly planning/implementation/testing/stage_testing. IF the resolved type is "feature", you MUST output at least three stages in order — Planning, Implementation, Testing — and add a Stage Testing stage when staging/QA applies. For non-features use the fewest stages that fit (often just one); don't add ceremony a small task doesn't need.
```

Export `buildPrompt` and extend it with the intent lines — replace the existing `function buildPrompt(req: BreakdownRequest): string { ... }` with:
```ts
export function buildPrompt(req: BreakdownRequest): string {
  let s = `${SYSTEM}\n\n${SHAPE}\n\nTask: ${req.title}`;
  if (req.description) s += `\nDetails: ${req.description}`;
  if (req.forcedType) s += `\nThe task type is "${req.forcedType}" — use it.`;
  if (req.intent === "feature") {
    s += `\nThis is a FEATURE. Set type to "feature" and produce the full Planning → Implementation → Testing flow (add Stage Testing if staging QA applies).`;
  } else if (req.intent === "task") {
    s += `\nThis is a simple TASK, not a feature. Keep it lean — usually a single stage. Classify the type among bug/chore/research/other; never "feature".`;
  }
  return s;
}
```

In `normalize`, replace `type: req.forcedType ?? parsed.type,` with a resolved type:
```ts
  let type = req.forcedType ?? parsed.type;
  if (req.intent === "feature") type = "feature";
  else if (req.intent === "task" && type === "feature") type = "chore";
```
and use `type,` in the returned object (replace the `type: req.forcedType ?? parsed.type,` line with `type,`).

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run src/llm/breakdown.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add src/llm/breakdown.ts src/breakdown/index.ts src/llm/breakdown.test.ts
git commit -m "feat(breakdown): task/feature intent + enforced feature stages (prompt-only)"
```

---

## Task 4: DB columns + store support for suggested due

**Files:**
- Modify: `src/db/schema.ts`, `src/db/index.ts`, `src/db/store.ts`, `src/types.ts`
- Test: `src/db/store.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/db/store.test.ts` (it already opens an in-memory store; mirror its existing setup — use the same `makeStore()`/`openDb(":memory:")` helper the file uses at the top):

```ts
describe("suggested due", () => {
  it("stores and returns a suggested due date + reason", () => {
    const store = makeStore();
    const t = store.createTask({ title: "x" });
    store.setSuggestedDue(t.id, "2026-06-20", "high priority, light load that day");
    const got = store.getTask(t.id)!;
    expect(got.suggested_due).toBe("2026-06-20");
    expect(got.suggested_due_reason).toBe("high priority, light load that day");
  });

  it("defaults to null for a fresh task", () => {
    const store = makeStore();
    const t = store.createTask({ title: "y" });
    expect(store.getTask(t.id)!.suggested_due).toBeNull();
  });
});
```

> If `src/db/store.test.ts` uses a different store-construction helper, reuse that exact helper instead of `makeStore()`.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/db/store.test.ts -t "suggested due"`
Expected: FAIL — `setSuggestedDue` not a function / `suggested_due` undefined.

- [ ] **Step 3: Implement.**

In `src/db/schema.ts`, add the two columns to the `tasks` CREATE TABLE (after `due TEXT,`):
```ts
  suggested_due TEXT,
  suggested_due_reason TEXT,
```

In `src/db/index.ts`, extend `migrate()` so existing DBs gain the columns:
```ts
function migrate(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map((r) => r.name);
  if (!cols.includes("lane")) db.exec("ALTER TABLE tasks ADD COLUMN lane INTEGER");
  if (!cols.includes("suggested_due")) db.exec("ALTER TABLE tasks ADD COLUMN suggested_due TEXT");
  if (!cols.includes("suggested_due_reason")) db.exec("ALTER TABLE tasks ADD COLUMN suggested_due_reason TEXT");
}
```

In `src/types.ts`, add to the `Task` interface (after `due: string | null;`):
```ts
  /** LLM-suggested due date for tasks without a real deadline (and a short reason). */
  suggested_due: string | null;
  suggested_due_reason: string | null;
```

In `src/db/store.ts`, add the two fields to the `TaskRow` interface (after `due: string | null;`):
```ts
  suggested_due: string | null;
  suggested_due_reason: string | null;
```
`mapTask` spreads `...r`, so no change is needed there. Add a setter method inside the `// ---- tasks ----` section (e.g. after `setTaskLane`):
```ts
  /** Store the pre-computed due-date suggestion (plan-internal; does not bump updated_at). */
  setSuggestedDue(id: number, date: string | null, reason: string | null): void {
    this.db.prepare("UPDATE tasks SET suggested_due = ?, suggested_due_reason = ? WHERE id = ?").run(date, reason, id);
  }
```

> Note: `updateTask`'s explicit UPDATE does not list these columns, so they persist untouched across normal updates (same pattern as `lane`/`created_at`, which are already extra keys in its bound object).

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/db/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/index.ts src/db/store.ts src/types.ts src/db/store.test.ts
git commit -m "feat(db): suggested_due columns + setSuggestedDue + migration"
```

---

## Task 5: Suggested-due LLM module (`suggestDueDates`)

**Files:**
- Create: `src/llm/suggestDue.ts`
- Modify: `src/llm/schemas.ts`
- Test: `src/llm/suggestDue.test.ts`

- [ ] **Step 1: Add the schema** — append to `src/llm/schemas.ts`:

```ts
// ---- Suggested due dates ----

export const SuggestDueSchema = z.object({
  suggestions: z.array(
    z.object({
      task_id: z.number().int(),
      date: z.string().describe("YYYY-MM-DD, today or later"),
      reason: z.string().describe("One short clause: why this date"),
    }),
  ),
});
export type SuggestDueOutput = z.infer<typeof SuggestDueSchema>;
```

- [ ] **Step 2: Write the failing test** — create `src/llm/suggestDue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { suggestDueDates, type DueSnapshotTask } from "./suggestDue.js";

const opts = { model: "m", effort: "low" as const };
const tasks: DueSnapshotTask[] = [
  { id: 1, title: "ship", type: "feature", priority: "high", status: "todo", effort: "large", due: null, stageCount: 3 },
  { id: 2, title: "note", type: "chore", priority: "low", status: "todo", effort: "small", due: null, stageCount: 1 },
];

describe("suggestDueDates", () => {
  it("returns valid future-dated suggestions keyed by task id", async () => {
    const run = async () => ({
      suggestions: [
        { task_id: 1, date: "2026-06-18", reason: "high priority feature" },
        { task_id: 2, date: "2026-06-25", reason: "low priority, defer" },
      ],
    });
    const out = await suggestDueDates("2026-06-16", tasks, opts, run);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ taskId: 1, date: "2026-06-18", reason: "high priority feature" });
  });

  it("drops malformed, past, and unknown-task suggestions", async () => {
    const run = async () => ({
      suggestions: [
        { task_id: 1, date: "not-a-date", reason: "bad" },
        { task_id: 2, date: "2026-06-01", reason: "in the past" },
        { task_id: 99, date: "2026-06-20", reason: "unknown task" },
      ],
    });
    const out = await suggestDueDates("2026-06-16", tasks, opts, run);
    expect(out).toHaveLength(0);
  });

  it("accepts a same-day (today) suggestion", async () => {
    const run = async () => ({ suggestions: [{ task_id: 1, date: "2026-06-16", reason: "do today" }] });
    const out = await suggestDueDates("2026-06-16", tasks, opts, run);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-06-16");
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run src/llm/suggestDue.test.ts`
Expected: FAIL — cannot find module `./suggestDue.js`.

- [ ] **Step 4: Implement** — create `src/llm/suggestDue.ts`:

```ts
import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { SuggestDueSchema } from "./schemas.js";
import { parseDateLocal } from "../util/time.js";
import type { Effort, Priority, TaskStatus, TaskType } from "../types.js";

export interface DueSnapshotTask {
  id: number;
  title: string;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  effort: Effort | null;
  due: string | null;
  stageCount: number;
}

export interface DueSuggestion {
  taskId: number;
  date: string;
  reason: string;
}

const SYSTEM = `You suggest a realistic due date for each undated task on a founder's board.

Consider:
- Priority: critical/high should land sooner; low can be deferred.
- Effort and stageCount: larger / multi-stage work needs more lead time.
- The OTHER tasks and their existing due dates: spread deadlines out — do not pile everything on one day.
- All dates must be today or later, formatted YYYY-MM-DD.

Output ONLY a JSON object: {"suggestions":[{"task_id":number,"date":"YYYY-MM-DD","reason":string}]} — one entry per undated task, no prose, no fences.`;

function buildPrompt(today: string, tasks: DueSnapshotTask[]): string {
  return `${SYSTEM}\n\nToday is ${today}.\nBoard:\n${JSON.stringify(tasks)}`;
}

/**
 * Ask the Claude CLI to suggest a due date for each task in `tasks` that has no
 * real deadline. Returns only well-formed suggestions: a parseable date that is
 * today-or-later, for a task id present in the snapshot. Drops the rest.
 */
export async function suggestDueDates(
  today: string,
  tasks: DueSnapshotTask[],
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<DueSuggestion[]> {
  const undated = tasks.filter((t) => !t.due);
  if (undated.length === 0) return [];
  const ids = new Set(undated.map((t) => t.id));
  const todayDate = parseDateLocal(today);
  const parsed = await claudeStructured(buildPrompt(today, undated), (x) => SuggestDueSchema.parse(x), opts, run);

  const out: DueSuggestion[] = [];
  for (const s of parsed.suggestions) {
    if (!ids.has(s.task_id)) continue;
    const d = parseDateLocal(s.date);
    if (!d || !todayDate) continue;
    if (d.getTime() < todayDate.getTime()) continue; // no past dates
    out.push({ taskId: s.task_id, date: s.date, reason: s.reason });
  }
  return out;
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run src/llm/suggestDue.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/llm/suggestDue.ts src/llm/schemas.ts src/llm/suggestDue.test.ts
git commit -m "feat(llm): suggestDueDates — per-undated-task due suggestions"
```

---

## Task 6: Suggested-due pass (snapshot → suggest → store)

**Files:**
- Create: `src/server/suggestDuePass.ts`
- Test: `src/server/suggestDuePass.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/server/suggestDuePass.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/server/suggestDuePass.test.ts`
Expected: FAIL — cannot find module `./suggestDuePass.js`.

- [ ] **Step 3: Implement** — create `src/server/suggestDuePass.ts`:

```ts
import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { todayLocal } from "../util/time.js";
import { suggestDueDates, type DueSnapshotTask } from "../llm/suggestDue.js";
import { claudeJson, type ClaudeRunner } from "../llm/cli.js";

/**
 * Snapshot every open, undated task, ask the LLM for due-date suggestions, and
 * store them. Best-effort: returns the number stored. The caller runs this in the
 * background after a re-plan, so the UI only ever reads the stored values.
 */
export async function runSuggestedDuePass(
  store: Store,
  cfg: SpearConfig,
  today: string = todayLocal(),
  run: ClaudeRunner = claudeJson,
): Promise<number> {
  const snapshot: DueSnapshotTask[] = store
    .listOpenTasks()
    .filter((t) => !t.due)
    .map((t) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      priority: t.priority,
      status: t.status,
      effort: t.effort,
      due: t.due,
      stageCount: store.getStages(t.id).length,
    }));
  if (snapshot.length === 0) return 0;

  const suggestions = await suggestDueDates(today, snapshot, { model: cfg.models.breakdown, effort: "low" }, run);
  for (const s of suggestions) {
    const task = store.getTask(s.taskId);
    if (task && !task.due) store.setSuggestedDue(s.taskId, s.date, s.reason);
  }
  return suggestions.length;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/server/suggestDuePass.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/suggestDuePass.ts src/server/suggestDuePass.test.ts
git commit -m "feat(server): suggested-due pass (snapshot to stored suggestions)"
```

---

## Task 7: Wire the suggested-due pass into the Replanner + boot

**Files:**
- Modify: `src/server/replan.ts`, `src/server/app.ts`

- [ ] **Step 1: Implement — Replanner runs the pass after each plan.** In `src/server/replan.ts`, add the import at the top:

```ts
import { runSuggestedDuePass } from "./suggestDuePass.js";
```

Replace the `private async run(...)` body's tail so the pass runs after a successful plan, then broadcasts a refresh:

```ts
  private async run(trigger: PlanTrigger): Promise<void> {
    this.hub.broadcast({ type: "replan", phase: "start" });
    const { error } = await buildAndSavePlan(this.store, this.cfg, trigger);
    if (error) process.stderr.write(`spear: re-plan failed (${error})\n`);
    this.hub.broadcast({ type: "replan", phase: "end", ...(error ? { error } : {}) });
    void this.refreshSuggestedDue();
  }

  /** Background, best-effort: recompute stored due-date suggestions for undated tasks. */
  async refreshSuggestedDue(): Promise<void> {
    try {
      const n = await runSuggestedDuePass(this.store, this.cfg);
      if (n > 0) this.hub.broadcast({ type: "update", source: "refresh" });
    } catch (err) {
      process.stderr.write(`spear: suggested-due pass failed (${err instanceof Error ? err.message : String(err)})\n`);
    }
  }
```

- [ ] **Step 2: Implement — boot backfill.** In `src/server/app.ts`, in `startServer`, after `await server.app.listen(...)`, kick a one-time pass:

```ts
export async function startServer(store: Store, cfg: SpearConfig, port: number): Promise<SpearServer> {
  const server = buildServer(store, cfg);
  await server.app.listen({ port, host: "127.0.0.1" });
  void server.replanner.refreshSuggestedDue(); // backfill suggestions for any undated tasks
  return server;
}
```

- [ ] **Step 3: Verify the build + full suite still pass**

Run: `npm run typecheck && npx vitest run`
Expected: PASS (no behavioral test here; this is wiring covered by Task 6's unit tests).

- [ ] **Step 4: Commit**

```bash
git add src/server/replan.ts src/server/app.ts
git commit -m "feat(server): run suggested-due pass after replan + on boot"
```

---

## Task 8: Expose the suggestion in DTO + web types

**Files:**
- Modify: `src/server/dto.ts`, `src/web/api.ts`
- Test: `src/server/dto.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/server/dto.test.ts` (reuse the file's existing store/plan setup helpers; the snippet below assumes a helper that builds a store with one planned task — adapt to the file's actual helpers):

```ts
describe("todayDto suggested due", () => {
  it("includes the stored suggestion on the item", () => {
    const { store } = seedPlannedBoard(); // existing helper that returns a store w/ a current plan
    const task = store.listTasks()[0];
    store.setSuggestedDue(task.id, "2026-06-22", "balanced load");
    const dto = todayDto(store);
    const item = dto.lanes[0].items[0];
    expect(item.suggestedDue).toBe("2026-06-22");
    expect(item.suggestedDueReason).toBe("balanced load");
  });
});
```

> If `src/server/dto.test.ts` lacks a `seedPlannedBoard()` helper, build the store inline the way the existing tests in that file do (create task + stage + `savePlan`), then assert the two new fields.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/server/dto.test.ts -t "suggested due"`
Expected: FAIL — `suggestedDue` is undefined on the item.

- [ ] **Step 3: Implement.** In `src/server/dto.ts`, add to the `TodayItemDto` interface (after `due: string | null;`):

```ts
  suggestedDue: string | null;
  suggestedDueReason: string | null;
```

In `todayDto`, where each item is pushed (`laneMap.get(it.lane)!.push({ ... due: task.due, ...})`), add after `due: task.due,`:

```ts
      suggestedDue: task.suggested_due,
      suggestedDueReason: task.suggested_due_reason,
```

In `src/web/api.ts`, add to the `TodayItem` interface (after `due: string | null;`):

```ts
  suggestedDue: string | null;
  suggestedDueReason: string | null;
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/server/dto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/dto.ts src/web/api.ts src/server/dto.test.ts
git commit -m "feat(dto): expose suggestedDue on Today items"
```

---

## Task 9: Intake orchestration (`intakeTasks` + `mimeExt`)

**Files:**
- Create: `src/server/intake.ts`
- Test: `src/server/intake.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/server/intake.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { intakeTasks, mimeExt } from "./intake.js";

function makeStore(): Store {
  return new Store(openDb(":memory:"));
}

describe("mimeExt", () => {
  it("maps known mime types and defaults to png", () => {
    expect(mimeExt("image/jpeg")).toBe("jpg");
    expect(mimeExt("image/webp")).toBe("webp");
    expect(mimeExt(undefined)).toBe("png");
  });
});

describe("intakeTasks", () => {
  const breakdownRun = async () => ({
    title: "Cleaned",
    type: "chore",
    priority: "medium",
    effort: "small",
    stages: [{ name: "do it", kind: "generic", effort: "small", delegatable_to: ["self"] }],
  });

  it("creates one task per extracted seed", async () => {
    const store = makeStore();
    const extract = async () => [
      { title: "one", details: "d1" },
      { title: "two", details: "d2" },
    ];
    const { taskIds } = await intakeTasks(store, DEFAULT_CONFIG, { prompt: "p" }, { extract, breakdownRun });
    expect(taskIds).toHaveLength(2);
    expect(store.listTasks()).toHaveLength(2);
  });

  it("applies the chosen priority to every seed", async () => {
    const store = makeStore();
    const extract = async () => [{ title: "one", details: "d1" }];
    await intakeTasks(store, DEFAULT_CONFIG, { prompt: "p", priority: "high" }, { extract, breakdownRun });
    expect(store.listTasks()[0].priority).toBe("high");
  });

  it("inserts the seeds that succeed even if one breakdown throws", async () => {
    const store = makeStore();
    const extract = async () => [
      { title: "ok", details: "d" },
      { title: "boom", details: "d" },
    ];
    let n = 0;
    const flaky = async () => {
      n += 1;
      if (n === 2) throw new Error("breakdown failed");
      return {
        title: "ok",
        type: "chore",
        priority: "medium",
        effort: "small",
        stages: [{ name: "s", kind: "generic", effort: "small", delegatable_to: ["self"] }],
      };
    };
    const { taskIds } = await intakeTasks(store, DEFAULT_CONFIG, { prompt: "p" }, { extract, breakdownRun: flaky });
    expect(taskIds).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/server/intake.test.ts`
Expected: FAIL — cannot find module `./intake.js`.

- [ ] **Step 3: Implement** — create `src/server/intake.ts`:

```ts
import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { Priority } from "../types.js";
import { addTask } from "../service.js";
import { breakdownForAdd } from "../breakdown/index.js";
import { extractTaskSeeds, type TaskSeed } from "../llm/intake.js";
import type { ClaudeRunner } from "../llm/cli.js";

export interface IntakeParams {
  prompt: string;
  imagePath?: string;
  intent?: "task" | "feature";
  priority?: Priority;
}

export interface IntakeDeps {
  /** Override the extraction step (tests). */
  extract?: (prompt: string, imagePath: string | undefined, opts: { model: string; effort: "low" }) => Promise<TaskSeed[]>;
  /** Runner for the per-seed breakdown (tests). */
  breakdownRun?: ClaudeRunner;
}

/** image/* mime → file extension for the temp file the model reads. */
export function mimeExt(mime?: string): string {
  switch (mime) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

/**
 * Turn a capture (prompt + optional image) into 1..N tasks: extract seeds, then
 * break each down in parallel and insert it. Per-seed failures are skipped (the
 * rest still land). Returns the ids of the tasks created. Does NOT re-plan — the
 * caller decides when to trigger that.
 */
export async function intakeTasks(
  store: Store,
  cfg: SpearConfig,
  params: IntakeParams,
  deps: IntakeDeps = {},
): Promise<{ taskIds: number[] }> {
  const extract =
    deps.extract ??
    ((prompt: string, imagePath: string | undefined) =>
      extractTaskSeeds(prompt, imagePath, { model: cfg.models.breakdown, effort: "low" }));
  const seeds = await extract(params.prompt, params.imagePath, { model: cfg.models.breakdown, effort: "low" });

  const settled = await Promise.allSettled(
    seeds.map(async (seed) => {
      const broken = await breakdownForAdd(
        {
          title: seed.title,
          description: seed.details,
          intent: params.intent,
          model: cfg.models.breakdown,
          effort: cfg.effort.breakdown,
          explicitPriority: params.priority,
        },
        deps.breakdownRun,
      );
      return addTask(store, {
        title: broken.title,
        description: seed.details,
        type: broken.type,
        priority: broken.priority,
        stages: broken.stages,
        source: "web",
      }).task.id;
    }),
  );

  const taskIds = settled.filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled").map((r) => r.value);
  return { taskIds };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/server/intake.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/intake.ts src/server/intake.test.ts
git commit -m "feat(server): intake orchestration — seeds to parallel breakdown to tasks"
```

---

## Task 10: Intake HTTP route + config routes

**Files:**
- Modify: `src/server/app.ts`

- [ ] **Step 1: Add imports.** At the top of `src/server/app.ts`, add:

```ts
import os from "node:os";
import { randomUUID } from "node:crypto";
import { loadConfig, saveConfig } from "../config/index.js";
import { intakeTasks, mimeExt } from "./intake.js";
```

> `fs` and `path` are already imported. `loadConfig` may be unused here — only add it if `saveConfig` needs a sibling; otherwise import just `saveConfig`.

- [ ] **Step 2: Add the intake route.** In `buildServer`, right after the existing `app.post("/api/tasks", ...)` handler, add:

```ts
  // ---- multimodal / multi-task intake (image + text → 1..N tasks) ----
  app.post("/api/tasks/intake", async (req, reply) => {
    const body = (req.body ?? {}) as {
      prompt?: string;
      intent?: string;
      priority?: string;
      image?: { mime?: string; dataB64?: string };
    };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const hasImage = !!body.image?.dataB64;
    if (!prompt && !hasImage) {
      reply.code(400);
      return { error: "prompt or image required" };
    }
    const explicitPriority = body.priority ? (body.priority as Priority) : undefined;
    if (explicitPriority && !PRIORITIES.includes(explicitPriority)) {
      reply.code(400);
      return { error: "invalid priority" };
    }
    const intent = body.intent === "task" || body.intent === "feature" ? body.intent : undefined;

    let imagePath: string | undefined;
    if (hasImage) {
      imagePath = path.join(os.tmpdir(), `spear-intake-${randomUUID()}.${mimeExt(body.image!.mime)}`);
      fs.writeFileSync(imagePath, Buffer.from(body.image!.dataB64!, "base64"));
    }
    try {
      const { taskIds } = await intakeTasks(store, cfg, { prompt, imagePath, intent, priority: explicitPriority });
      if (taskIds.length === 0) {
        reply.code(502);
        return { error: "no tasks could be created" };
      }
      replanner.requestReplan("adhoc");
      return { count: taskIds.length, taskIds };
    } catch (err) {
      reply.code(502);
      return { error: `intake failed: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (imagePath) {
        try {
          fs.unlinkSync(imagePath);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  });

  // ---- config (lane count) ----
  app.get("/api/config", async () => ({ maxLanes: cfg.maxLanes }));

  app.post("/api/config/lanes", async (req, reply) => {
    const body = (req.body ?? {}) as { lanes?: number };
    const n = Number(body.lanes);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      reply.code(400);
      return { error: "lanes must be an integer 1–8" };
    }
    cfg.maxLanes = n; // mutate the object the Replanner holds, so the next plan uses it
    saveConfig(cfg); // persist for next boot
    replanner.requestReplan("manual"); // reorder everything into the new lane count
    return { maxLanes: n };
  });
```

- [ ] **Step 3: Verify build + suite.**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. (If `loadConfig` import is unused, remove it to satisfy `noUnusedLocals`.)

- [ ] **Step 4: Manual smoke (optional but recommended).** Start the server and hit the routes:

```bash
npm run build
node dist/cli.js serve --port 4399 &
curl -s localhost:4399/api/config
curl -s -X POST localhost:4399/api/config/lanes -H 'content-type: application/json' -d '{"lanes":3}'
curl -s -X POST localhost:4399/api/tasks/intake -H 'content-type: application/json' -d '{"prompt":"fix the login bug and add csv export"}'
kill %1
```
Expected: `{"maxLanes":6}` then `{"maxLanes":3}`, and the intake returns `{"count":N,...}` (N≥1) after ~20s.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts
git commit -m "feat(server): /api/tasks/intake + /api/config lane routes"
```

---

## Task 11: Web client — intake + config helpers

**Files:**
- Modify: `src/web/api.ts`

- [ ] **Step 1: Implement.** In `src/web/api.ts`, add an `Intent` type near the top type aliases:

```ts
export type Intent = "task" | "feature";
```

Add these functions in the `// ---- task create / actions ----` section (after `createTask`):

```ts
/**
 * Multimodal / multi-task intake: a prompt and/or a pasted image become 1..N
 * tasks. `imageDataUrl` is a `data:<mime>;base64,<...>` string (from a paste).
 */
export async function createTasksFromIntake(params: {
  prompt: string;
  imageDataUrl?: string;
  intent?: Intent;
  priority?: Priority;
}): Promise<{ count: number; taskIds: number[] }> {
  const body: {
    prompt: string;
    intent?: Intent;
    priority?: Priority;
    image?: { mime: string; dataB64: string };
  } = { prompt: params.prompt };
  if (params.intent) body.intent = params.intent;
  if (params.priority) body.priority = params.priority;
  if (params.imageDataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(params.imageDataUrl);
    if (m) body.image = { mime: m[1], dataB64: m[2] };
  }
  const r = await fetch("/api/tasks/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`intake ${r.status}`);
  return r.json();
}

export async function fetchConfig(): Promise<{ maxLanes: number }> {
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error(`config ${r.status}`);
  return r.json();
}

/** Set the planner's lane count; the server persists it and re-plans. */
export async function setMaxLanes(lanes: number): Promise<{ maxLanes: number }> {
  const r = await fetch("/api/config/lanes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lanes }),
  });
  if (!r.ok) throw new Error(`lanes ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Verify build.**

Run: `npm run build:web`
Expected: builds without type errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/api.ts
git commit -m "feat(web): intake + lane-config API client"
```

---

## Task 12: AddTask UI — intent select + image paste

**Files:**
- Modify: `src/web/components/AddTask.tsx`, `src/web/styles.css`

- [ ] **Step 1: Implement the component.** Replace the body of `src/web/components/AddTask.tsx` with:

```tsx
import { useState } from "react";
import { createTasksFromIntake, type Intent, type Priority } from "../api";

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

/**
 * Inline capture for the Today tab. Routes through /api/tasks/intake: the prompt
 * (and an optional pasted image) is split into 1..N tasks, each broken into a
 * flow. Priority "auto" lets the server infer it; intent "auto" lets the LLM
 * classify task vs feature.
 */
export function AddTask({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"auto" | Priority>("auto");
  const [intent, setIntent] = useState<"auto" | Intent>("auto");
  const [image, setImage] = useState<string | null>(null); // data URL
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if ((!t && !image) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await createTasksFromIntake({
        prompt: t,
        imageDataUrl: image ?? undefined,
        intent: intent === "auto" ? undefined : intent,
        priority: priority === "auto" ? undefined : priority,
      });
      setTitle("");
      setImage(null);
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-task" onSubmit={submit}>
      <span className="add-task-caret">▸</span>
      <input
        className="add-task-input"
        placeholder="add task(s) — describe in plain English or paste an image; it gets split into flows"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onPaste={onPaste}
        disabled={busy}
      />
      {image && (
        <span className="add-task-img" title="pasted image — will be read to extract tasks">
          <img src={image} alt="pasted" />
          <button type="button" className="add-task-img-x" title="remove image" onClick={() => setImage(null)}>
            ✕
          </button>
        </span>
      )}
      <select
        className="add-task-pri"
        value={intent}
        onChange={(e) => setIntent(e.target.value as "auto" | Intent)}
        title="task vs feature (auto = let spear classify)"
      >
        <option value="auto">auto type</option>
        <option value="task">task</option>
        <option value="feature">feature</option>
      </select>
      <select
        className="add-task-pri"
        value={priority}
        onChange={(e) => setPriority(e.target.value as "auto" | Priority)}
        title="priority (auto = let spear infer it)"
      >
        <option value="auto">auto priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button className="add-task-btn" type="submit" disabled={busy || (!title.trim() && !image)}>
        {busy ? "…" : "add"}
      </button>
      {err && <span className="add-task-err">{err}</span>}
    </form>
  );
}
```

- [ ] **Step 2: Add styles.** Append to `src/web/styles.css`:

```css
.add-task-img { display: inline-flex; align-items: center; gap: 4px; }
.add-task-img img { height: 28px; width: auto; border: 1px solid var(--green, #00ff41); border-radius: 3px; image-rendering: auto; }
.add-task-img-x { background: none; border: none; color: var(--crit, #ff5577); cursor: pointer; font-size: 12px; padding: 0 2px; }
```

- [ ] **Step 3: Verify build.**

Run: `npm run build:web`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/AddTask.tsx src/web/styles.css
git commit -m "feat(web): AddTask intent select + image paste (multi-task intake)"
```

---

## Task 13: Today due-chip — show the stored suggestion

**Files:**
- Modify: `src/web/components/Today.tsx`, `src/web/styles.css`

- [ ] **Step 1: Implement.** In `src/web/components/Today.tsx`, replace the `editing` branch of `DueEditor` (the `if (editing) { return (<span className="due-edit">…</span>); }` block) with one that also offers the suggestion chip:

```tsx
  if (editing) {
    return (
      <span className="due-edit">
        <input
          type="date"
          className="due-input"
          defaultValue={item.due ?? ""}
          autoFocus
          onChange={(e) => e.target.value && void apply(e.target.value)}
          onBlur={() => setEditing(false)}
        />
        {!item.due && item.suggestedDue && (
          <button
            className="due-suggest"
            title={item.suggestedDueReason ?? "spear's suggestion"}
            onMouseDown={() => void apply(item.suggestedDue!)}
          >
            ☆ {fmtDue(item.suggestedDue)}
          </button>
        )}
        {item.due && (
          <button className="due-clear" title="Clear deadline" onMouseDown={() => void apply(null)}>
            ✕
          </button>
        )}
      </span>
    );
  }
```

> `onMouseDown` (not `onClick`) so the chip fires before the date input's `onBlur` closes the editor.

- [ ] **Step 2: Add a style.** Append to `src/web/styles.css`:

```css
.due-suggest {
  background: rgba(0, 255, 65, 0.08);
  border: 1px dashed var(--green, #00ff41);
  color: var(--green, #00ff41);
  border-radius: 3px;
  font-size: 11px;
  padding: 1px 5px;
  cursor: pointer;
  white-space: nowrap;
}
.due-suggest:hover { background: rgba(0, 255, 65, 0.16); }
```

- [ ] **Step 3: Verify build.**

Run: `npm run build:web`
Expected: no type errors (`TodayItem` already has `suggestedDue`/`suggestedDueReason` from Task 8).

- [ ] **Step 4: Commit**

```bash
git add src/web/components/Today.tsx src/web/styles.css
git commit -m "feat(web): one-click suggested-due chip in the due editor"
```

---

## Task 14: Lane-count control in the header

**Files:**
- Modify: `src/web/App.tsx`, `src/web/styles.css`

- [ ] **Step 1: Implement.** In `src/web/App.tsx`:

Update the import to add the config helpers:
```ts
import { fetchBoard, fetchToday, fetchConfig, setMaxLanes, type BoardData, type TodayData } from "./api";
```

Add lane state inside `App` (after the other `useState` lines):
```ts
  const [lanes, setLanes] = useState<number>(6);
```

Fetch the current value on mount — inside the existing `useEffect(() => { load(); ... }, [load])`, add right after `load();`:
```ts
    fetchConfig().then((c) => setLanes(c.maxLanes)).catch(() => {});
```

Add a change handler (near `refresh`):
```ts
  const changeLanes = useCallback(async (n: number) => {
    setLanes(n); // optimistic; the re-plan's SSE will refresh the board
    try {
      await setMaxLanes(n);
    } catch {
      /* leave the optimistic value; next fetchConfig corrects it */
    }
  }, []);
```

Render the control in the header `.bar`, right before `<div className="spacer" />`:
```tsx
        <label className="lanes-ctl" title="Max parallel lanes — changing this re-plans the board">
          lanes
          <select value={lanes} onChange={(e) => void changeLanes(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
```

- [ ] **Step 2: Add a style.** Append to `src/web/styles.css`:

```css
.lanes-ctl { display: inline-flex; align-items: center; gap: 4px; color: var(--dim, #6f9f7f); font-size: 12px; }
.lanes-ctl select { background: #0a0e0a; color: var(--green, #00ff41); border: 1px solid var(--green, #00ff41); border-radius: 3px; font-size: 12px; padding: 1px 4px; }
```

- [ ] **Step 3: Verify build.**

Run: `npm run build:web`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/App.tsx src/web/styles.css
git commit -m "feat(web): configurable lane count control (re-plans on change)"
```

---

## Task 15: CLI `add` — `--task` / `--feature` flags

**Files:**
- Modify: `src/commands/add.ts`

- [ ] **Step 1: Implement.** In `src/commands/add.ts`:

Add to the `AddOpts` interface:
```ts
  task?: boolean;
  feature?: boolean;
```

Add the options to the command chain (after the `--due` option):
```ts
    .option("--task", "force a lean, non-feature breakdown")
    .option("--feature", "force the full feature flow (planning → implementation → testing)")
```

In the action, compute `intent` (feature wins if both given) before the `breakdownForAdd` call:
```ts
      const intent = opts.feature ? "feature" : opts.task ? "task" : undefined;
```

Pass it into the `breakdownForAdd({ ... })` call — add `intent,` alongside `forcedType,`.

- [ ] **Step 2: Verify build + suite.**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Manual smoke (optional).**

```bash
node dist/cli.js add "build a CSV export feature for reports" --feature
```
Expected: the printed breakdown shows ≥3 stages (Planning → Implementation → Testing) and type `feature`. (Requires a working `claude` CLI.)

- [ ] **Step 4: Commit**

```bash
git add src/commands/add.ts
git commit -m "feat(cli): spear add --task / --feature intent flags"
```

---

## Task 16: Version bump, full verification, local install, release

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump the version.** In `package.json`, set `"version": "0.1.18"`.

- [ ] **Step 2: Full verification.**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests PASS (the existing 74 + the new suites), build produces `dist/` + `dist/web/`.

- [ ] **Step 3: Live smoke test of the new features.**

```bash
node dist/cli.js serve --port 4399 --open
```
Verify in the browser: (a) paste an image of a short list into AddTask → multiple tasks appear; (b) type "fix login and add export" → two tasks; (c) the type toggle (task/feature) and a feature produces 3 stages; (d) click `due` on an undated task → a `☆ <date>` suggestion chip appears (after the background pass has run; give it ~15s post-add); (e) change the lanes selector → the board re-plans into that many lanes. Then `Ctrl-C`.

- [ ] **Step 4: Commit the bump.**

```bash
git add package.json
git commit -m "chore: release v0.1.18 — intake, type toggle, feature flow, suggested due, lane count"
```

- [ ] **Step 5: Install locally.**

Run: `npm run build && npm link`
Expected: `spear` on PATH points at this build. Confirm: `spear --version` → `0.1.18`.

- [ ] **Step 6: Push branch + tag the release.**

```bash
git push origin main
git tag v0.1.18
git push origin v0.1.18
```
Expected: the `v0.1.18` tag triggers `.github/workflows/release.yml`, which builds the dmg on macos-latest (ad-hoc signed via `scripts/afterPack.cjs`) and publishes the GitHub Release.

- [ ] **Step 7: Confirm the release build.**

Run: `gh run list --workflow=release.yml --limit 3`
Expected: a run for tag `v0.1.18` is in progress / succeeds. Then `gh release view v0.1.18` shows the dmg asset.

---

## Self-Review

**Spec coverage:**
- A (image+text → 1..N tasks): Tasks 1, 2, 9, 10, 11, 12. ✔ (text always extracts; image adds `--allowedTools Read`; parallel per-seed breakdown; GUI-only.)
- B (features → planning+impl+testing, prompt-only): Task 3 (SYSTEM prompt). ✔
- C (Auto/Task/Feature toggle): Task 3 (intent), 11 (api), 12 (UI), 15 (CLI). ✔
- D (pre-computed suggested due): Tasks 4 (columns), 5 (LLM), 6 (pass), 7 (wiring), 8 (DTO), 13 (UI). ✔
- E (configurable lanes): Task 10 (routes), 11 (api), 14 (UI). ✔
- Release v0.1.18: Task 16. ✔

**Placeholder scan:** No TBD/TODO. Two tasks (8 dto.test, 4 store.test) say "reuse the file's existing helper" — these are explicit instructions to match an existing pattern in a file the implementer will open, not missing code; the assertion code itself is complete.

**Type consistency:** `intent: "task" | "feature"` is identical in `BreakdownRequest` (Task 3), `IntakeParams` (Task 9), the route (Task 10), `createTasksFromIntake`/`Intent` (Task 11), AddTask (Task 12), and the CLI (Task 15). `suggested_due`/`suggested_due_reason` (snake_case) are consistent across `Task`, `TaskRow`, `setSuggestedDue`, and the DTO mapping; the DTO/web surface them as `suggestedDue`/`suggestedDueReason` (camelCase) consistently in Tasks 8 and 13. `extractTaskSeeds`, `intakeTasks`, `mimeExt`, `runSuggestedDuePass`, `suggestDueDates`, `buildClaudeArgs`, `buildPrompt` names match between definition and use.

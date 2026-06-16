# spear v0.1.20 — task duplicate detection + docs/changelog overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn (with "add anyway") when a new task semantically duplicates an existing one — detected via a Sonnet LLM call against all tasks — across the GUI intake and the CLI; then overhaul the README to match the current LLM-only reality and add a maintained CHANGELOG, and ship v0.1.20.

**Architecture:** A new isolated `llm/duplicates.ts` runs one Sonnet call (`claude-sonnet-4-6`, low effort) that maps the task(s) being added to any existing tasks they duplicate. The GUI intake splits into check → create so the warning can list collisions before anything is created; the CLI aborts unless `--force`. Docs are a separate deliverable in the same release.

**Tech Stack:** Node/TS ESM, better-sqlite3, Fastify, React/Vite, vitest, zod/v4, the `claude` CLI.

**Spec:** `docs/superpowers/specs/2026-06-16-task-duplicate-detection-design.md`
**Docs deliverable** (added per user follow-up): README overhaul + `CHANGELOG.md`.

---

## File Structure

**New files**
- `src/llm/duplicates.ts` — `findDuplicates()` (candidates × existing → matches), Sonnet.
- `src/server/duplicateCheck.ts` — `checkSeedsForDuplicates()` (store snapshot → enriched matches).
- `CHANGELOG.md` — release notes (repo root).
- Test files alongside the two new modules.

**Modified files**
- `src/llm/schemas.ts` — `DuplicateSchema`.
- `src/config/index.ts` — `models.duplicate`, `effort.duplicate`.
- `src/server/intake.ts` — split into `extractSeedsForIntake` + `createTasksFromSeeds` (keep `intakeTasks`).
- `src/server/app.ts` — `/api/tasks/intake/check` + `/api/tasks/intake/create` routes.
- `src/web/api.ts` — `checkIntake()`, `createTasksFromSeeds()`, `DuplicateMatch`/`TaskSeed` types.
- `src/web/components/AddTask.tsx` — two-step submit + warning panel.
- `src/web/styles.css` — warning-panel styles.
- `src/commands/add.ts` — `--force` flag + pre-create duplicate check.
- `README.md` — overhaul.
- `package.json` — version bump.

---

## Task 1: Duplicate-detection schema + module (`findDuplicates`)

**Files:**
- Modify: `src/llm/schemas.ts`
- Create: `src/llm/duplicates.ts`
- Test: `src/llm/duplicates.test.ts`

- [ ] **Step 1: Add the schema** — append to `src/llm/schemas.ts`:

```ts
// ---- Duplicate detection ----

export const DuplicateSchema = z.object({
  matches: z.array(
    z.object({
      candidate_index: z.number().int().describe("Index into the candidates array"),
      task_id: z.number().int().describe("Existing task id it duplicates"),
      reason: z.string().describe("One short clause: why they are the same"),
    }),
  ),
});
export type DuplicateOutput = z.infer<typeof DuplicateSchema>;
```

- [ ] **Step 2: Write the failing test** — create `src/llm/duplicates.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run src/llm/duplicates.test.ts`
Expected: FAIL — cannot find module `./duplicates.js`.

- [ ] **Step 4: Implement** — create `src/llm/duplicates.ts`:

```ts
import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { DuplicateSchema } from "./schemas.js";

export interface DupCandidate {
  title: string;
  details?: string;
}

export interface ExistingTaskRef {
  id: number;
  title: string;
  status: string;
}

export interface DupMatch {
  candidateIndex: number;
  taskId: number;
  reason: string;
}

const SYSTEM = `You detect when a task a founder is about to add DUPLICATES one already on their board.

Rules:
- For each candidate, find an existing task that means the SAME thing — a reworded or rephrased
  version of the same work counts as a duplicate. A merely related or adjacent task does NOT.
- Use the exact ids from the existing list. Omit candidates that have no duplicate.
- Output ONLY a JSON object: {"matches":[{"candidate_index":number,"task_id":number,"reason":string}]}
  — no prose, no markdown fences.`;

function buildPrompt(candidates: DupCandidate[], existing: ExistingTaskRef[]): string {
  return (
    `${SYSTEM}\n\nCandidates (by index):\n${JSON.stringify(candidates.map((c, i) => ({ index: i, ...c })))}` +
    `\n\nExisting tasks:\n${JSON.stringify(existing)}`
  );
}

/**
 * Ask the Claude CLI which candidate tasks duplicate an existing task. Returns
 * only well-formed matches (valid candidate index + known task id). Short-circuits
 * to [] (no LLM call) when there is nothing to compare.
 */
export async function findDuplicates(
  candidates: DupCandidate[],
  existing: ExistingTaskRef[],
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<DupMatch[]> {
  if (candidates.length === 0 || existing.length === 0) return [];
  const ids = new Set(existing.map((e) => e.id));
  const parsed = await claudeStructured(buildPrompt(candidates, existing), (x) => DuplicateSchema.parse(x), opts, run);

  const out: DupMatch[] = [];
  for (const m of parsed.matches) {
    if (m.candidate_index < 0 || m.candidate_index >= candidates.length) continue;
    if (!ids.has(m.task_id)) continue;
    out.push({ candidateIndex: m.candidate_index, taskId: m.task_id, reason: m.reason });
  }
  return out;
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run src/llm/duplicates.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/llm/duplicates.ts src/llm/duplicates.test.ts src/llm/schemas.ts
git commit -m "feat(llm): findDuplicates — semantic duplicate detection"
```

---

## Task 2: Config — duplicate model + effort

**Files:**
- Modify: `src/config/index.ts`

- [ ] **Step 1: Implement.** In `src/config/index.ts`, extend the `SpearConfig` interface fields:

Replace:
```ts
  /** Claude model ids for the two LLM calls. */
  models: { breakdown: string; planner: string };
  /** Effort levels for the two LLM calls. */
  effort: { breakdown: "low" | "medium" | "high" | "max"; planner: "low" | "medium" | "high" | "max" };
```
with:
```ts
  /** Claude model ids for the LLM calls. */
  models: { breakdown: string; planner: string; duplicate: string };
  /** Effort levels for the LLM calls. */
  effort: {
    breakdown: "low" | "medium" | "high" | "max";
    planner: "low" | "medium" | "high" | "max";
    duplicate: "low" | "medium" | "high" | "max";
  };
```

In `DEFAULT_CONFIG`, replace:
```ts
  models: { breakdown: "claude-opus-4-8", planner: "claude-opus-4-8" },
  effort: { breakdown: "low", planner: "medium" },
```
with:
```ts
  models: { breakdown: "claude-opus-4-8", planner: "claude-opus-4-8", duplicate: "claude-sonnet-4-6" },
  effort: { breakdown: "low", planner: "medium", duplicate: "low" },
```

(`mergeConfig` already deep-merges `models` and `effort`, so older config files pick up the new defaults.)

- [ ] **Step 2: Verify typecheck.**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/config/index.ts
git commit -m "feat(config): models.duplicate + effort.duplicate (Sonnet for dup-check)"
```

---

## Task 3: Intake refactor — split extract / create

**Files:**
- Modify: `src/server/intake.ts`
- Test: `src/server/intake.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/server/intake.test.ts`:

```ts
import { extractSeedsForIntake, createTasksFromSeeds } from "./intake.js";

describe("createTasksFromSeeds", () => {
  const breakdownRun = async () => ({
    title: "Cleaned",
    type: "chore",
    priority: "medium",
    effort: "small",
    stages: [{ name: "do it", kind: "generic", effort: "small", delegatable_to: ["self"] }],
  });

  it("creates one task per provided seed and applies priority", async () => {
    const store = new Store(openDb(":memory:"));
    const seeds = [
      { title: "one", details: "d1" },
      { title: "two", details: "d2" },
    ];
    const { taskIds } = await createTasksFromSeeds(store, DEFAULT_CONFIG, seeds, { priority: "high" }, { breakdownRun });
    expect(taskIds).toHaveLength(2);
    expect(store.listTasks().every((t) => t.priority === "high")).toBe(true);
  });
});

describe("extractSeedsForIntake", () => {
  it("returns the extracted seeds via the injected extractor", async () => {
    const extract = async () => [{ title: "x", details: "y" }];
    const seeds = await extractSeedsForIntake(DEFAULT_CONFIG, { prompt: "p" }, { extract });
    expect(seeds).toEqual([{ title: "x", details: "y" }]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/server/intake.test.ts -t "createTasksFromSeeds"`
Expected: FAIL — `createTasksFromSeeds` is not exported.

- [ ] **Step 3: Implement** — in `src/server/intake.ts`, replace the single `intakeTasks` function with the split version (keep `IntakeParams`, `IntakeDeps`, `mimeExt` unchanged above it):

```ts
/** Extraction half: prompt (+ optional image) → task seeds. */
export async function extractSeedsForIntake(
  cfg: SpearConfig,
  params: IntakeParams,
  deps: IntakeDeps = {},
): Promise<TaskSeed[]> {
  const extract =
    deps.extract ??
    ((prompt: string, imagePath: string | undefined) =>
      extractTaskSeeds(prompt, imagePath, { model: cfg.models.breakdown, effort: "low" }));
  return extract(params.prompt, params.imagePath, { model: cfg.models.breakdown, effort: "low" });
}

/** Create half: break each seed down in parallel and insert it. Per-seed failures are skipped. */
export async function createTasksFromSeeds(
  store: Store,
  cfg: SpearConfig,
  seeds: TaskSeed[],
  params: { intent?: "task" | "feature"; priority?: Priority },
  deps: IntakeDeps = {},
): Promise<{ taskIds: number[] }> {
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

/** Combined intake (extract → create), unchanged behavior. */
export async function intakeTasks(
  store: Store,
  cfg: SpearConfig,
  params: IntakeParams,
  deps: IntakeDeps = {},
): Promise<{ taskIds: number[] }> {
  const seeds = await extractSeedsForIntake(cfg, params, deps);
  return createTasksFromSeeds(store, cfg, seeds, params, deps);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/server/intake.test.ts`
Expected: PASS (existing `intakeTasks` + `mimeExt` tests stay green; new ones pass).

- [ ] **Step 5: Commit**

```bash
git add src/server/intake.ts src/server/intake.test.ts
git commit -m "refactor(intake): split into extractSeedsForIntake + createTasksFromSeeds"
```

---

## Task 4: Duplicate-check server helper

**Files:**
- Create: `src/server/duplicateCheck.ts`
- Test: `src/server/duplicateCheck.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/server/duplicateCheck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { openDb } from "../db/index.js";
import { Store } from "../db/store.js";
import { DEFAULT_CONFIG } from "../config/index.js";
import { completeTask } from "../service.js";
import { checkSeedsForDuplicates } from "./duplicateCheck.js";

function makeStore(): Store {
  return new Store(openDb(":memory:"));
}

describe("checkSeedsForDuplicates", () => {
  it("enriches matches with the existing task title + status (incl. done)", async () => {
    const store = makeStore();
    const a = store.createTask({ title: "Renew SSL cert" });
    completeTask(store, a.id); // a is now done — must still be checked
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
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/server/duplicateCheck.test.ts`
Expected: FAIL — cannot find module `./duplicateCheck.js`.

- [ ] **Step 3: Implement** — create `src/server/duplicateCheck.ts`:

```ts
import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import type { TaskSeed } from "../llm/intake.js";
import { findDuplicates, type ExistingTaskRef } from "../llm/duplicates.js";
import { claudeJson, type ClaudeRunner } from "../llm/cli.js";

export interface SeedDuplicate {
  seedIndex: number;
  taskId: number;
  title: string;
  status: string;
  reason: string;
}

/**
 * Check extracted seeds against ALL existing tasks (open + done) for semantic
 * duplicates, using the configured Sonnet model. Returns enriched matches with
 * the existing task's title + status for display.
 */
export async function checkSeedsForDuplicates(
  store: Store,
  cfg: SpearConfig,
  seeds: TaskSeed[],
  run: ClaudeRunner = claudeJson,
): Promise<SeedDuplicate[]> {
  const all = store.listTasks();
  const existing: ExistingTaskRef[] = all.map((t) => ({ id: t.id, title: t.title, status: t.status }));
  const byId = new Map(all.map((t) => [t.id, t]));
  const candidates = seeds.map((s) => ({ title: s.title, details: s.details }));

  const matches = await findDuplicates(candidates, existing, { model: cfg.models.duplicate, effort: cfg.effort.duplicate }, run);
  return matches.map((m) => {
    const t = byId.get(m.taskId)!;
    return { seedIndex: m.candidateIndex, taskId: m.taskId, title: t.title, status: t.status, reason: m.reason };
  });
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/server/duplicateCheck.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/duplicateCheck.ts src/server/duplicateCheck.test.ts
git commit -m "feat(server): checkSeedsForDuplicates against all tasks (open + done)"
```

---

## Task 5: Intake check + create routes

**Files:**
- Modify: `src/server/app.ts`

- [ ] **Step 1: Add imports.** In `src/server/app.ts`, update the intake import line:

Replace:
```ts
import { intakeTasks, mimeExt } from "./intake.js";
```
with:
```ts
import { intakeTasks, extractSeedsForIntake, createTasksFromSeeds, mimeExt, type IntakeParams } from "./intake.js";
import { checkSeedsForDuplicates } from "./duplicateCheck.js";
import type { TaskSeed } from "../llm/intake.js";
```

- [ ] **Step 2: Add the two routes.** In `buildServer`, immediately after the existing `app.post("/api/tasks/intake", …)` handler, add:

```ts
  // ---- intake step 1: extract seeds + check for duplicates (no creation) ----
  app.post("/api/tasks/intake/check", async (req, reply) => {
    const body = (req.body ?? {}) as { prompt?: string; image?: { mime?: string; dataB64?: string } };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const hasImage = !!body.image?.dataB64;
    if (!prompt && !hasImage) {
      reply.code(400);
      return { error: "prompt or image required" };
    }
    let imagePath: string | undefined;
    if (hasImage) {
      imagePath = path.join(os.tmpdir(), `spear-intake-${randomUUID()}.${mimeExt(body.image!.mime)}`);
      fs.writeFileSync(imagePath, Buffer.from(body.image!.dataB64!, "base64"));
    }
    try {
      const params: IntakeParams = { prompt, imagePath };
      const seeds = await extractSeedsForIntake(cfg, params);
      const duplicates = await checkSeedsForDuplicates(store, cfg, seeds);
      return { seeds, duplicates };
    } catch (err) {
      reply.code(502);
      return { error: `intake check failed: ${err instanceof Error ? err.message : String(err)}` };
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

  // ---- intake step 2: create tasks from already-extracted seeds ----
  app.post("/api/tasks/intake/create", async (req, reply) => {
    const body = (req.body ?? {}) as { seeds?: TaskSeed[]; intent?: string; priority?: string };
    const seeds = Array.isArray(body.seeds)
      ? body.seeds.filter((s) => s && typeof s.title === "string").map((s) => ({ title: s.title, details: typeof s.details === "string" ? s.details : "" }))
      : [];
    if (seeds.length === 0) {
      reply.code(400);
      return { error: "seeds required" };
    }
    const explicitPriority = body.priority ? (body.priority as Priority) : undefined;
    if (explicitPriority && !PRIORITIES.includes(explicitPriority)) {
      reply.code(400);
      return { error: "invalid priority" };
    }
    const intent = body.intent === "task" || body.intent === "feature" ? body.intent : undefined;
    try {
      const { taskIds } = await createTasksFromSeeds(store, cfg, seeds, { intent, priority: explicitPriority });
      if (taskIds.length === 0) {
        reply.code(502);
        return { error: "no tasks could be created" };
      }
      replanner.requestReplan("adhoc");
      return { count: taskIds.length, taskIds };
    } catch (err) {
      reply.code(502);
      return { error: `intake create failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
```

- [ ] **Step 3: Verify build + suite.**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. (`intakeTasks` is still imported/used by the existing `/api/tasks/intake` route, so no unused-import error.)

- [ ] **Step 4: Commit**

```bash
git add src/server/app.ts
git commit -m "feat(server): /api/tasks/intake/check (dup warn) + /create routes"
```

---

## Task 6: Web client — check/create + types

**Files:**
- Modify: `src/web/api.ts`

- [ ] **Step 1: Implement.** In `src/web/api.ts`, add types near the other type aliases (after `export type Intent = …`):

```ts
export interface TaskSeed {
  title: string;
  details: string;
}
export interface DuplicateMatch {
  seedIndex: number;
  taskId: number;
  title: string;
  status: TaskStatus;
  reason: string;
}
```

Add these functions in the `// ---- task create / actions ----` section (after `createTasksFromIntake`):

```ts
/** Intake step 1: extract seeds + check for duplicates. Creates nothing. */
export async function checkIntake(params: {
  prompt: string;
  imageDataUrl?: string;
}): Promise<{ seeds: TaskSeed[]; duplicates: DuplicateMatch[] }> {
  const body: { prompt: string; image?: { mime: string; dataB64: string } } = { prompt: params.prompt };
  if (params.imageDataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(params.imageDataUrl);
    if (m) body.image = { mime: m[1], dataB64: m[2] };
  }
  const r = await fetch("/api/tasks/intake/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`check ${r.status}`);
  return r.json();
}

/** Intake step 2: create tasks from already-extracted seeds. */
export async function createTasksFromSeeds(
  seeds: TaskSeed[],
  intent?: Intent,
  priority?: Priority,
): Promise<{ count: number; taskIds: number[] }> {
  const body: { seeds: TaskSeed[]; intent?: Intent; priority?: Priority } = { seeds };
  if (intent) body.intent = intent;
  if (priority) body.priority = priority;
  const r = await fetch("/api/tasks/intake/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`create ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Verify build.**

Run: `npm run build:web`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/api.ts
git commit -m "feat(web): checkIntake + createTasksFromSeeds API client"
```

---

## Task 7: AddTask — two-step submit + duplicate warning

**Files:**
- Modify: `src/web/components/AddTask.tsx`, `src/web/styles.css`

- [ ] **Step 1: Implement the component.** Replace the body of `src/web/components/AddTask.tsx` with:

```tsx
import { useState } from "react";
import { checkIntake, createTasksFromSeeds, type DuplicateMatch, type Intent, type Priority, type TaskSeed } from "../api";

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

/**
 * Inline capture for the Today tab. Two-step: /intake/check extracts the task(s)
 * and flags any that duplicate an existing task; if there are duplicates we show a
 * warning with "Add anyway", otherwise we create immediately.
 */
export function AddTask({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"auto" | Priority>("auto");
  const [intent, setIntent] = useState<"auto" | Intent>("auto");
  const [image, setImage] = useState<string | null>(null); // data URL
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ seeds: TaskSeed[]; duplicates: DuplicateMatch[] } | null>(null);

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

  function reset() {
    setTitle("");
    setImage(null);
    setPending(null);
  }

  async function create(seeds: TaskSeed[]) {
    await createTasksFromSeeds(seeds, intent === "auto" ? undefined : intent, priority === "auto" ? undefined : priority);
    reset();
    onAdded();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if ((!t && !image) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { seeds, duplicates } = await checkIntake({ prompt: t, imageDataUrl: image ?? undefined });
      if (duplicates.length > 0) {
        setPending({ seeds, duplicates });
      } else {
        await create(seeds);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addAnyway() {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      await create(pending.seeds);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const titleFor = (i: number) => pending?.seeds[i]?.title ?? "this task";

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

      {pending && (
        <div className="dup-warn">
          <div className="dup-warn-head">⚠ possible duplicate{pending.duplicates.length > 1 ? "s" : ""}</div>
          <ul className="dup-warn-list">
            {pending.duplicates.map((d, i) => (
              <li key={i}>
                <span className="dup-new">“{titleFor(d.seedIndex)}”</span> looks like{" "}
                <span className="dup-existing">
                  #{d.taskId} “{d.title}” <span className="dup-status">({d.status})</span>
                </span>{" "}
                — {d.reason}
              </li>
            ))}
          </ul>
          <div className="dup-warn-actions">
            <button type="button" className="add-task-btn" onClick={() => void addAnyway()} disabled={busy}>
              {busy ? "…" : "Add anyway"}
            </button>
            <button type="button" className="dup-cancel" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Add styles.** Append to `src/web/styles.css`:

```css
/* ---- v0.1.20: duplicate-warning panel ---- */
.dup-warn {
  flex-basis: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--warn, #e0b341);
  border-radius: 4px;
  background: rgba(224, 179, 65, 0.08);
  font-size: 12px;
}
.dup-warn-head { color: var(--warn, #e0b341); font-weight: 600; margin-bottom: 4px; }
.dup-warn-list { margin: 0 0 8px; padding-left: 16px; }
.dup-warn-list li { margin: 2px 0; }
.dup-new { color: var(--green, #00ff41); }
.dup-existing { color: #cfe8d4; }
.dup-status { color: var(--dim, #6f9f7f); }
.dup-warn-actions { display: flex; gap: 8px; }
.dup-cancel { background: none; border: 1px solid var(--dim, #6f9f7f); color: var(--dim, #6f9f7f); border-radius: 3px; padding: 2px 10px; cursor: pointer; }
```

- [ ] **Step 3: Verify build.**

Run: `npm run build:web`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/AddTask.tsx src/web/styles.css
git commit -m "feat(web): duplicate-warning panel + 'Add anyway' in AddTask"
```

---

## Task 8: CLI `spear add --force` + duplicate check

**Files:**
- Modify: `src/commands/add.ts`

- [ ] **Step 1: Implement.** In `src/commands/add.ts`:

Add to the `AddOpts` interface:
```ts
  force?: boolean;
```

Add the option (after `--feature`):
```ts
    .option("--force", "skip the duplicate-task check")
```

The current command does the breakdown BEFORE opening the store. Re-order so the duplicate
check runs against the store first. Replace the block from `let broken;` through the
`const store = openStore();` line — i.e. replace:

```ts
      let broken;
      try {
        broken = await breakdownForAdd({
          title,
          description: opts.description,
          forcedType,
          intent,
          model: cfg.models.breakdown,
          effort: cfg.effort.breakdown,
          due,
          explicitPriority,
        });
      } catch (err) {
        console.error(c.red(`breakdown failed (claude CLI): ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
        return;
      }

      const store = openStore();
      try {
```

with:

```ts
      const store = openStore();
      try {
        if (!opts.force) {
          const { findDuplicates } = await import("../llm/duplicates.js");
          const existing = store.listTasks().map((t) => ({ id: t.id, title: t.title, status: t.status }));
          let dups: { candidateIndex: number; taskId: number; reason: string }[] = [];
          try {
            dups = await findDuplicates([{ title, details: opts.description }], existing, {
              model: cfg.models.duplicate,
              effort: cfg.effort.duplicate,
            });
          } catch {
            dups = []; // dup-check is best-effort; never block a capture on it
          }
          if (dups.length) {
            const byId = new Map(store.listTasks().map((t) => [t.id, t]));
            console.error(c.yellow("⚠ possible duplicate of an existing task:"));
            for (const d of dups) {
              const t = byId.get(d.taskId);
              console.error(c.yellow(`  #${d.taskId} "${t?.title ?? "?"}" (${t?.status ?? "?"}) — ${d.reason}`));
            }
            console.error(c.dim("  use --force to add it anyway"));
            process.exitCode = 1;
            return;
          }
        }

        let broken;
        try {
          broken = await breakdownForAdd({
            title,
            description: opts.description,
            forcedType,
            intent,
            model: cfg.models.breakdown,
            effort: cfg.effort.breakdown,
            due,
            explicitPriority,
          });
        } catch (err) {
          console.error(c.red(`breakdown failed (claude CLI): ${err instanceof Error ? err.message : String(err)}`));
          process.exitCode = 1;
          return;
        }
```

(The rest of the `try` body — `addTask(...)`, the logging, `triggerReplan`, and the `finally { store.db.close(); }` — stays as-is.)

- [ ] **Step 2: Verify `c.yellow` exists.** Confirm the render helper has a yellow:

Run: `grep -n "yellow" src/util/render.ts`
Expected: a `yellow` color function is defined. If not, use `c.dim` for the warning lines instead.

- [ ] **Step 3: Verify build + suite.**

Run: `npm run typecheck && npx vitest run`
Expected: PASS (101+ tests).

- [ ] **Step 4: Commit**

```bash
git add src/commands/add.ts
git commit -m "feat(cli): spear add duplicate check + --force override"
```

---

## Task 9: README overhaul

**Files:**
- Modify: `README.md`

The README has stale content from before the LLM-only migration. Fix it AND add the new
features. Make these specific edits.

- [ ] **Step 1: Fix the Install section.** Replace the `## Install` fenced block + the key note (lines that mention `ANTHROPIC_API_KEY`) with:

````markdown
```bash
npm install
npm run build          # compiles the CLI/server (dist/) and the web app (dist/web/)
npm link               # optional: puts `spear` on your PATH (otherwise use `node dist/cli.js`)
spear init             # creates ~/.spear, seeds the "Me" executor, writes the 8am launchd job
```

> **No API key.** spear's LLM calls (breakdown, planning, due-date suggestions, duplicate
> detection) run through your local **Claude Code CLI** login — there is no `ANTHROPIC_API_KEY`
> and nothing is sent anywhere but Anthropic via that CLI. Your task data lives in `~/.spear/`.
````

- [ ] **Step 2: Fix the Everyday use examples.** In the `## Everyday use` fenced block, replace the four `spear add …` example lines with:

```bash
spear add "Fix prod outage in billing"                       # priority auto-inferred (→ critical)
spear add "Ship onboarding revamp" --due 2026-09-01          # due date feeds priority + ordering
spear add "Rename a config var" --task                       # force a lean, non-feature breakdown
spear add "Ship v2 billing" --feature --blocked-by 1         # full Planning→Impl→Testing flow; depends on #1
spear add "Renew SSL cert" --force                           # skip the duplicate-task check
```

- [ ] **Step 3: Replace the Dashboard tab list.** Replace the `## Dashboard` intro line "with three tabs" and the bullet list (Today / Board / Goals) with a four-tab version that documents intake, the type toggle, suggested due, and lane control:

````markdown
`spear serve --open` opens a dark, Matrix-themed dashboard at http://127.0.0.1:4317 with four
tabs, all live over SSE:

- **Today** — the generated execution flow: parallel lanes (count configurable from the header),
  each lane's next step flagged ▶ now, delegatable steps marked, overdue / due-today badges. The
  **add bar** on top turns plain English — **or a pasted image** — into one or more tasks:
  - splits a multi-task capture (or a screenshot of a list) into separate flows;
  - an **auto / task / feature** toggle (feature → full Planning → Implementation → Testing);
  - **auto** or explicit priority;
  - warns if a task looks like a **duplicate** of an existing one, with **Add anyway**;
  - click **+ due** for a one-click suggested deadline (pre-computed from priority + your load).
- **Board** — tasks by status (Backlog · To Do · In Progress · Blocked · Done) with stage
  progress and blockers, plus quick actions **▶ start** / **✓ done** / **✕** and click-to-edit
  priority.
- **Week** — a running Mon→Sun calendar bucketed by deadline, with drag-and-drop rescheduling.
- **Goals** — weekly goals in two sub-tabs:
  - **List** — a simple, free-form goal list (add / inline-edit / tick off / delete).
  - **Scorecard** — a weekly-focus card of weighted metrics
    (`Task · Progress · Goal · Score · Weight · % Completion`) with a live Total, plus
    **Bonus Tasks → Rewards**. Score = `weight × min(progress/goal, 1)`.
````

- [ ] **Step 4: Replace the "Releases & auto-update" notes.** Replace the two-bullet `Notes:` list under `### Releases & auto-update` with the current behavior:

```markdown
Notes:
- Installed apps update **only from a build that already has the update logic** — install one
  current build manually once (⤓ Desktop app → download), then future updates come through it.
- **macOS** is unsigned + dmg-only, so it can't auto-replace itself in place. On **⟳ refresh**, if a
  newer release exists, spear downloads the new `.dmg` into your **~/Downloads** and reveals it in
  Finder — you drag it into Applications to finish. **Windows** (NSIS) still updates in place.
- First launch of an unsigned download needs `xattr -dr com.apple.quarantine` once (or right-click → Open).
```

Also update the `### Releases & auto-update` opening paragraph sentence "first to download the
update, then to restart and install it — never silently." to:
```markdown
anything. On macOS it downloads the new `.dmg` to your Downloads folder to install by hand
(unsigned builds can't self-replace); on Windows it downloads and installs in place — never silently.
```

- [ ] **Step 5: Fix the Config line.** Replace the `## Config` body line listing keys with:

```markdown
`~/.spear/config.json` — `port`, `morning.{hour,minute}`, `models.{breakdown,planner,duplicate}`,
`effort.{breakdown,planner,duplicate}`, `defaultPriority`, `maxLanes`, `replanDebounceMs`. The
duplicate-detection call defaults to `claude-sonnet-4-6`. View/edit with
`spear config [get|set] <key> [value]`.
```

- [ ] **Step 6: Fix the Architecture section.** Replace the **Planner** bullet and the **Real-time
re-plan** bullet (which describe a now-deleted deterministic graph) with:

```markdown
- **Planner** = LLM-only (Claude `claude-opus-4-8` via the local Claude Code CLI). It groups open
  flows into lanes by theme (up to `maxLanes`), orders design → implementation → testing, assigns
  executors, flags delegation, and writes the day's narrative. There is no deterministic fallback —
  on a CLI failure the previous plan is kept. Breakdown, due-date suggestion, and duplicate
  detection are separate CLI calls (duplicate uses `claude-sonnet-4-6`).
```
and
```markdown
- **Real-time re-plan** = a full LLM re-plan on every new task / breakdown (not on start/done),
  with a re-planning progress bar; suggested due dates are recomputed in the background after each.
```

- [ ] **Step 7: Fix the test count line.** Replace the `npm test` comment line at the bottom:

```bash
npm test          # unit/integration tests (breakdown, intake, duplicates, suggested-due, service, goals, DTOs, planner)
```

- [ ] **Step 8: Add a Changelog pointer.** After the `# spear` title's intro paragraph (before `## Screenshots`), add:

```markdown
See [CHANGELOG.md](CHANGELOG.md) for release notes.
```

- [ ] **Step 9: Verify it reads cleanly.**

Run: `grep -nE "ANTHROPIC_API_KEY|no-llm|deterministic (TypeScript )?graph|three tabs" README.md`
Expected: no matches (all stale references removed).

- [ ] **Step 10: Commit**

```bash
git add README.md
git commit -m "docs: overhaul README for LLM-only reality + v0.1.18–0.1.20 features"
```

---

## Task 10: CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create `CHANGELOG.md`** at the repo root:

```markdown
# Changelog

All notable changes to spear. Format loosely follows [Keep a Changelog](https://keepachangelog.com);
versions are the `vX.Y.Z` git tags that trigger a dmg/exe release.

## [0.1.20] — 2026-06-16
### Added
- **Duplicate detection.** Adding a task that semantically matches an existing one (open or done)
  now warns with the match + reason and an **Add anyway** button; the CLI `spear add` aborts unless
  `--force`. Uses a Claude **Sonnet** call (`models.duplicate`, default `claude-sonnet-4-6`).
- `models.duplicate` / `effort.duplicate` config keys.
### Changed
- GUI intake is now a two-step **check → create** so duplicates are flagged before anything is created.
- README overhauled to match the LLM-only design; added this changelog.

## [0.1.19] — 2026-06-16
### Changed
- **macOS updates download to ~/Downloads.** Since the mac build is unsigned and dmg-only (Squirrel
  can't update it in place), **⟳ refresh** now downloads the new `.dmg` to your Downloads folder and
  reveals it in Finder to drag into Applications. Windows keeps in-place auto-update.

## [0.1.18] — 2026-06-16
### Added
- **Multimodal / multi-task intake.** The add bar accepts a pasted image and/or text and splits a
  capture into 1..N tasks, each broken down in parallel.
- **Auto / Task / Feature toggle** on capture (and `spear add --task` / `--feature`).
- **Pre-computed suggested due dates** — a background pass stores a priority/effort/load-aware
  suggestion per undated task, shown as a one-click chip in the Today due editor.
- **Configurable lane count** from the dashboard header (re-plans on change).
### Changed
- Features now always break into **Planning → Implementation → Testing** (prompt-enforced).
### Fixed
- `spear --version` reports the real package version (was hardcoded `0.1.0`).

## [0.1.17] — 2026-06-15
### Added
- Click a task's priority in Today to change it.

## [0.1.16] — 2026-06-15
### Fixed
- Rapid start→done now marks the task done and removes it from the lanes.

## [0.1.15] — 2026-06-15
### Changed
- Re-plan only on new task additions / breakdowns, not on start/done progress.

## [0.1.14] — 2026-06-15
### Added
- Re-planning progress indicator.

## [0.1.13] — 2026-06-15
### Fixed
- Pass `--effort` to the Claude CLI (fixes painfully slow re-plans).

## [0.1.12] — 2026-06-15
### Changed
- **LLM-only planner** via the Claude Code CLI (no API key); removed the deterministic planner
  graph, rule-based breakdown, and the Anthropic SDK. Brighter Week-tab days.

## [0.1.11] — 2026-06-15
### Added
- Weekly calendar (**Week**) tab.

## [0.1.10] — 2026-06-15
### Added
- Critical tasks supersede in-progress work within a lane; deadline editing.

## [0.1.9] — 2026-06-15
### Added
- Ad-hoc macOS signing (`afterPack`) so the unsigned dmg isn't flagged "damaged"; config-file Claude key.

## [0.1.0]–[0.1.8] — 2026-06-14…15
- Initial releases: CLI + dashboard, per-task action buttons, the Goals tab and weekly scorecard,
  desktop (Electron) packaging, and the GitHub-Release auto-update plumbing.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG with release notes through v0.1.20"
```

---

## Task 11: Version bump, verification, live smoke, install, release

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump the version.** In `package.json`, set `"version": "0.1.20"`.

- [ ] **Step 2: Full verification.**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests PASS, build produces `dist/` + `dist/web/`.

- [ ] **Step 3: Live smoke (throwaway home so the real board is untouched).**

```bash
export SPEAR_HOME=/tmp/spear-dup-$$
mkdir -p "$SPEAR_HOME"
node dist/cli.js serve --port 4401 >/tmp/spear-dup.log 2>&1 &
SRV=$!; sleep 2
# seed one task
node dist/cli.js add "Fix the login button on mobile" >/dev/null 2>&1
# 1) check a clear duplicate
curl -s -X POST localhost:4401/api/tasks/intake/check -H 'content-type: application/json' \
  -d '{"prompt":"login button not working on phones"}' --max-time 60
echo ""
# 2) check a non-duplicate
curl -s -X POST localhost:4401/api/tasks/intake/check -H 'content-type: application/json' \
  -d '{"prompt":"write the Q3 board deck"}' --max-time 60
echo ""
# 3) CLI duplicate abort + --force
node dist/cli.js add "login button broken on mobile safari" 2>&1 | tail -4
node dist/cli.js add "login button broken on mobile safari" --force 2>&1 | tail -2
kill $SRV 2>/dev/null; rm -rf "$SPEAR_HOME"; unset SPEAR_HOME
```
Expected: (1) returns a non-empty `duplicates` array referencing the seeded task; (2) returns `duplicates: []`; (3) first CLI add prints the ⚠ duplicate warning and does NOT create, the `--force` one creates.

- [ ] **Step 4: Commit the bump.**

```bash
git add package.json
git commit -m "chore: release v0.1.20 — task duplicate detection + docs overhaul"
```

- [ ] **Step 5: Install locally.**

Run: `npm run build && npm link`
Expected: `spear --version` → `0.1.20`.

- [ ] **Step 6: Push + tag.**

```bash
git push origin main
git tag v0.1.20
git push origin v0.1.20
```

- [ ] **Step 7: Confirm the release build.**

Run: `gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status` then `gh release view v0.1.20 --json assets --jq '.assets[].name'`
Expected: the run succeeds; assets include `spear-0.1.20-arm64.dmg`.

---

## Self-Review

**Spec coverage:**
- A (findDuplicates, Sonnet, all tasks): Task 1 + Task 4. ✔
- B (config models.duplicate/effort.duplicate): Task 2. ✔
- C (two-step intake check→create, routes, AddTask warning, "Add anyway"): Tasks 3, 5, 6, 7. ✔
- D (CLI --force + abort): Task 8. ✔
- E (tests for findDuplicates / checkSeedsForDuplicates / createTasksFromSeeds): Tasks 1, 3, 4. ✔
- Docs deliverable (README overhaul + CHANGELOG): Tasks 9, 10. ✔
- Release v0.1.20: Task 11. ✔

**Placeholder scan:** No TBD/TODO. Task 8 Step 2 verifies `c.yellow` exists with a concrete fallback (`c.dim`) — that's a guarded instruction, not a placeholder.

**Type consistency:** `DupCandidate`/`ExistingTaskRef`/`DupMatch` (Task 1) are reused by `checkSeedsForDuplicates` (Task 4) and the CLI (Task 8). `SeedDuplicate` (server, Task 4) ↔ `DuplicateMatch` (web, Task 6) share the shape `{ seedIndex, taskId, title, status, reason }`. `TaskSeed` (`{title, details}`) is consistent across `intake.ts`, the routes (Task 5), and the web client (Task 6). `findDuplicates` returns `candidateIndex` (camelCase) — used consistently in Tasks 4 and 8. `createTasksFromSeeds` signature matches between definition (Task 3) and callers (Tasks 5).

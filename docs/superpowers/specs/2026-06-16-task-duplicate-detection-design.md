# spear: task duplicate detection with "add anyway"

**Date:** 2026-06-16
**Target version:** v0.1.20 (tagged dmg release + repo push)
**Status:** Approved design → ready for implementation plan

## Summary

When adding a task that is semantically the same as one already on the board, warn the
user and let them proceed anyway. Detection is an LLM semantic match on **Sonnet**
(`claude-sonnet-4-6`), checked against **all tasks (open + done)**. The GUI intake splits
into a check → create flow so the warning can list each colliding extracted task before
anything is created; the CLI `spear add` aborts on a likely duplicate unless `--force`.

Today there is **no** similarity detection — the only dedup is the `external_id UNIQUE`
constraint (exact external-id match, used by the dock-orbit ingestion).

## A. Duplicate-detection module (`src/llm/duplicates.ts`)

`findDuplicates(candidates, existing, opts, run?)`:
- `candidates: DupCandidate[]` — the task(s) being added: `{ title: string; details?: string }`.
- `existing: ExistingTaskRef[]` — every task on the board: `{ id, title, status }`.
- Returns `DupMatch[]` — `{ candidateIndex, taskId, reason }` for each candidate judged to be
  the same as an existing task. One LLM call handles all candidates.
- Runs on `opts.model` / `opts.effort` (callers pass Sonnet + low).
- Short-circuits to `[]` when `candidates` or `existing` is empty (no LLM call).
- Validation: drop any match whose `candidate_index` is out of range or whose `task_id` is not
  in `existing`.

`src/llm/schemas.ts`: `DuplicateSchema = { matches: [{ candidate_index, task_id, reason }] }`.

Prompt: given the indexed candidate tasks and the existing tasks (`id`, `title`, `status`),
return matches only where a candidate means the same thing as an existing task (a rephrasing
counts; a merely related task does not). Output ONLY the JSON object.

## B. Config

Add to `SpearConfig` / `DEFAULT_CONFIG` (and they already deep-merge `models` / `effort`):
- `models.duplicate: "claude-sonnet-4-6"`
- `effort.duplicate: "low"`

Overridable via `spear config set models.duplicate …`.

## C. GUI flow — two-step intake

Refactor `src/server/intake.ts` so the extraction and create halves are separable; the existing
combined `intakeTasks` stays working (its test stays green):
- `extractSeedsForIntake(cfg, params, deps?) → TaskSeed[]` — the extraction half.
- `createTasksFromSeeds(store, cfg, seeds, params, deps?) → { taskIds }` — break down each seed +
  `addTask` (the current back half).
- `intakeTasks` becomes `extractSeedsForIntake` then `createTasksFromSeeds` (unchanged behavior).

New `src/server/duplicateCheck.ts`: `checkSeedsForDuplicates(store, cfg, seeds, run?)`:
- Build `existing` from `store.listTasks()` (ALL statuses → open + done) as `{ id, title, status }`.
- Map seeds → `DupCandidate[]` (`title`, `details`).
- Call `findDuplicates` with `{ model: cfg.models.duplicate, effort: cfg.effort.duplicate }`.
- Return enriched matches: `{ seedIndex, taskId, title, status, reason }` (title/status looked up
  from the store).

Routes (`src/server/app.ts`):
- **`POST /api/tasks/intake/check`** — body `{ prompt, image?, intent?, priority? }`. Writes the
  optional image to a temp file, `extractSeedsForIntake`, then `checkSeedsForDuplicates`. Returns
  `{ seeds: TaskSeed[], duplicates: EnrichedMatch[] }`. Cleans up the temp image. (intent/priority
  are accepted but only used at create time; ignored here.)
- **`POST /api/tasks/intake/create`** — body `{ seeds: TaskSeed[], intent?, priority? }`. Validates
  seeds, `createTasksFromSeeds`, `replanner.requestReplan("adhoc")`. Returns `{ count, taskIds }`.
- The combined `POST /api/tasks/intake` route stays (no dup check) for back-compat.

Web client (`src/web/api.ts`):
- `checkIntake(params) → { seeds, duplicates }`.
- `createTasksFromSeeds(seeds, intent?, priority?) → { count, taskIds }`.
- Keep `createTasksFromIntake` (used by nothing after this change, but harmless) — actually
  superseded; the AddTask flow now uses check + create.

`AddTask.tsx` (two-step):
- State adds `pending: { seeds, duplicates } | null`.
- submit → `checkIntake`. If `duplicates.length` → `setPending(...)` and render a warning panel
  (do not create). Else → `createTasksFromSeeds(seeds, …)` immediately, clear, `onAdded()`.
- Warning panel lists each duplicate: `⚠ "<seed title>" looks like #<id> "<existing title>"
  (<status>) — <reason>`. Buttons: **Add anyway** → `createTasksFromSeeds(pending.seeds, …)` then
  clear + `onAdded()`; **Cancel** → `setPending(null)` (keep typed text + image for editing).
- A single "Add anyway" creates ALL seeds (no per-seed selection in v1).

## D. CLI

`spear add` gains `--force`. Before breakdown/create:
- Build `existing` from `store.listTasks()`, candidate = `[{ title, details: opts.description }]`.
- `findDuplicates` on `{ model: cfg.models.duplicate, effort: cfg.effort.duplicate }`.
- If matches and not `--force`: print each as `⚠ similar to #<id> "<title>" (<status>) — <reason>`,
  then `use --force to add anyway`, set `process.exitCode = 1`, and return WITHOUT creating.
- Else proceed with the existing breakdown + `addTask`.

## E. Testing (TDD)

- `src/llm/duplicates.test.ts` — fake runner: valid matches returned (`candidateIndex`/`taskId`/
  `reason`); out-of-range `candidate_index` and unknown `task_id` dropped; empty candidates/existing
  → `[]` with no runner call.
- `src/server/duplicateCheck.test.ts` — in-memory store + fake runner: builds refs from all tasks
  (incl. done), enriches matches with title + status.
- `src/server/intake.test.ts` — keep the existing `intakeTasks` tests green after the refactor; add a
  focused `createTasksFromSeeds` test (creates one task per seed; applies priority).
- No route/CLI unit tests (consistent with the existing codebase); covered by live smoke.

## Cross-cutting

- No new runtime dependencies. Reuses `claudeStructured` + `zod/v4`.
- Effort flags: the duplicate call passes `effort: "low"` (must, or it inherits the user's global).
- **Latency:** a GUI add now does extraction (~6s, opus breakdown model) → dup-check (~4s, sonnet) →
  on proceed, breakdown (~12s). The ~4s dup-check is new; no-duplicate adds auto-proceed.
- **Release:** ship as **v0.1.20** — build, install locally (`npm run build` + reinstall), push to
  the repo, and cut a tagged `v0.1.20` dmg release.

## Rejected alternatives

- **Deterministic / exact-title match** — instant and no LLM, but misses rephrasings; rejected per the
  LLM-only design and the "similarity" requirement.
- **Fold the duplicate check into the extraction call** — one call, but the user wants the similarity
  judgment on Sonnet specifically (cheaper) while extraction stays on the default model; kept separate.
- **Per-seed "skip this one" selection** — deferred (YAGNI); v1 is a single "Add anyway" (all) / "Cancel".
- **Check only the typed prompt (not each extracted task)** — rejected; the user chose per-extracted-task.

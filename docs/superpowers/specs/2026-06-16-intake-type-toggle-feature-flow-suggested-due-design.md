# spear: Multimodal/multi-task intake, type toggle, feature flow, and suggested due dates

**Date:** 2026-06-16
**Target version:** v0.1.18 (tagged dmg release + repo push)
**Status:** Approved design → ready for implementation plan

## Summary

Four related additions to spear's task-capture pipeline, all keeping the LLM-only
(no deterministic planning logic) principle intact:

- **A. Intake extraction (image + text → 1..N tasks).** The GUI AddTask box accepts a
  pasted image alongside the typed prompt. Both image and plain text can produce
  multiple tasks. Each extracted task seed runs through the existing breakdown pipeline.
- **B. Features always break into Planning → Implementation → Testing.** Prompt-only
  enforcement (no structural backstop), respecting the no-deterministic-logic rule.
- **C. Auto / Task / Feature toggle.** An explicit intent selector on capture.
- **D. Pre-computed suggested due dates.** A background pass stores a suggested due date +
  reason for every task lacking a real deadline, so clicking `due` shows it instantly.
- **E. Configurable lane count.** A control in the dashboard header sets the planner's
  `maxLanes`; changing it persists to config and triggers a re-plan that reorders everything
  into the requested number of lanes.

No new runtime dependencies. Reuses the `claudeStructured` + `zod/v4` CLI path.

## Background / current state

- Breakdown is a single Claude-CLI call: `src/llm/breakdown.ts` builds a SYSTEM prompt,
  `claudeStructured` validates the JSON against `BreakdownSchema`. `forcedType` is already
  plumbed through `BreakdownRequest`.
- The SYSTEM prompt *suggests* a Planning→Implementation→Testing flow for sizable features
  but does not require it, so features frequently collapse to a single planning stage.
- `AddTask.tsx` is a single text input + a priority `<select>` calling `createTask(title, priority)`.
- `commands/due.ts` + `setTaskDue` only set a date; there is no suggestion.
- `cli.ts` runs `claude -p <prompt> --output-format json`; no image passing today.
- Re-plan runs **only on new-task additions** (v0.1.15), not on start/done — this is the
  natural "board changed" signal we hook the suggested-due pass onto.

## A. Intake extraction — image + text → 1..N tasks

### Behavior
The GUI capture box (AddTask) always routes through a new **intake** step:

1. User types a prompt and optionally pastes an image; picks priority (auto/explicit) and
   intent (auto/task/feature).
2. Server receives `{ prompt, image?, intent, priority }`. If an image is present it is
   written to a temp file.
3. `extractTaskSeeds(prompt, imagePath?)` returns **1..N seeds**, each `{ title, details }`.
   - Plain text describing one task → 1 seed. Plain text describing several → multiple seeds.
   - Image (with or without text) → seeds derived from the image + text.
4. Each seed runs through the **existing** `breakdownForAdd` pipeline **in parallel**
   (`Promise.all`), with the chosen `intent` and `priority` override applied to every seed.
5. All resulting tasks are inserted; a **single** re-plan fires at the end.

CLI `spear add "X"` keeps its current **single-task** behavior (precise/scripted adds such
as the dock-orbit ingestion must not be re-split). The intake-extraction path is GUI-only.
(`spear add --image <path>` may be added if cheap; not required.)

### Latency
The extraction call runs at **low** effort (cheap, ~5–8s). Per-seed breakdowns run
concurrently, so wall-clock ≈ one extraction + one breakdown regardless of N. Net cost vs
today's single add: one extra low-effort extraction call (~6s). Accepted.

### Components
- `src/llm/intake.ts`: `extractTaskSeeds(prompt, imagePath?, run?)` → `IntakeOutput`.
- `src/llm/schemas.ts`: `IntakeSchema = { seeds: [{ title, details }] }`.
- The image is read by the Claude CLI's `Read` tool. The headless call must pass
  `--allowedTools Read` (and the appropriate permission flag, e.g. permission-mode) so the
  model can actually open the temp file in `-p` mode. **This is the one external unknown and
  must be spiked/verified before building the rest.**
- Temp image file is deleted after extraction (success or failure).
- Server: extend the task-creation route (or add `POST /api/tasks/intake`) to accept
  `prompt`, optional base64 `image` + mime, `intent`, `priority`; orchestrate steps 3–5.
- `AddTask.tsx`: capture clipboard-paste images, show a thumbnail with a remove control,
  send base64 on submit. No image and single-sentence prompt still works as before (just via
  the intake path).

## B. Features always get Planning + Implementation + Testing (prompt-only)

Strengthen the SYSTEM prompt in `src/llm/breakdown.ts`: **whenever the resolved type is
`feature`**, the model MUST emit at least Planning → Implementation → Testing stages (add
Stage Testing when staging QA applies). Keep the "don't add ceremony a small task doesn't
need" guidance for non-features. No structural/deterministic backstop — 100% LLM-decided, per
the no-deterministic-logic rule. Prompt change only.

## C. Auto / Task / Feature toggle

- `BreakdownRequest` gains `intent?: 'task' | 'feature'` (undefined = auto).
- `buildPrompt` branches:
  - **auto** → unchanged (LLM classifies).
  - **feature** → force `type = feature` + the full feature flow from (B).
  - **task** → "This is a simple task, not a feature. Keep it lean (usually one stage).
    Classify the type among bug/chore/research/other — never feature."
- `AddTask.tsx`: a selector next to the priority dropdown (Auto / Task / Feature).
- CLI: `spear add --task` / `--feature` flags map to `intent`.
- The selected intent applies to every seed produced by intake extraction (A).

## D. Pre-computed suggested due dates

### Schema
Migration adds two nullable columns to `tasks`: `suggested_due TEXT`,
`suggested_due_reason TEXT`. (Follow the existing migration pattern in `src/db/schema.ts`.)

### Suggestion pass
- `src/llm/suggestDue.ts`: `suggestDueDates(snapshot, run?)` — one **low-effort** call takes a
  board snapshot (each task's id/title/type/priority/status/due/effort) and returns, for each
  task **without a real due date**, a `{ taskId, date, reason }`. Returns nothing for tasks
  that already have a due date.
- `src/llm/schemas.ts`: `SuggestDueSchema = { suggestions: [{ task_id, date, reason }] }`.

### When it runs
- As a **background pass right after each re-plan** (re-plan already fires on new-task
  additions, so suggestions stay current with "the other tasks I have").
- A **backfill on server boot** for any undated task missing a stored suggestion.
- It never blocks the UI: the UI only ever reads stored values.
- Completions do **not** refresh suggestions (only additions do). Acceptable for v1; noted.

### UX
- Clicking `due` opens the editor and **immediately** shows `spear suggests {date} — {why}`
  as a one-click chip (reads the stored `suggested_due` / `suggested_due_reason`), with manual
  entry still available.
- If no suggestion is stored yet, the chip simply doesn't render.
- Setting a real due date makes the suggestion irrelevant (only shown when `due` is empty).
- Task DTO (`src/server/dto.ts`) includes `suggestedDue` + `suggestedDueReason`.

## E. Configurable lane count

`cfg.maxLanes` already flows `cfg → llmPlan → systemPrompt(maxLanes)` and bounds how the
planner groups themes into lanes. Expose it:

- **Server:** `GET /api/config` → `{ maxLanes }`. `POST /api/config/lanes` `{ lanes }` →
  validate integer in `[1, 8]`, **mutate `cfg.maxLanes` in place** (the running `Replanner`
  holds the same `cfg` object, so the next plan picks it up), `saveConfig(cfg)` to persist for
  next boot, then `replanner.requestReplan("manual")`.
- **Web:** `fetchConfig()` + `setMaxLanes(n)`; a small selector in the header (`App.tsx` `.bar`)
  showing the current count. Changing it calls `setMaxLanes` — the re-plan's SSE refresh updates
  the board.
- No new persisted state beyond the existing `config.json`.

## Cross-cutting

- **Tests (TDD):** each new module — `intake`, `suggestDue`, the breakdown prompt change, the
  schema migration — gets vitest coverage with an injected fake `ClaudeRunner`, matching the
  existing `breakdown.test.ts` / `planner.test.ts` pattern.
- **No new dependencies.**
- **Effort flags:** extraction and suggested-due both run at **low** effort (must pass
  `--effort` or they inherit the user's global `xhigh`).
- **Release:** ship as **v0.1.18** — build, install locally (`npm run build` + reinstall),
  push to the repo, and cut a tagged `v0.1.18` dmg release (push the `v0.1.18` tag → the
  release workflow builds + publishes the dmg; ad-hoc signing via `scripts/afterPack.cjs`).

## Rejected alternatives

- **Fuse extraction + breakdown into one call** (return N full breakdowns). Rejected: reusing
  `breakdownForAdd` per seed keeps every task consistent (same feature-stage rules, same
  priority logic) and is far simpler to test; parallel breakdowns already bound the latency.
- **Fold suggested-due into the planner call** (it has full board context). Rejected: avoids
  touching the heavily-iterated planner; an isolated low-effort pass is lower-risk and
  independently testable.
- **Structural backstop for feature stages.** Rejected per the explicit no-deterministic-logic
  preference — (B) is prompt-only.

## Open implementation risks

1. **Headless image reading** (A): confirm `claude -p` + `--allowedTools Read` (+ permission
   flag) actually reads a temp image. Spike this first.
2. Latency creep if a user pastes an image listing many tasks (N parallel breakdowns each at
   medium effort). Bounded by concurrency but worth a sanity check.

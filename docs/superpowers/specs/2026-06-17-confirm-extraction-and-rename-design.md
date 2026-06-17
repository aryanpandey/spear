# spear: confirm-and-edit on extraction + rename created tasks

**Date:** 2026-06-17
**Target version:** v0.1.21 (tagged dmg release + repo push)
**Status:** Approved design → ready for implementation plan

## Summary

Two task-capture/edit improvements:
- **A. Confirm-and-edit popup** before creating tasks whenever a capture is uncertain — an image was
  used OR extraction yielded 2+ tasks OR a duplicate was flagged. The user can edit each task's title
  and details and remove unwanted ones before they're created.
- **B. Rename a created task** inline from the Board, Today, and Week views.

Feature A reuses the existing two-step intake (`/api/tasks/intake/check` → `/create`); no backend
change. Feature B adds a small rename path (service + route + reusable component).

## A. Confirm-and-edit popup

### When it appears
After `AddTask` calls `POST /api/tasks/intake/check` (which returns `{ seeds, duplicates }`), a pure
decision decides whether to confirm:

```
needsConfirm({ imageUsed, seedCount, duplicateCount }) =
  imageUsed || seedCount >= 2 || duplicateCount > 0
```

- **true** → render the editable confirm popup; nothing is created yet.
- **false** (single typed task, no image, no duplicate) → auto-create immediately (today's fast path).

### The popup
- One **row per extracted seed**: an editable `title` (text input) and `details` (textarea), plus a
  **✕ remove** control for the row.
- Rows the duplicate check flagged show an inline **⚠** note: `#<id> "<existing title>" (<status>) — <reason>`.
- Footer buttons:
  - **Create N task(s)** — disabled when there are 0 rows or any row has a blank title. Calls the
    existing `createTasksFromSeeds(rows, intent, priority)` with the edited rows.
  - **Cancel** — discards the popup, keeps the typed text + pasted image so the user can retry.
- The ⚠ flags are advisory from the initial extraction; editing a title does NOT re-run the duplicate
  check (keeps it to a single check round-trip).

### Components / files
- `src/web/components/AddTask.tsx` — replace the current `pending` (duplicates-only) state with a
  `confirm` state holding editable rows `{ title, details, dup: DuplicateMatch | null }`; build rows
  from `{ seeds, duplicates }` by mapping each duplicate onto its `seedIndex`. Track whether an image
  was used for the `needsConfirm` decision.
- `src/web/lib/needsConfirm.ts` (new, tiny) — the pure `needsConfirm` function, unit-tested.
- `src/web/styles.css` — popup styles (extends the existing `.dup-warn` look).
- No server change; `checkIntake` + `createTasksFromSeeds` already exist.

## B. Rename a created task

### Backend
- `setTaskTitle(store, id, title)` in `src/service.ts`: throws on unknown task; `title.trim()` must be
  non-empty (throw otherwise); `store.updateTask(id, { title: trimmed })`.
- `POST /api/tasks/:id/title` in `src/server/app.ts`: body `{ title }`; 404 unknown id, 400 empty
  title; on success broadcast `{ type: "update", source: "refresh" }` (NO re-plan — consistent with
  the priority/due routes) and return `{ task }`.

### Web
- `setTaskTitle(id, title)` in `src/web/api.ts` (POST, throws on non-ok).
- `src/web/components/EditableTitle.tsx` (new): props `{ id, title, onChange, className? }`. Renders the
  title as a clickable element; clicking enters edit mode (a controlled `<input>` seeded with the
  current title). **Enter** or **blur** saves (calls `setTaskTitle` then `onChange()`); **Escape**
  cancels; a blank/whitespace title cancels without saving. Stops click propagation so it doesn't
  trigger surrounding card handlers.
- Used in:
  - `src/web/components/Board.tsx` — the title token in `TaskCard`.
  - `src/web/components/Today.tsx` — the task-name token (phase stages render
    `EditableTitle · stage.name`; non-phase render it in the muted `#id title` line).
  - `src/web/components/Calendar.tsx` — the task title shown on each Week card.

## Testing

- `src/web/lib/needsConfirm.test.ts` — truth table: image-only true; 2+ seeds true; any duplicate true;
  single typed task with no image/dup false.
- `src/service.test.ts` — `setTaskTitle` renames a task; rejects an empty / whitespace-only title.
- No React component tests (consistent with the repo); the routes are exercised by the live smoke.

## Cross-cutting

- Renaming never triggers a re-plan; it refreshes the view (the next natural re-plan picks up the new
  title for theme grouping).
- No new runtime dependencies.
- **Docs:** add a `## [0.1.21]` entry to `CHANGELOG.md`.
- **Release:** ship as **v0.1.21** — build, install locally, push, tag → dmg release; then refresh the
  local desktop install.

## Rejected alternatives

- **Confirm on every add (incl. single typed task)** — rejected; keeps an unnecessary click on the
  common single-capture path. Confirm only when uncertain (image / multi / duplicate).
- **"Add a blank row" in the popup** — deferred (YAGNI); the popup edits/removes the extracted rows only.
- **Re-running the duplicate check on every title edit in the popup** — rejected; extra latency for
  marginal value. Flags are advisory from the initial extraction.
- **Editing the description (not just the title) on existing tasks** — out of scope; the request is task
  *names*. `EditableTitle` is title-only.

# spear: task detail sub-view with notes + image attachments

**Date:** 2026-06-18
**Target version:** v0.1.27 (tagged dmg release + repo push)
**Status:** Approved design → ready for implementation plan

## Summary

Clicking a task card (on Board, Today, or Week) opens a **task detail sub-view** that takes over the
main area (with a **← back**). The detail shows the task's info and adds two editable sections: a single
free-form **Notes & details** field (backed by the existing `description`) and **image attachments**
(stored as files under `~/.spear/attachments/`).

## A. Detail sub-view (web)

- `App` holds `selectedTaskId: number | null`. Board/Today/Week cards get an `onOpen(taskId)` prop;
  clicking a card's **body** calls it. Interactive controls don't open the detail — the card's click
  handler ignores clicks whose target is inside a `button, input, select, textarea, a` (and
  `EditableTitle`'s display span already `stopPropagation`s, so title-click still renames).
- When `selectedTaskId` is set, `<main>` renders `<TaskDetail>` **instead of** the active tab's content.
  A **← back** clears it; clicking any top tab also clears it (navigates to that tab).
- `src/web/components/TaskDetail.tsx` — props `{ taskId, onBack, onChange }`:
  - fetches `GET /api/tasks/:id` on mount / id change;
  - header: `← back`, the title via `EditableTitle`, and a meta row (`type · priority · status · due`);
  - the task's stages (name · kind · status) and blockers (`#id`);
  - **Notes & details** textarea (seeded from `description`), saved on blur via
    `POST /api/tasks/:id/description`, then refetch;
  - **Attachments**: a thumbnail grid; add by **paste / drag / file-pick**; click a thumbnail to open
    it full-size (new tab); ✕ to delete. Each action refetches the detail.

## B. Notes & details

- One free-form field backed by `tasks.description` (already exists; unused in the UI until now).
- `setTaskDescription(store, taskId, description)` in `src/service.ts`: requires the task; stores the
  value as-is (empty allowed); `store.updateTask(taskId, { description })`. No re-plan.
- `POST /api/tasks/:id/description` `{ description }` → 404 if unknown; sets it; broadcasts a refresh;
  returns `{ task }`.

## C. Image attachments

- **Storage on disk:** `paths.ts` gains `attachmentsDir()` → `~/.spear/attachments/`. Files are named
  `<uuid>.<ext>` (`ext` from `mimeExt` in `src/server/intake.ts`).
- **Schema:** new table in `src/db/schema.ts` (a new `CREATE TABLE IF NOT EXISTS` — applied to existing
  DBs automatically on open, no column migration needed):
  ```sql
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT,
    mime TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
  ```
- **Types:** `Attachment { id, task_id, filename, original_name, mime, created_at }` in `src/types.ts`.
- **Store CRUD** (`src/db/store.ts`): `addAttachment({task_id, filename, original_name, mime})`,
  `listAttachments(taskId)`, `getAttachment(id)`, `deleteAttachment(id)`.
- **Routes** (`src/server/app.ts`):
  - `POST /api/tasks/:id/attachments` `{ image: { mime, dataB64 }, name? }` → 404 if unknown task,
    400 if no image; `mkdirSync(attachmentsDir, {recursive:true})`; write `Buffer.from(dataB64,"base64")`
    to `<uuid>.<ext>`; `addAttachment`; broadcast refresh; return `{ attachment }`. (Within the 32 MB
    body limit from v0.1.22.)
  - `GET /api/attachments/:filename` → `path.basename` guard; stream the file from `attachmentsDir()`
    with a content-type inferred from the extension (png/jpg/jpeg/webp/gif).
  - `DELETE /api/attachments/:id` → look up; `fs.unlinkSync` the file (best-effort); `deleteAttachment`;
    broadcast refresh; return `{ ok: true }`.
  - Modify `DELETE /api/tasks/:id` to `unlink` the task's attachment files before `removeTask` (the row
    cascade handles the DB rows).
- **Detail DTO** (`src/server/dto.ts`): `AttachmentDto { id, taskId, filename, originalName, mime,
  createdAt, url }` (`url = "/api/attachments/" + filename`) and
  `taskDetailDto(store, id) → { task: {id,title,type,priority,status,due,description}, stages, blockers, attachments } | null`.

## D. Web API (`src/web/api.ts`)

- `AttachmentDto` + `TaskDetail` types.
- `fetchTask(id) → Promise<TaskDetail>` (GET `/api/tasks/:id`).
- `setTaskDescription(id, description) → Promise<void>`.
- `addAttachment(id, dataUrl, name?) → Promise<void>` (split the `data:<mime>;base64,<…>` URL → `{mime,dataB64}`).
- `deleteAttachment(attId) → Promise<void>`.

## E. Testing

- `src/service.test.ts` — `setTaskDescription` sets the description (incl. empty); throws on unknown task.
- `src/db/store.test.ts` — attachment CRUD: add → list → get → delete; `ON DELETE CASCADE` removes rows
  when the task is deleted.
- The detail UI + upload/serve are verified live.

## Cross-cutting

- No new runtime dependencies (reuses `mimeExt`, `randomUUID`, the 32 MB body limit).
- A new table via `SCHEMA_SQL` needs no `migrate()` change (it's `CREATE TABLE IF NOT EXISTS`).
- **Docs:** `## [0.1.27]` CHANGELOG entry. **Release** v0.1.27 + local refresh.

## Rejected alternatives

- **Embedding images as base64 in the DB** — rejected (bloats `spear.db`); files on disk + a metadata
  table is cleaner and supports full-size viewing/serving.
- **A small modal/side panel** — rejected; the user wants the detail to open as its own sub-view.
- **Separate `notes` + `details` columns** — rejected; one free-form field (the existing `description`).

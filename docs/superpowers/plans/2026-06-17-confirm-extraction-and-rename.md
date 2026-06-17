# spear v0.1.21 — confirm-and-edit on extraction + rename tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an editable confirm popup before creating tasks when a capture is uncertain (image used, 2+ tasks extracted, or a duplicate flagged), and let the user rename any created task inline from Board / Today / Week.

**Architecture:** Feature A is frontend-only — it reuses the existing `intake/check → intake/create` round-trip and inserts an editable review step in `AddTask`. Feature B adds a thin rename path (`setTaskTitle` service + `POST /api/tasks/:id/title`, no re-plan) and a reusable `EditableTitle` component dropped into the three task views.

**Tech Stack:** Node/TS ESM, better-sqlite3, Fastify, React/Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-confirm-extraction-and-rename-design.md`

---

## File Structure

**New files**
- `src/web/lib/needsConfirm.ts` (+ test) — the pure "show the confirm popup?" rule.
- `src/web/components/EditableTitle.tsx` — reusable inline rename control.

**Modified files**
- `src/service.ts` (+ `src/service.test.ts`) — `setTaskTitle`.
- `src/server/app.ts` — `POST /api/tasks/:id/title` + import.
- `src/web/api.ts` — `setTaskTitle`.
- `src/web/components/AddTask.tsx` — editable confirm popup (replaces the dup-only panel).
- `src/web/components/Board.tsx`, `Today.tsx`, `Calendar.tsx` — use `EditableTitle`.
- `src/web/styles.css` — confirm-popup + editable-title styles.
- `CHANGELOG.md`, `package.json`.

---

## Task 1: `needsConfirm` pure rule

**Files:**
- Create: `src/web/lib/needsConfirm.ts`
- Test: `src/web/lib/needsConfirm.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/web/lib/needsConfirm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { needsConfirm } from "./needsConfirm.js";

describe("needsConfirm", () => {
  it("confirms when an image was used", () => {
    expect(needsConfirm({ imageUsed: true, seedCount: 1, duplicateCount: 0 })).toBe(true);
  });
  it("confirms when 2+ tasks were extracted", () => {
    expect(needsConfirm({ imageUsed: false, seedCount: 2, duplicateCount: 0 })).toBe(true);
  });
  it("confirms when a duplicate was flagged", () => {
    expect(needsConfirm({ imageUsed: false, seedCount: 1, duplicateCount: 1 })).toBe(true);
  });
  it("does NOT confirm a single typed task with no image and no duplicate", () => {
    expect(needsConfirm({ imageUsed: false, seedCount: 1, duplicateCount: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/web/lib/needsConfirm.test.ts`
Expected: FAIL — cannot find module `./needsConfirm.js`.

- [ ] **Step 3: Implement** — create `src/web/lib/needsConfirm.ts`:

```ts
/** Whether to show the editable confirm popup before creating extracted tasks. */
export function needsConfirm(args: { imageUsed: boolean; seedCount: number; duplicateCount: number }): boolean {
  return args.imageUsed || args.seedCount >= 2 || args.duplicateCount > 0;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/web/lib/needsConfirm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/needsConfirm.ts src/web/lib/needsConfirm.test.ts
git commit -m "feat(web): needsConfirm rule for the extraction confirm popup"
```

---

## Task 2: `setTaskTitle` service

**Files:**
- Modify: `src/service.ts`
- Test: `src/service.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/service.test.ts` (it already constructs an in-memory store via the file's existing helper; reuse it. The snippet uses `freshStore()` / `addTask` the way other tests in that file do — match the actual helper names in the file):

```ts
import { setTaskTitle } from "./service.js";

describe("setTaskTitle", () => {
  it("renames a task (trimmed)", () => {
    const store = freshStore();
    const t = addTask(store, { title: "old name" }).task;
    const updated = setTaskTitle(store, t.id, "  new name  ");
    expect(updated.title).toBe("new name");
    expect(store.getTask(t.id)!.title).toBe("new name");
  });

  it("rejects an empty / whitespace title", () => {
    const store = freshStore();
    const t = addTask(store, { title: "keep" }).task;
    expect(() => setTaskTitle(store, t.id, "   ")).toThrow();
    expect(store.getTask(t.id)!.title).toBe("keep");
  });
});
```

> If `src/service.test.ts` builds its store differently (e.g. `new Store(openDb(":memory:"))` inline), use that exact construction instead of `freshStore()`, and import `addTask` if not already imported.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/service.test.ts -t setTaskTitle`
Expected: FAIL — `setTaskTitle` is not exported.

- [ ] **Step 3: Implement** — in `src/service.ts`, add after `setTaskPriority`:

```ts
/** Rename a task. Trims; rejects an empty title. */
export function setTaskTitle(store: Store, taskId: number, title: string): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  const t = title.trim();
  if (!t) throw new Error("title cannot be empty");
  store.updateTask(taskId, { title: t });
  return store.getTask(taskId)!;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service.ts src/service.test.ts
git commit -m "feat(service): setTaskTitle (rename, reject empty)"
```

---

## Task 3: title route + web client

**Files:**
- Modify: `src/server/app.ts`, `src/web/api.ts`

- [ ] **Step 1: Add the route.** In `src/server/app.ts`, add `setTaskTitle` to the service import:

Replace:
```ts
import { addTask, advanceTask, completeTask, removeTask, setTaskDue, setTaskPriority, setTaskStatus } from "../service.js";
```
with:
```ts
import { addTask, advanceTask, completeTask, removeTask, setTaskDue, setTaskPriority, setTaskStatus, setTaskTitle } from "../service.js";
```

Add the route immediately after the existing `app.post(".../:id/priority", …)` handler:

```ts
  app.post<{ Params: { id: string }; Body: { title?: string } }>("/api/tasks/:id/title", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getTask(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const title = typeof req.body?.title === "string" ? req.body.title : "";
    if (!title.trim()) {
      reply.code(400);
      return { error: "title required" };
    }
    const task = setTaskTitle(store, id, title);
    hub.broadcast({ type: "update", source: "refresh" }); // rename — no re-plan
    return { task };
  });
```

- [ ] **Step 2: Add the web client fn.** In `src/web/api.ts`, after `setTaskPriority`:

```ts
/** Rename a task; server refreshes (does not re-plan). */
export async function setTaskTitle(id: number, title: string): Promise<void> {
  const r = await fetch(`/api/tasks/${id}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error(`title ${r.status}`);
}
```

- [ ] **Step 3: Verify build + suite.**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/app.ts src/web/api.ts
git commit -m "feat: POST /api/tasks/:id/title rename route + client"
```

---

## Task 4: `EditableTitle` component

**Files:**
- Create: `src/web/components/EditableTitle.tsx`

- [ ] **Step 1: Implement** — create `src/web/components/EditableTitle.tsx`:

```tsx
import { useRef, useState } from "react";
import { setTaskTitle } from "../api";

/**
 * Inline task-title editor. Click the title → input; Enter/blur saves, Escape
 * cancels, a blank title cancels. `onEditingChange` lets a draggable parent (the
 * Week chip) disable dragging while editing. Stops click/mousedown propagation so
 * it doesn't trip surrounding card handlers.
 */
export function EditableTitle({
  id,
  title,
  onChange,
  className,
  onEditingChange,
}: {
  id: number;
  title: string;
  onChange: () => void;
  className?: string;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const cancelRef = useRef(false);

  function begin(e: React.MouseEvent) {
    e.stopPropagation();
    setValue(title);
    cancelRef.current = false;
    setEditing(true);
    onEditingChange?.(true);
  }
  function finish() {
    setEditing(false);
    onEditingChange?.(false);
  }
  async function commit() {
    if (cancelRef.current) {
      cancelRef.current = false;
      finish();
      return;
    }
    const t = value.trim();
    finish();
    if (!t || t === title) return;
    try {
      await setTaskTitle(id, t);
      onChange();
    } catch {
      /* leave the title as-is on failure */
    }
  }

  if (editing) {
    return (
      <input
        className={`title-edit-input ${className ?? ""}`}
        value={value}
        autoFocus
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            cancelRef.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <span className={`title-edit ${className ?? ""}`} title="Click to rename" onClick={begin}>
      {title}
    </span>
  );
}
```

- [ ] **Step 2: Verify build.**

Run: `npm run build:web`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/EditableTitle.tsx
git commit -m "feat(web): EditableTitle inline rename component"
```

---

## Task 5: AddTask — editable confirm popup

**Files:**
- Modify: `src/web/components/AddTask.tsx`, `src/web/styles.css`

- [ ] **Step 1: Replace the component.** Overwrite `src/web/components/AddTask.tsx` with:

```tsx
import { useState } from "react";
import { checkIntake, createTasksFromSeeds, type DuplicateMatch, type Intent, type Priority, type TaskSeed } from "../api";
import { needsConfirm } from "../lib/needsConfirm";

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

interface Row {
  title: string;
  details: string;
  dup: DuplicateMatch | null;
}

/**
 * Inline capture for the Today tab. After /intake/check, an uncertain capture
 * (image used, 2+ tasks, or a flagged duplicate) opens an editable confirm popup;
 * a single typed task with no duplicate is created immediately.
 */
export function AddTask({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"auto" | Priority>("auto");
  const [intent, setIntent] = useState<"auto" | Intent>("auto");
  const [image, setImage] = useState<string | null>(null); // data URL
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null); // confirm popup open when non-null

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
    setRows(null);
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
      const imageUsed = !!image;
      const { seeds, duplicates } = await checkIntake({ prompt: t, imageDataUrl: image ?? undefined });
      if (needsConfirm({ imageUsed, seedCount: seeds.length, duplicateCount: duplicates.length })) {
        setRows(seeds.map((s, i) => ({ title: s.title, details: s.details, dup: duplicates.find((d) => d.seedIndex === i) ?? null })));
      } else {
        await create(seeds);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function patchRow(i: number, patch: Partial<Row>) {
    setRows((rs) => (rs ? rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : rs));
  }
  function removeRow(i: number) {
    setRows((rs) => (rs ? rs.filter((_, idx) => idx !== i) : rs));
  }

  async function createFromRows() {
    if (!rows) return;
    setBusy(true);
    setErr(null);
    try {
      await create(rows.map((r) => ({ title: r.title.trim(), details: r.details })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canCreate = !!rows && rows.length > 0 && rows.every((r) => r.title.trim());

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

      {rows && (
        <div className="confirm-extract">
          <div className="confirm-head">
            review {rows.length} task{rows.length === 1 ? "" : "s"} before adding — edit or remove any
          </div>
          {rows.map((r, i) => (
            <div className="confirm-row" key={i}>
              <div className="confirm-fields">
                <input
                  className="confirm-title"
                  value={r.title}
                  placeholder="task title"
                  onChange={(e) => patchRow(i, { title: e.target.value })}
                />
                <textarea
                  className="confirm-details"
                  value={r.details}
                  rows={2}
                  placeholder="details (context for the breakdown)"
                  onChange={(e) => patchRow(i, { details: e.target.value })}
                />
                {r.dup && (
                  <div className="confirm-dup">
                    ⚠ like #{r.dup.taskId} “{r.dup.title}” ({r.dup.status}) — {r.dup.reason}
                  </div>
                )}
              </div>
              <button type="button" className="confirm-remove" title="remove this task" onClick={() => removeRow(i)}>
                ✕
              </button>
            </div>
          ))}
          <div className="confirm-actions">
            <button type="button" className="add-task-btn" disabled={busy || !canCreate} onClick={() => void createFromRows()}>
              {busy ? "…" : `Create ${rows.length} task${rows.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="dup-cancel" onClick={() => setRows(null)} disabled={busy}>
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
/* ---- v0.1.21: extraction confirm popup ---- */
.confirm-extract {
  flex-basis: 100%;
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--green, #00ff41);
  border-radius: 4px;
  background: rgba(0, 255, 65, 0.05);
  font-size: 12px;
}
.confirm-head { color: var(--green, #00ff41); margin-bottom: 8px; }
.confirm-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
.confirm-fields { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.confirm-title, .confirm-details {
  width: 100%;
  background: #0a0e0a;
  color: var(--fg, #cfe8d4);
  border: 1px solid #1c3a24;
  border-radius: 3px;
  padding: 4px 6px;
  font: inherit;
}
.confirm-title { font-weight: 600; }
.confirm-details { resize: vertical; }
.confirm-dup { color: var(--warn, #e0b341); }
.confirm-remove { background: none; border: none; color: var(--crit, #ff5577); cursor: pointer; font-size: 13px; padding: 2px 4px; }
.confirm-actions { display: flex; gap: 8px; margin-top: 4px; }
```

- [ ] **Step 3: Verify build.**

Run: `npm run build:web`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/AddTask.tsx src/web/styles.css
git commit -m "feat(web): editable confirm popup for uncertain captures"
```

---

## Task 6: Board — inline rename

**Files:**
- Modify: `src/web/components/Board.tsx`

- [ ] **Step 1: Implement.** In `src/web/components/Board.tsx`:

Add the import after the existing imports:
```ts
import { EditableTitle } from "./EditableTitle";
```

Replace the title line:
```tsx
      <div className="title" style={{ marginTop: 4 }}>
        <span className="muted">#{task.id}</span> {task.title}
      </div>
```
with:
```tsx
      <div className="title" style={{ marginTop: 4 }}>
        <span className="muted">#{task.id}</span> <EditableTitle id={task.id} title={task.title} onChange={onChange} />
      </div>
```

- [ ] **Step 2: Verify build.**

Run: `npm run build:web`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/Board.tsx
git commit -m "feat(web): inline rename on Board task cards"
```

---

## Task 7: Today — inline rename

**Files:**
- Modify: `src/web/components/Today.tsx`

- [ ] **Step 1: Implement.** In `src/web/components/Today.tsx`:

Add the import:
```ts
import { EditableTitle } from "./EditableTitle";
```

In the `Item` component, replace the title + muted blocks. Replace:
```tsx
      <div className="title" style={{ marginTop: 4 }}>
        {title} <span className="kind">· {item.stage.kind}</span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        #{item.task.id}
        {isPhase ? "" : ` ${item.task.title}`}
      </div>
```
with:
```tsx
      <div className="title" style={{ marginTop: 4 }}>
        {isPhase ? (
          <>
            <EditableTitle id={item.task.id} title={item.task.title} onChange={onChange} /> · {item.stage.name}
          </>
        ) : (
          item.stage.name
        )}{" "}
        <span className="kind">· {item.stage.kind}</span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        #{item.task.id}
        {isPhase ? (
          ""
        ) : (
          <>
            {" "}
            <EditableTitle id={item.task.id} title={item.task.title} onChange={onChange} />
          </>
        )}
      </div>
```

Note: the `title` const (`const title = isPhase ? ... : item.stage.name;`) is no longer referenced in the JSX after this change. Remove its declaration to satisfy `noUnusedLocals` — delete the line:
```tsx
  const title = isPhase ? `${item.task.title} · ${item.stage.name}` : item.stage.name;
```

- [ ] **Step 2: Verify build.**

Run: `npm run build:web`
Expected: no type errors (if `title` was left declared-but-unused, remove it as noted).

- [ ] **Step 3: Commit**

```bash
git add src/web/components/Today.tsx
git commit -m "feat(web): inline rename on Today cards"
```

---

## Task 8: Week (Calendar) — inline rename (drag-safe)

**Files:**
- Modify: `src/web/components/Calendar.tsx`

A stable (module-level) chip component is used so an SSE refresh during an edit doesn't remount and
drop the rename.

- [ ] **Step 1: Implement.** In `src/web/components/Calendar.tsx`:

Add the import:
```ts
import { EditableTitle } from "./EditableTitle";
```

Add a module-level component (e.g. just below the imports / `fmtRange`, before `export function Calendar`):
```tsx
function CalChip({ task, onChange }: { task: BoardTask; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const drag = editing
    ? {}
    : {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          e.dataTransfer.setData("text/plain", String(task.id));
          e.dataTransfer.effectAllowed = "move";
        },
      };
  return (
    <div className={`cal-chip pri-${task.priority}${task.status === "done" ? " done" : ""}`} title={task.title} {...drag}>
      <span className="muted">#{task.id}</span>{" "}
      <EditableTitle id={task.id} title={task.title} onChange={onChange} onEditingChange={setEditing} />
    </div>
  );
}
```

Delete the now-unused inline `Card` and `dragProps` inside `Calendar`:
```tsx
  const dragProps = (task: BoardTask) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData("text/plain", String(task.id));
      e.dataTransfer.effectAllowed = "move";
    },
  });
```
```tsx
  const Card = ({ task }: { task: BoardTask }) => (
    <div
      className={`cal-chip pri-${task.priority}${task.status === "done" ? " done" : ""}`}
      title={task.title}
      {...dragProps(task)}
    >
      <span className="muted">#{task.id}</span> {task.title}
    </div>
  );
```

Update all four `<Card key={t.id} task={t} />` usages (overdue strip, day cells, unscheduled list) to:
```tsx
              <CalChip key={t.id} task={t} onChange={onChange} />
```

- [ ] **Step 2: Verify build.**

Run: `npm run build:web`
Expected: no type errors. (`CalChip` takes `onChange` as a prop; `dropProps` stays inside `Calendar`.)

- [ ] **Step 3: Commit**

```bash
git add src/web/components/Calendar.tsx
git commit -m "feat(web): inline rename on Week calendar chips (drag-safe)"
```

---

## Task 9: CHANGELOG, version bump, verify, smoke, release, local refresh

**Files:**
- Modify: `CHANGELOG.md`, `package.json`

- [ ] **Step 1: Add the changelog entry.** In `CHANGELOG.md`, insert above the `## [0.1.20]` heading:

```markdown
## [0.1.21] — 2026-06-17
### Added
- **Confirm-and-edit before creating** — when a capture is uncertain (an image was used, 2+ tasks were
  extracted, or a duplicate was flagged) the add bar shows an editable popup: tweak each task's title
  and details or remove it, then create. A single typed task with no duplicate still creates instantly.
- **Rename a task inline** from the Board, Today, and Week views (click the title).

```

- [ ] **Step 2: Bump the version.** In `package.json`, set `"version": "0.1.21"`.

- [ ] **Step 3: Full verification.**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests PASS, build produces `dist/` + `dist/web/`.

- [ ] **Step 4: Live smoke (throwaway home).**

```bash
export SPEAR_HOME=/tmp/spear-v21-$$
mkdir -p "$SPEAR_HOME"
node dist/cli.js serve --port 4402 >/tmp/spear-v21.log 2>&1 &
SRV=$!; sleep 2
# rename: create a task, rename it via the route, confirm
node dist/cli.js add "old title here" --force </dev/null >/dev/null 2>&1
ID=$(sqlite3 "$SPEAR_HOME/spear.db" "SELECT id FROM tasks ORDER BY id DESC LIMIT 1;")
curl -s -X POST "localhost:4402/api/tasks/$ID/title" -H 'content-type: application/json' -d '{"title":"renamed title"}' >/dev/null
echo "title now: $(sqlite3 "$SPEAR_HOME/spear.db" "SELECT title FROM tasks WHERE id=$ID;")  (expect 'renamed title')"
# empty title rejected
echo "empty-title status:"; curl -s -o /dev/null -w '%{http_code}\n' -X POST "localhost:4402/api/tasks/$ID/title" -H 'content-type: application/json' -d '{"title":"  "}'
kill $SRV 2>/dev/null; rm -rf "$SPEAR_HOME"; unset SPEAR_HOME
```
Expected: title becomes `renamed title`; the empty-title request returns `400`.

> The confirm popup is a frontend interaction — verify it in the live app during Step 8 (paste a
> multi-task capture → the editable popup appears → edit a title → Create).

- [ ] **Step 5: Commit.**

```bash
git add CHANGELOG.md package.json
git commit -m "chore: release v0.1.21 — confirm-on-extraction + task rename"
```

- [ ] **Step 6: Install locally.**

Run: `npm run build && npm link`
Expected: `spear --version` → `0.1.21`.

- [ ] **Step 7: Push + tag.**

```bash
git push origin main
git tag v0.1.21
git push origin v0.1.21
```

- [ ] **Step 8: Confirm release + refresh the local desktop app.**

Wait for CI:
```bash
gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
gh release view v0.1.21 --json assets --jq '.assets[].name'   # expect spear-0.1.21-arm64.dmg
```
Then refresh the installed app (download → verify sha512 → quit → swap into /Applications → de-quarantine → relaunch), as done for v0.1.19/0.1.20. Paste a multi-task capture into the running app and confirm the editable popup appears and a renamed title sticks.

---

## Self-Review

**Spec coverage:**
- A: confirm rule (Task 1), popup UI in AddTask (Task 5). `needsConfirm = image || 2+ seeds || dup` ✔; editable title+details+remove ✔; dup flags inline ✔; reuses check/create (no backend) ✔.
- B: `setTaskTitle` service (Task 2), route + client (Task 3), `EditableTitle` (Task 4), wired into Board/Today/Week (Tasks 6/7/8). No re-plan on rename ✔; drag-safe Week chip ✔.
- Docs CHANGELOG + release v0.1.21: Task 9. ✔

**Placeholder scan:** No TBD/TODO. Tasks 2 and 7 contain guarded instructions ("match the file's helper", "remove the now-unused `title` const") — concrete, not placeholders.

**Type consistency:** `setTaskTitle(store, id, title)` (Task 2) ↔ route (Task 3) ↔ `EditableTitle`'s `setTaskTitle(id, title)` web client (Task 3) are consistent. `needsConfirm({ imageUsed, seedCount, duplicateCount })` matches between definition (Task 1) and call site (Task 5). `Row { title, details, dup: DuplicateMatch | null }` and `DuplicateMatch.seedIndex` (from v0.1.20 `api.ts`) are used consistently in Task 5. `EditableTitle` props `{ id, title, onChange, className?, onEditingChange? }` match all four call sites (Tasks 5–8; only Calendar passes `onEditingChange`).

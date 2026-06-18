# spear v0.1.27 — task detail sub-view + notes + image attachments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a task (Board/Today/Week) opens a detail sub-view with an editable Notes & details field (the existing `description`) and image attachments stored under `~/.spear/attachments/`.

**Architecture:** Backend gains an `attachments` table + file storage + a task-detail DTO + field/attachment routes. The web app adds a `TaskDetail` takeover view selected by `selectedTaskId`, with card-body clicks (guarded against interactive targets) opening it.

**Tech Stack:** Node/TS ESM, better-sqlite3, Fastify, React/Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-task-detail-notes-attachments-design.md`

---

## File Structure
**New:** `src/web/components/TaskDetail.tsx`.
**Modified:** `src/paths.ts`, `src/db/schema.ts`, `src/types.ts`, `src/db/store.ts` (+test),
`src/service.ts` (+test), `src/server/dto.ts`, `src/server/app.ts`, `src/web/api.ts`, `src/web/App.tsx`,
`src/web/components/{Board,Today,Calendar}.tsx`, `src/web/styles.css`, `CHANGELOG.md`, `package.json`.

---

## Task 1: `attachmentsDir` + schema table + `Attachment` type

**Files:** Modify `src/paths.ts`, `src/db/schema.ts`, `src/types.ts`

- [ ] **Step 1: paths.** In `src/paths.ts`, add after `notionSeedPath`:
```ts
export function attachmentsDir(): string {
  return path.join(spearHome(), "attachments");
}
```

- [ ] **Step 2: schema.** In `src/db/schema.ts`, add this block to `SCHEMA_SQL` (before the closing backtick):
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

- [ ] **Step 3: type.** In `src/types.ts`, add after the `Stage` interface:
```ts
export interface Attachment {
  id: number;
  task_id: number;
  filename: string;
  original_name: string | null;
  mime: string;
  created_at: string;
}
```

- [ ] **Step 4: Verify.** `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/paths.ts src/db/schema.ts src/types.ts
git commit -m "feat(db): attachments table + Attachment type + attachmentsDir"
```

---

## Task 2: Store attachment CRUD

**Files:** Modify `src/db/store.ts`; Test `src/db/store.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/db/store.test.ts`:
```ts
describe("attachments", () => {
  it("adds, lists, gets, deletes; cascades on task delete", () => {
    const store = freshStore();
    const t = store.createTask({ title: "t" });
    const a = store.addAttachment({ task_id: t.id, filename: "x.png", original_name: "shot.png", mime: "image/png" });
    expect(a.id).toBeGreaterThan(0);
    expect(store.listAttachments(t.id).map((r) => r.filename)).toEqual(["x.png"]);
    expect(store.getAttachment(a.id)!.mime).toBe("image/png");
    store.deleteAttachment(a.id);
    expect(store.listAttachments(t.id)).toHaveLength(0);

    const b = store.addAttachment({ task_id: t.id, filename: "y.png", original_name: null, mime: "image/png" });
    store.deleteTask(t.id); // ON DELETE CASCADE
    expect(store.getAttachment(b.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/db/store.test.ts -t attachments` → FAIL.

- [ ] **Step 3: Implement.** In `src/db/store.ts`, add `Attachment` to the type import from `../types.js`, and add a `NewAttachment` interface near the other `New*` interfaces:
```ts
export interface NewAttachment {
  task_id: number;
  filename: string;
  original_name?: string | null;
  mime: string;
}
```
Add these methods inside the `Store` class (e.g. after the stages section):
```ts
  // ---- attachments ----

  addAttachment(input: NewAttachment): Attachment {
    const info = this.db
      .prepare(
        `INSERT INTO attachments (task_id, filename, original_name, mime, created_at)
         VALUES (@task_id, @filename, @original_name, @mime, @created_at)`,
      )
      .run({
        task_id: input.task_id,
        filename: input.filename,
        original_name: input.original_name ?? null,
        mime: input.mime,
        created_at: nowIso(),
      });
    return this.getAttachment(Number(info.lastInsertRowid))!;
  }

  getAttachment(id: number): Attachment | undefined {
    const row = this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as Attachment | undefined;
    return row ?? undefined;
  }

  listAttachments(taskId: number): Attachment[] {
    return this.db
      .prepare("SELECT * FROM attachments WHERE task_id = ? ORDER BY id ASC")
      .all(taskId) as Attachment[];
  }

  deleteAttachment(id: number): void {
    this.db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
  }
```
(`Attachment`'s columns map 1:1 to the table, so no row-mapper is needed.)

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/db/store.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/db/store.ts src/db/store.test.ts
git commit -m "feat(db): attachment CRUD on Store"
```

---

## Task 3: `setTaskDescription` service

**Files:** Modify `src/service.ts`; Test `src/service.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `src/service.test.ts` (add `setTaskDescription` to the `from "./service.js"` import):
```ts
describe("setTaskDescription", () => {
  it("sets the description (incl. empty) and throws on unknown", () => {
    const store = freshStore();
    const t = addTask(store, { title: "t" }).task;
    expect(setTaskDescription(store, t.id, "some notes").description).toBe("some notes");
    expect(setTaskDescription(store, t.id, "").description).toBe("");
    expect(() => setTaskDescription(store, 9999, "x")).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/service.test.ts -t setTaskDescription` → FAIL.

- [ ] **Step 3: Implement.** In `src/service.ts`, add after `setTaskTitle`:
```ts
/** Set a task's free-form notes/details (the description). Empty is allowed. */
export function setTaskDescription(store: Store, taskId: number, description: string): Task {
  if (!store.getTask(taskId)) throw new Error(`task ${taskId} not found`);
  store.updateTask(taskId, { description });
  return store.getTask(taskId)!;
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/service.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/service.ts src/service.test.ts
git commit -m "feat(service): setTaskDescription"
```

---

## Task 4: Detail DTO

**Files:** Modify `src/server/dto.ts`

- [ ] **Step 1: Implement.** In `src/server/dto.ts`, append:
```ts
export interface AttachmentDto {
  id: number;
  taskId: number;
  filename: string;
  originalName: string | null;
  mime: string;
  createdAt: string;
  url: string;
}

export interface TaskDetailDto {
  task: {
    id: number;
    title: string;
    type: TaskType;
    priority: Priority;
    status: TaskStatus;
    due: string | null;
    description: string;
  };
  stages: BoardStageDto[];
  blockedBy: number[];
  openBlockers: number[];
  attachments: AttachmentDto[];
}

export function taskDetailDto(store: Store, id: number): TaskDetailDto | null {
  const task = store.getTask(id);
  if (!task) return null;
  return {
    task: {
      id: task.id,
      title: task.title,
      type: task.type,
      priority: task.priority,
      status: task.status,
      due: task.due,
      description: task.description,
    },
    stages: store.getStages(id).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      seq: s.seq,
      status: s.status,
      effort: s.effort,
      delegatable_to: s.delegatable_to,
    })),
    blockedBy: store.blockedBy(id),
    openBlockers: openDependencies(store, id),
    attachments: store.listAttachments(id).map((a) => ({
      id: a.id,
      taskId: a.task_id,
      filename: a.filename,
      originalName: a.original_name,
      mime: a.mime,
      createdAt: a.created_at,
      url: `/api/attachments/${encodeURIComponent(a.filename)}`,
    })),
  };
}
```
(`BoardStageDto`, `openDependencies`, `TaskType`/`Priority`/`TaskStatus` are already imported in this file.)

- [ ] **Step 2: Verify.** `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**
```bash
git add src/server/dto.ts
git commit -m "feat(dto): taskDetailDto + AttachmentDto"
```

---

## Task 5: Routes — detail, description, attachments

**Files:** Modify `src/server/app.ts`

- [ ] **Step 1: Imports.** In `src/server/app.ts`:

Add `setTaskDescription` to the service import:
```ts
import { addTask, advanceTask, completeTask, removeTask, setTaskDue, setTaskPriority, setTaskStatus, setTaskTitle, setTaskDescription } from "../service.js";
```
Add near the dto import:
```ts
import { boardDto, todayDto, taskDetailDto } from "./dto.js";
```
(adjust the existing `./dto.js` import to include `taskDetailDto`.)
Add the attachments dir import (where `paths`-style imports live — there are none yet; add it):
```ts
import { attachmentsDir } from "../paths.js";
```

- [ ] **Step 2: Detail + description routes.** Add right after the existing `POST /api/tasks/:id/title` handler:
```ts
  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    const dto = taskDetailDto(store, Number(req.params.id));
    if (!dto) {
      reply.code(404);
      return { error: "not found" };
    }
    return dto;
  });

  app.post<{ Params: { id: string }; Body: { description?: string } }>("/api/tasks/:id/description", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getTask(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const task = setTaskDescription(store, id, typeof req.body?.description === "string" ? req.body.description : "");
    hub.broadcast({ type: "update", source: "refresh" }); // notes — no re-plan
    return { task };
  });
```

- [ ] **Step 3: Attachment routes.** Add after the description route:
```ts
  app.post<{ Params: { id: string }; Body: { image?: { mime?: string; dataB64?: string }; name?: string } }>(
    "/api/tasks/:id/attachments",
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!store.getTask(id)) {
        reply.code(404);
        return { error: "not found" };
      }
      const img = req.body?.image;
      if (!img?.dataB64) {
        reply.code(400);
        return { error: "image required" };
      }
      const dir = attachmentsDir();
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${randomUUID()}.${mimeExt(img.mime)}`;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(img.dataB64, "base64"));
      const attachment = store.addAttachment({
        task_id: id,
        filename,
        original_name: typeof req.body?.name === "string" ? req.body.name : null,
        mime: img.mime ?? "image/png",
      });
      hub.broadcast({ type: "update", source: "refresh" });
      return { attachment };
    },
  );

  const ATTACH_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  app.get<{ Params: { filename: string } }>("/api/attachments/:filename", async (req, reply) => {
    const name = path.basename(req.params.filename); // prevent traversal
    const full = path.join(attachmentsDir(), name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      reply.code(404);
      return { error: "not found" };
    }
    reply.type(ATTACH_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream");
    return reply.send(fs.createReadStream(full));
  });

  app.delete<{ Params: { id: string } }>("/api/attachments/:id", async (req, reply) => {
    const att = store.getAttachment(Number(req.params.id));
    if (!att) {
      reply.code(404);
      return { error: "not found" };
    }
    try {
      fs.unlinkSync(path.join(attachmentsDir(), att.filename));
    } catch {
      /* file may already be gone */
    }
    store.deleteAttachment(att.id);
    hub.broadcast({ type: "update", source: "refresh" });
    return { ok: true };
  });
```

- [ ] **Step 4: Delete task → also remove its attachment files.** In the existing `app.delete("/api/tasks/:id", …)`, before `removeTask(store, id);`, add:
```ts
    for (const a of store.listAttachments(id)) {
      try {
        fs.unlinkSync(path.join(attachmentsDir(), a.filename));
      } catch {
        /* best-effort */
      }
    }
```

- [ ] **Step 5: Verify.** `npm run typecheck && npx vitest run` → PASS. (`fs`, `path`, `randomUUID`, `mimeExt` are already imported in app.ts.)

- [ ] **Step 6: Commit**
```bash
git add src/server/app.ts
git commit -m "feat(server): task-detail GET + description + attachment routes"
```

---

## Task 6: Web API — detail, description, attachments

**Files:** Modify `src/web/api.ts`

- [ ] **Step 1: Implement.** In `src/web/api.ts`, add types near the other DTO types (after `BoardTask`):
```ts
export interface Attachment {
  id: number;
  taskId: number;
  filename: string;
  originalName: string | null;
  mime: string;
  createdAt: string;
  url: string;
}
export interface TaskDetail {
  task: { id: number; title: string; type: TaskType; priority: Priority; status: TaskStatus; due: string | null; description: string };
  stages: BoardStage[];
  blockedBy: number[];
  openBlockers: number[];
  attachments: Attachment[];
}
```
Add these functions in the `// ---- task create / actions ----` section:
```ts
export async function fetchTask(id: number): Promise<TaskDetail> {
  const r = await fetch(`/api/tasks/${id}`);
  if (!r.ok) throw new Error(`task ${r.status}`);
  return r.json();
}

/** Save a task's notes/details (the description); server refreshes, no re-plan. */
export async function setTaskDescription(id: number, description: string): Promise<void> {
  const r = await fetch(`/api/tasks/${id}/description`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!r.ok) throw new Error(`description ${r.status}`);
}

/** Upload an image attachment. `dataUrl` is a `data:<mime>;base64,<…>` string. */
export async function addAttachment(id: number, dataUrl: string, name?: string): Promise<void> {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error("not an image");
  const r = await fetch(`/api/tasks/${id}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: { mime: m[1], dataB64: m[2] }, name }),
  });
  if (!r.ok) throw new Error(`attach ${r.status}`);
}

export async function deleteAttachment(attId: number): Promise<void> {
  const r = await fetch(`/api/attachments/${attId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`detach ${r.status}`);
}
```

- [ ] **Step 2: Verify.** `npm run build:web` → no type errors.

- [ ] **Step 3: Commit**
```bash
git add src/web/api.ts
git commit -m "feat(web): fetchTask + setTaskDescription + attachment API client"
```

---

## Task 7: `TaskDetail` component

**Files:** Create `src/web/components/TaskDetail.tsx`

- [ ] **Step 1: Implement** — create `src/web/components/TaskDetail.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { fetchTask, setTaskDescription, addAttachment, deleteAttachment, type TaskDetail as TaskDetailData } from "../api";
import { EditableTitle } from "./EditableTitle";

export function TaskDetail({ taskId, onBack, onChange }: { taskId: number; onBack: () => void; onChange: () => void }) {
  const [data, setData] = useState<TaskDetailData | null>(null);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const d = await fetchTask(taskId);
      setData(d);
      setNotes(d.task.description);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function saveNotes() {
    if (!data || notes === data.task.description) return;
    try {
      await setTaskDescription(taskId, notes);
      onChange();
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function readAndUpload(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      try {
        await addAttachment(taskId, reader.result, file.name);
        void load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    };
    reader.readAsDataURL(file);
  }
  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) readAndUpload(f);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"));
    if (f) readAndUpload(f);
  }

  if (!data) {
    return (
      <div className="task-detail">
        <button className="td-back" onClick={onBack}>← back</button>
        <div className="muted">{err ? err : "loading…"}</div>
      </div>
    );
  }
  const t = data.task;
  return (
    <div className="task-detail">
      <button className="td-back" onClick={onBack}>← back</button>
      <div className="td-title">
        <span className="muted">#{t.id}</span> <EditableTitle id={t.id} title={t.title} onChange={() => { onChange(); void load(); }} />
      </div>
      <div className="td-meta">
        <span className={`badge pri-${t.priority}`}>{t.priority}</span>
        <span className="kind">{t.type}</span>
        <span className="kind">· {t.status}</span>
        {t.due && <span className="kind">· due {t.due}</span>}
      </div>

      {data.stages.length > 0 && (
        <div className="td-stages">
          {data.stages.map((s) => (
            <span key={s.id} className={`td-stage dot-label ${s.status}`}>
              {s.name} <span className="muted">· {s.kind} · {s.status}</span>
            </span>
          ))}
        </div>
      )}
      {data.openBlockers.length > 0 && (
        <div className="blocked">⛔ blocked by {data.openBlockers.map((b) => `#${b}`).join(", ")}</div>
      )}

      <div className="td-section">Notes &amp; details</div>
      <textarea
        className="td-notes"
        value={notes}
        placeholder="add notes / details — paste or drag an image below to attach it"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => void saveNotes()}
        onPaste={onPaste}
      />

      <div className="td-section">Attachments</div>
      <div className="td-attach" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        {data.attachments.map((a) => (
          <div className="td-thumb" key={a.id}>
            <a href={a.url} target="_blank" rel="noreferrer">
              <img src={a.url} alt={a.originalName ?? "attachment"} />
            </a>
            <button
              className="td-thumb-x"
              title="remove"
              onClick={async () => {
                try {
                  await deleteAttachment(a.id);
                  void load();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="td-add" onClick={() => fileRef.current?.click()} title="add image (or paste in notes / drop here)">
          ＋
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readAndUpload(f);
            e.target.value = "";
          }}
        />
      </div>
      {err && <div className="add-task-err">{err}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Verify.** `npm run build:web` → no type errors.

- [ ] **Step 3: Commit**
```bash
git add src/web/components/TaskDetail.tsx
git commit -m "feat(web): TaskDetail sub-view (notes + attachments)"
```

---

## Task 8: App — selectedTaskId + render + open wiring

**Files:** Modify `src/web/App.tsx`

- [ ] **Step 1: Import + state.** Add import:
```ts
import { TaskDetail } from "./components/TaskDetail";
```
Add state (near the others):
```ts
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
```

- [ ] **Step 2: Tabs clear the selection.** Change each top tab button's `onClick` from `() => setTab("X")` to also clear the detail — e.g. for Today:
```tsx
          <button className={`tab ${tab === "today" ? "active" : ""}`} onClick={() => { setTab("today"); setSelectedTaskId(null); }}>
            Today
          </button>
```
Apply the same `setSelectedTaskId(null)` addition to the Board, Week, and Goals tab buttons.

- [ ] **Step 3: Render the detail instead of the tab content.** Replace the `<main> … </main>` body. Replace:
```tsx
      <main>
        {tab === "today" && (
          <>
            <AddTask onAdded={load} replanning={replanning} />
            {today && <Today data={today} onChange={load} redate={redate} />}
          </>
        )}
        {tab === "board" && board && <Board data={board} onChange={load} />}
        {tab === "week" && board && <Calendar data={board} onChange={load} />}
        {tab === "goals" && <Goals />}
        {tab !== "goals" && !board && !today && !err && <div className="empty">loading…</div>}
      </main>
```
with:
```tsx
      <main>
        {selectedTaskId != null ? (
          <TaskDetail taskId={selectedTaskId} onBack={() => setSelectedTaskId(null)} onChange={load} />
        ) : (
          <>
            {tab === "today" && (
              <>
                <AddTask onAdded={load} replanning={replanning} />
                {today && <Today data={today} onChange={load} redate={redate} onOpen={setSelectedTaskId} />}
              </>
            )}
            {tab === "board" && board && <Board data={board} onChange={load} onOpen={setSelectedTaskId} />}
            {tab === "week" && board && <Calendar data={board} onChange={load} onOpen={setSelectedTaskId} />}
            {tab === "goals" && <Goals />}
            {tab !== "goals" && !board && !today && !err && <div className="empty">loading…</div>}
          </>
        )}
      </main>
```

- [ ] **Step 4: Verify.** `npm run build:web` — will error until Board/Today/Calendar accept `onOpen` (Task 9). Do Task 9, then build.

- [ ] **Step 5: Commit** (after Task 9 builds clean)
```bash
git add src/web/App.tsx
git commit -m "feat(web): App task-detail selection + render + open wiring"
```

---

## Task 9: Card click-to-open (Board / Today / Week)

**Files:** Modify `src/web/components/Board.tsx`, `Today.tsx`, `Calendar.tsx`

- [ ] **Step 1: Board.** In `src/web/components/Board.tsx`:

Change `Board` + `TaskCard` to thread `onOpen`. Replace the `TaskCard` signature line:
```tsx
function TaskCard({ task, onChange }: { task: BoardTask; onChange: () => void }) {
```
with:
```tsx
function TaskCard({ task, onChange, onOpen }: { task: BoardTask; onChange: () => void; onOpen: (id: number) => void }) {
```
Change the card root `<div className="card">` to:
```tsx
    <div
      className="card clickable"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, input, select, textarea, a")) onOpen(task.id);
      }}
    >
```
Change `Board`'s signature + its `<TaskCard …>` usage:
```tsx
export function Board({ data, onChange, onOpen }: { data: BoardData; onChange: () => void; onOpen: (id: number) => void }) {
```
```tsx
              <TaskCard key={t.id} task={t} onChange={onChange} onOpen={onOpen} />
```

- [ ] **Step 2: Today.** In `src/web/components/Today.tsx`, thread `onOpen` through `Today → Lane → Item`:

`Today` signature — add `onOpen` to its props type, and pass it to `<Lane … onOpen={onOpen} />`. `Lane` signature — add `onOpen`, pass to `<Item … onOpen={onOpen} />`. `Item` signature — add `onOpen`. Then change the Item root `<div className={`card item …`}>` to add the same guarded `onClick`:
```tsx
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, input, select, textarea, a")) onOpen(item.task.id);
      }}
```
Concretely:
- `export function Today({ data, onChange, redate, onOpen }: { data: TodayData; onChange: () => void; redate?: { done: number; total: number } | null; onOpen: (id: number) => void })`
- `function Lane({ lane, number, onChange, onOpen }: { lane: TodayLane; number: number; onChange: () => void; onOpen: (id: number) => void })` and `<Item key={…} item={it} onChange={onChange} onOpen={onOpen} />`
- `function Item({ item, onChange, onOpen }: { item: TodayItem; onChange: () => void; onOpen: (id: number) => void })`
- the two `<Lane … />` call sites in `Today` get `onOpen={onOpen}`.

- [ ] **Step 3: Week.** In `src/web/components/Calendar.tsx`:

`CalChip` (module-level) — add `onOpen`:
```tsx
function CalChip({ task, onChange, onOpen }: { task: BoardTask; onChange: () => void; onOpen: (id: number) => void }) {
```
Add a guarded `onClick` to its root `cal-chip` div (it already spreads `drag`):
```tsx
    <div className={`cal-chip pri-${task.priority}${task.status === "done" ? " done" : ""}`} title={task.title} {...drag}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button, input, select, textarea, a")) onOpen(task.id); }}>
```
`Calendar` signature — add `onOpen`; pass to every `<CalChip … onOpen={onOpen} />` (4 sites):
```tsx
export function Calendar({ data, onChange, onOpen }: { data: BoardData; onChange: () => void; onOpen: (id: number) => void }) {
```

- [ ] **Step 4: Styles.** Append to `src/web/styles.css`:
```css
/* ---- v0.1.27: clickable cards + task detail ---- */
.card.clickable, .cal-chip { cursor: pointer; }
.task-detail { max-width: 760px; }
.td-back { background: none; border: 1px solid var(--border); color: var(--text-dim); font: inherit; font-size: 11px; padding: 3px 10px; cursor: pointer; border-radius: 3px; }
.td-back:hover { color: var(--green); border-color: var(--green); }
.td-title { font-size: 16px; font-weight: 600; color: var(--text); margin: 12px 0 6px; }
.td-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.td-stages { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.td-stage { font-size: 12px; }
.td-section { color: var(--green); text-transform: uppercase; letter-spacing: 1px; font-size: 11px; margin: 14px 0 6px; }
.td-notes {
  width: 100%; min-height: 120px; resize: vertical;
  background: var(--panel-solid); color: var(--text); border: 1px solid var(--border);
  border-radius: 4px; padding: 8px 10px; font: inherit; font-size: 13px;
}
.td-notes:focus { outline: none; border-color: var(--green); box-shadow: var(--glow); }
.td-attach { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; padding: 8px; border: 1px dashed var(--border); border-radius: 4px; }
.td-thumb { position: relative; }
.td-thumb img { height: 84px; width: auto; border: 1px solid var(--border); border-radius: 3px; display: block; }
.td-thumb-x { position: absolute; top: -6px; right: -6px; background: var(--bg); border: 1px solid var(--crit); color: var(--crit); border-radius: 50%; width: 18px; height: 18px; line-height: 1; cursor: pointer; font-size: 11px; }
.td-add { height: 84px; width: 84px; background: transparent; border: 1px dashed var(--border); color: var(--text-dim); font-size: 22px; cursor: pointer; border-radius: 3px; }
.td-add:hover { color: var(--green); border-color: var(--green); }
```

- [ ] **Step 5: Verify.** `npm run build:web` → no type errors (App from Task 8 now resolves).

- [ ] **Step 6: Commit** (App + cards together so the build is green)
```bash
git add src/web/App.tsx src/web/components/Board.tsx src/web/components/Today.tsx src/web/components/Calendar.tsx src/web/styles.css
git commit -m "feat(web): click a task card to open its detail (Board/Today/Week)"
```

---

## Task 10: CHANGELOG, version, verify, smoke, release, local refresh

**Files:** Modify `CHANGELOG.md`, `package.json`

- [ ] **Step 1: CHANGELOG.** Insert above `## [0.1.26]`:
```markdown
## [0.1.27] — 2026-06-18
### Added
- **Click a task to open its detail** (from Board, Today, or Week) — a sub-view with the task's info, an
  editable **Notes & details** field, and **image attachments** (paste / drag / pick; stored under
  `~/.spear/attachments/`).

```

- [ ] **Step 2: Version.** Set `"version": "0.1.27"` in `package.json`.

- [ ] **Step 3: Full verification.** `npm run typecheck && npm test && npm run build` → all PASS.

- [ ] **Step 4: Live smoke (throwaway home).**
```bash
export SPEAR_HOME=/tmp/spear-v27-$$
mkdir -p "$SPEAR_HOME"
node dist/cli.js serve --port 4408 >/tmp/spear-v27.log 2>&1 &
SRV=$!; sleep 2
node dist/cli.js add "detail test task" --force </dev/null >/dev/null 2>&1
ID=$(sqlite3 "$SPEAR_HOME/spear.db" "SELECT id FROM tasks ORDER BY id DESC LIMIT 1;")
echo "detail: $(curl -s localhost:4408/api/tasks/$ID | python3 -c 'import sys,json;d=json.load(sys.stdin);print("desc=",repr(d["task"]["description"]),"atts=",len(d["attachments"]))')"
curl -s -X POST localhost:4408/api/tasks/$ID/description -H 'content-type: application/json' -d '{"description":"my notes"}' >/dev/null
# 1x1 png
PNG=$(python3 -c "import base64;print(base64.b64encode(bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082')).decode())")
curl -s -X POST localhost:4408/api/tasks/$ID/attachments -H 'content-type: application/json' -d "{\"image\":{\"mime\":\"image/png\",\"dataB64\":\"$PNG\"},\"name\":\"dot.png\"}" >/dev/null
FN=$(sqlite3 "$SPEAR_HOME/spear.db" "SELECT filename FROM attachments WHERE task_id=$ID;")
echo "after: $(curl -s localhost:4408/api/tasks/$ID | python3 -c 'import sys,json;d=json.load(sys.stdin);print("desc=",repr(d["task"]["description"]),"atts=",len(d["attachments"]))')"
echo "serve status: $(curl -s -o /dev/null -w '%{http_code}' localhost:4408/api/attachments/$FN)   file on disk: $([ -f "$SPEAR_HOME/attachments/$FN" ] && echo yes || echo NO)"
kill $SRV 2>/dev/null; rm -rf "$SPEAR_HOME"; unset SPEAR_HOME
```
Expected: detail shows `desc= '' atts= 0`; after shows `desc= 'my notes' atts= 1`; serve status `200`; file on disk `yes`.

- [ ] **Step 5: Commit.**
```bash
git add CHANGELOG.md package.json
git commit -m "chore: release v0.1.27 — task detail + notes + attachments"
```

- [ ] **Step 6: Install locally.** `npm run build && npm link` → `spear --version` = `0.1.27`.

- [ ] **Step 7: Push + tag.**
```bash
git push origin main
git tag v0.1.27
git push origin v0.1.27
```

- [ ] **Step 8: Confirm release + refresh local app.** Poll the run to `completed/success`; `gh release view v0.1.27 --json assets --jq '.assets[].name'` (expect `spear-0.1.27-arm64.dmg`). Refresh the installed app (download → verify sha512 → quit → swap → de-quarantine → relaunch). In the app, click a task on Board/Today/Week → confirm the detail opens, notes save, an image attaches and previews, and ← back returns.

---

## Self-Review

**Spec coverage:**
- A (detail sub-view, selectedTaskId, card-body click guard, back, tab-clear): Tasks 8, 9; `TaskDetail` Task 7. ✔
- B (notes = description; setTaskDescription + route): Tasks 3, 5; UI in Task 7. ✔
- C (attachments: dir, table, store CRUD, upload/serve/delete routes, delete-task file cleanup): Tasks 1, 2, 5; UI in Task 7. ✔
- D (taskDetailDto + AttachmentDto; web fetchTask/setTaskDescription/addAttachment/deleteAttachment): Tasks 4, 6. ✔
- E (tests: setTaskDescription, attachment CRUD): Tasks 2, 3. ✔
- Release v0.1.27: Task 10. ✔

**Placeholder scan:** none. The card-threading notes in Task 9 Step 2 are concrete (exact signatures given).

**Type consistency:** `Attachment` (types.ts, Task 1) → store `NewAttachment`/CRUD (Task 2) → `AttachmentDto` (dto, Task 4) → web `Attachment` (Task 6) — fields consistent (`task_id`/`taskId`, `original_name`/`originalName` mapped in the DTO). `taskDetailDto`/`TaskDetailDto` (Task 4) ↔ web `TaskDetail` + `fetchTask` (Task 6) ↔ `TaskDetail` component (Task 7). `onOpen: (id: number) => void` is identical across App (Task 8) and Board/Today/Calendar (Task 9). `setTaskDescription(store,id,desc)` (Task 3) ↔ route (Task 5) ↔ web `setTaskDescription(id,desc)` (Task 6).

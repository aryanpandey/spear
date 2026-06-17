import { useEffect, useRef, useState } from "react";
import { checkIntake, createTasksFromSeeds, type DuplicateMatch, type Intent, type Priority, type TaskSeed } from "../api";
import { needsConfirm } from "../../util/needsConfirm";

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
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textbox to fit its content (and shrink back when cleared).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
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
      {image && (
        <span className="add-task-img" title="pasted image — will be read to extract tasks">
          <img src={image} alt="pasted" />
          <button type="button" className="add-task-img-x" title="remove image" onClick={() => setImage(null)}>
            ✕
          </button>
        </span>
      )}
      <textarea
        ref={taRef}
        className="add-task-input"
        rows={1}
        placeholder="add task(s) — describe in plain English or paste an image; it gets split into flows"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter inserts a newline (the box grows).
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        disabled={busy}
      />
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

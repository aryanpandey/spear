import { useState } from "react";
import { createTask, type Priority } from "../api";

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

/**
 * Inline task capture for the Today (lane) tab. Routes through the same
 * /api/tasks pipeline as `spear add` — breakdown into stages + replan. Priority
 * is sent only when chosen; "auto" lets the server infer it.
 */
export function AddTask({ onAdded }: { onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"auto" | Priority>("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await createTask(t, priority === "auto" ? undefined : priority);
      setTitle("");
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
        placeholder="add a task — describe it in plain English, it gets broken into a flow"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busy}
      />
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
      <button className="add-task-btn" type="submit" disabled={busy || !title.trim()}>
        {busy ? "…" : "add"}
      </button>
      {err && <span className="add-task-err">{err}</span>}
    </form>
  );
}

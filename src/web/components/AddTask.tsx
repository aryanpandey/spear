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

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

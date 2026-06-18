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
        <span className="muted">#{t.id}</span>{" "}
        <EditableTitle id={t.id} title={t.title} onChange={() => { onChange(); void load(); }} />
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
            <span key={s.id} className="td-stage">
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
        placeholder="add notes / details — paste an image here, or drop one in Attachments below"
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

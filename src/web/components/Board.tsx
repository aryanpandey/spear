import type { BoardData, BoardTask, TaskStatus } from "../api";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

function TaskCard({ task }: { task: BoardTask }) {
  return (
    <div className="card">
      <div className="cardrow">
        <span className={`badge pri-${task.priority}`}>{task.priority}</span>
        <span className="kind">{task.type}</span>
      </div>
      <div className="title" style={{ marginTop: 4 }}>
        <span className="muted">#{task.id}</span> {task.title}
      </div>
      {task.stages.length > 1 && (
        <div className="dots" title={task.stages.map((s) => `${s.name}: ${s.status}`).join("\n")}>
          {task.stages.map((s) => (
            <span key={s.id} className={`dot ${s.status}`} />
          ))}
        </div>
      )}
      {task.openBlockers.length > 0 && (
        <div className="blocked">⛔ blocked by {task.openBlockers.map((b) => `#${b}`).join(", ")}</div>
      )}
    </div>
  );
}

export function Board({ data }: { data: BoardData }) {
  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const tasks = data.tasks.filter((t) => t.status === col.status);
        return (
          <div className="column" key={col.status}>
            <h3>
              {col.label} <span className="count">({tasks.length})</span>
            </h3>
            {tasks.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
            {tasks.length === 0 && <div className="muted" style={{ fontSize: 11 }}>—</div>}
          </div>
        );
      })}
    </div>
  );
}

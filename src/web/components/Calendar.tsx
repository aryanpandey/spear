import { useState, type DragEvent } from "react";
import { setTaskDue, type BoardData, type BoardTask } from "../api";
import { buildWeek } from "../../util/week";
import { EditableTitle } from "./EditableTitle";

/** A draggable Week chip with inline rename. Module-level so editing survives SSE refreshes. */
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtRange(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${sy}`;
}

// Calendar of the running (Mon→Sun) week. Tasks are bucketed by deadline; drag a
// task onto a day to set its deadline, or onto Unscheduled to clear it. Every
// drop hits the same /api/tasks/:id/due endpoint, so the server re-plans.
export function Calendar({ data, onChange }: { data: BoardData; onChange: () => void }) {
  const [over, setOver] = useState<string | null>(null);
  const [showUnsched, setShowUnsched] = useState(false);
  const week = buildWeek(data.tasks, new Date());

  const move = async (id: number, due: string | null) => {
    try {
      await setTaskDue(id, due);
    } finally {
      onChange();
    }
  };

  const dropProps = (key: string, due: string | null) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(key);
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      const id = Number(e.dataTransfer.getData("text/plain"));
      if (id) void move(id, due);
    },
  });

  return (
    <div className="week">
      <div className="week-head">
        ▦ Week · {fmtRange(week.weekStart, week.weekEnd)}{" "}
        <span className="muted">— drag a task onto a day to set its deadline</span>
      </div>

      {week.overdue.length > 0 && (
        <div className="week-overdue">
          <div className="week-strip-head">⌛ Overdue ({week.overdue.length})</div>
          <div className="week-strip-body">
            {week.overdue.map((t) => (
              <CalChip key={t.id} task={t} onChange={onChange} />
            ))}
          </div>
        </div>
      )}

      <div className="week-grid">
        {week.days.map((d) => (
          <div
            key={d.date}
            className={`week-day${d.isToday ? " today" : ""}${over === d.date ? " drop-over" : ""}`}
            {...dropProps(d.date, d.date)}
          >
            <div className="week-col-head">
              {d.weekday} {d.dayNum}
              {d.isToday ? " ⋆" : ""}
            </div>
            {d.tasks.map((t) => (
              <CalChip key={t.id} task={t} onChange={onChange} />
            ))}
            {d.tasks.length === 0 && <div className="muted week-empty">—</div>}
          </div>
        ))}
      </div>

      <div
        className={`unscheduled${over === "unsched" ? " drop-over" : ""}`}
        {...dropProps("unsched", null)}
      >
        <button className="unsched-toggle" onClick={() => setShowUnsched((s) => !s)}>
          {showUnsched ? "▾" : "▸"} Unscheduled ({week.unscheduled.length})
          <span className="muted"> — drop here to clear a deadline</span>
        </button>
        {showUnsched && (
          <div className="unsched-body">
            {week.unscheduled.map((t) => (
              <CalChip key={t.id} task={t} onChange={onChange} />
            ))}
            {week.unscheduled.length === 0 && <div className="muted">none</div>}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, type DragEvent } from "react";
import { setStageDue, type BoardData } from "../api";
import { buildWeek, type WeekTask } from "../../util/week";
import { EditableTitle } from "./EditableTitle";

/** One stage of a task, as placed on the week by its own date. */
interface WeekUnit extends WeekTask {
  id: number; // stage id (the draggable unit + day bucket key)
  taskId: number;
  title: string;
  stageName: string;
  multi: boolean; // task has >1 stage, so the stage name is worth showing
}

/** Flatten the board's tasks into one draggable unit per stage. */
function toUnits(data: BoardData): WeekUnit[] {
  const units: WeekUnit[] = [];
  for (const t of data.tasks) {
    const multi = t.stages.length > 1;
    for (const s of t.stages) {
      units.push({
        id: s.id,
        taskId: t.id,
        title: t.title,
        stageName: s.name,
        multi,
        due: s.due,
        status: s.status,
        priority: t.priority,
      });
    }
  }
  return units;
}

/** A draggable Week chip (one stage) with inline task rename. */
function CalChip({ unit, onChange, onOpen }: { unit: WeekUnit; onChange: () => void; onOpen: (id: number) => void }) {
  const [editing, setEditing] = useState(false);
  const drag = editing
    ? {}
    : {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          e.dataTransfer.setData("text/plain", String(unit.id));
          e.dataTransfer.effectAllowed = "move";
        },
      };
  return (
    <div
      className={`cal-chip pri-${unit.priority}${unit.status === "done" ? " done" : ""}`}
      title={unit.multi ? `${unit.title} · ${unit.stageName}` : unit.title}
      {...drag}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, input, select, textarea, a")) onOpen(unit.taskId);
      }}
    >
      <span className="muted">#{unit.taskId}</span>{" "}
      <EditableTitle id={unit.taskId} title={unit.title} onChange={onChange} onEditingChange={setEditing} />
      {unit.multi && <span className="muted"> · {unit.stageName}</span>}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtRange(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${sy}`;
}

// Calendar of the running (Mon→Sun) week. Each STAGE is bucketed by its own date;
// drag a step onto a day to set that step's date, or onto Unscheduled to clear it.
// Every drop hits /api/stages/:id/due (refresh, no re-plan).
export function Calendar({ data, onChange, onOpen }: { data: BoardData; onChange: () => void; onOpen: (id: number) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const [showUnsched, setShowUnsched] = useState(false);
  const week = buildWeek(toUnits(data), new Date());

  const move = async (stageId: number, due: string | null) => {
    try {
      await setStageDue(stageId, due);
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
        <span className="muted">— drag a step onto a day to set its date</span>
      </div>

      {week.overdue.length > 0 && (
        <div className="week-overdue">
          <div className="week-strip-head">⌛ Overdue ({week.overdue.length})</div>
          <div className="week-strip-body">
            {week.overdue.map((u) => (
              <CalChip key={u.id} unit={u} onChange={onChange} onOpen={onOpen} />
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
            {d.tasks.map((u) => (
              <CalChip key={u.id} unit={u} onChange={onChange} onOpen={onOpen} />
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
          <span className="muted"> — drop here to clear a date</span>
        </button>
        {showUnsched && (
          <div className="unsched-body">
            {week.unscheduled.map((u) => (
              <CalChip key={u.id} unit={u} onChange={onChange} onOpen={onOpen} />
            ))}
            {week.unscheduled.length === 0 && <div className="muted">none</div>}
          </div>
        )}
      </div>
    </div>
  );
}

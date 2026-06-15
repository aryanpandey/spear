import { useState } from "react";
import {
  setTaskStatus,
  completeTask,
  deleteTask,
  setTaskDue,
  setTaskPriority,
  type Priority,
  type ScheduledState,
  type TodayData,
  type TodayItem,
  type TodayLane,
} from "../api";

const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

const SCHED_LABEL: Record<ScheduledState, string> = {
  start_now: "▶ now",
  background: "⟳ background",
  waiting: "… waiting",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDue(due: string | null): string {
  if (!due) return "";
  const [, m, d] = due.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}`;
}

// Clickable deadline chip → native date picker. Works for any card, and the
// overdue/today states double as the reschedule affordance.
function DueEditor({ item, onChange }: { item: TodayItem; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const apply = async (due: string | null) => {
    try {
      await setTaskDue(item.task.id, due);
    } finally {
      setEditing(false);
      onChange();
    }
  };
  if (editing) {
    return (
      <span className="due-edit">
        <input
          type="date"
          className="due-input"
          defaultValue={item.due ?? ""}
          autoFocus
          onChange={(e) => e.target.value && void apply(e.target.value)}
          onBlur={() => setEditing(false)}
        />
        {item.due && (
          <button className="due-clear" title="Clear deadline" onMouseDown={() => void apply(null)}>
            ✕
          </button>
        )}
      </span>
    );
  }
  const label =
    item.dueBand === "overdue"
      ? `⌛ ${fmtDue(item.due)}`
      : item.dueBand === "today"
        ? "⏰ today"
        : item.due
          ? `▤ ${fmtDue(item.due)}`
          : "+ due";
  const cls =
    item.dueBand === "overdue" ? "due-chip overdue" : item.dueBand === "today" ? "due-chip today" : "due-chip";
  return (
    <button className={cls} title="Set / change deadline" onClick={() => setEditing(true)}>
      {label}
    </button>
  );
}

// Clickable priority badge → pick one of the four levels. Updates the task
// immediately; it does not re-plan (the new ordering shows on the next add / plan).
function PriorityEditor({ item, onChange }: { item: TodayItem; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const apply = async (p: Priority) => {
    try {
      if (p !== item.task.priority) await setTaskPriority(item.task.id, p);
    } finally {
      setEditing(false);
      onChange();
    }
  };
  if (editing) {
    return (
      <span className="pri-edit">
        {PRIORITIES.map((p) => (
          <button
            key={p}
            className={`badge pri-${p} pri-opt${p === item.task.priority ? " current" : ""}`}
            title={p === item.task.priority ? "current (click to close)" : `set ${p}`}
            onClick={() => void apply(p)}
          >
            {p}
          </button>
        ))}
      </span>
    );
  }
  return (
    <button
      className={`badge pri-${item.task.priority} pri-btn`}
      title="Click to change priority"
      onClick={() => setEditing(true)}
    >
      {item.task.priority}
    </button>
  );
}

// Generic phase stages ("Planning", "Implementation", "Testing", "Stage
// Testing") are indistinguishable across tasks, so lead the title with the task
// name. Custom-named stages are already descriptive and stand on their own.
const PHASE_KINDS = ["planning", "design", "implementation", "testing", "stage_testing"];

function Item({ item, onChange }: { item: TodayItem; onChange: () => void }) {
  const isPhase = PHASE_KINDS.includes(item.stage.kind);
  const title = isPhase ? `${item.task.title} · ${item.stage.name}` : item.stage.name;
  // Actions operate on the whole task (a Today item is one of its stages).
  const run = (fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } finally {
      onChange();
    }
  };
  const inProgress = item.task.status === "in_progress";
  return (
    <div className={`card item ${item.scheduled_state}${inProgress ? " in-progress" : ""}`}>
      <div className="cardrow">
        <span className={`sched ${item.scheduled_state}`}>{SCHED_LABEL[item.scheduled_state]}</span>
        {inProgress && <span className="badge in-progress">⟳ in progress</span>}
        <PriorityEditor item={item} onChange={onChange} />
        <DueEditor item={item} onChange={onChange} />
        {item.is_delegation_candidate && <span className="badge delegate">⇄ delegate</span>}
      </div>
      <div className="title" style={{ marginTop: 4 }}>
        {title} <span className="kind">· {item.stage.kind}</span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        #{item.task.id}
        {isPhase ? "" : ` ${item.task.title}`}
      </div>
      {item.rationale && <div className="why">{item.rationale}</div>}
      <div className="task-actions">
        {item.task.status !== "in_progress" && (
          <button className="task-act" title="Mark task in progress" onClick={run(() => setTaskStatus(item.task.id, "in_progress"))}>
            ▶ start
          </button>
        )}
        <button className="task-act done" title="Complete the whole task" onClick={run(() => completeTask(item.task.id))}>
          ✓ done
        </button>
        <button
          className="task-act del"
          title="Delete task"
          onClick={() => {
            if (confirm(`Delete #${item.task.id} "${item.task.title}"?`)) void run(() => deleteTask(item.task.id))();
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Lane({ lane, number, onChange }: { lane: TodayLane; number: number; onChange: () => void }) {
  // Float in-progress work to the top of the lane (stable otherwise).
  const items = [...lane.items].sort(
    (a, b) => Number(b.task.status === "in_progress") - Number(a.task.status === "in_progress"),
  );
  return (
    <div className="lane">
      <div className="lane-head">
        <span className="ln">lane {number}</span>
        <span className="owner">{lane.executor?.name ?? "unassigned"}</span>
        {lane.executor && <span className="ek">{lane.executor.kind}</span>}
      </div>
      {items.map((it) => (
        <Item key={`${it.task.id}-${it.stage.id}`} item={it} onChange={onChange} />
      ))}
    </div>
  );
}

export function Today({ data, onChange }: { data: TodayData; onChange: () => void }) {
  if (!data.plan) {
    return <div className="empty">No current plan. Run <code>spear plan</code> to generate today's execution flow.</div>;
  }
  return (
    <div>
      <div className="narrative">
        <div className="head">
          ░ Execution Flow — {data.plan.plan_date} · {data.plan.trigger} ·{" "}
          {data.plan.model ? "llm" : "deterministic"}
        </div>
        {data.plan.narrative}
      </div>
      {data.lanes.length === 0 ? (
        <div className="empty">inbox zero — no open work.</div>
      ) : (
        <div className="lanes">
          {data.lanes.map((l, i) => (
            <Lane key={l.lane} lane={l} number={i + 1} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

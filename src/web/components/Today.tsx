import { useState } from "react";
import {
  setTaskStatus,
  completeTask,
  deleteTask,
  setTaskDue,
  setTaskPriority,
  replanDates,
  type Priority,
  type ScheduledState,
  type TodayData,
  type TodayItem,
  type TodayLane,
} from "../api";
import { EditableTitle } from "./EditableTitle";
import { compareLaneItems } from "../../util/laneSort";
import { rankTasks } from "../../util/taskSearch";

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
        {!item.due && item.suggestedDue && (
          <button
            className="due-suggest"
            title={item.suggestedDueReason ?? "spear's suggestion"}
            onMouseDown={() => void apply(item.suggestedDue!)}
          >
            ☆ {fmtDue(item.suggestedDue)}
          </button>
        )}
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

// The editable task title is always the card's name. Phase stages ("Planning"/…)
// and the current step of a multi-stage task show as a small label after it; a lone
// generic stage just mirrors the title, so it isn't shown separately.
const PHASE_KINDS = ["planning", "design", "implementation", "testing", "stage_testing"];

function Item({ item, onChange, onOpen }: { item: TodayItem; onChange: () => void; onOpen: (id: number) => void }) {
  const isPhase = PHASE_KINDS.includes(item.stage.kind);
  // Show the stage name (a phase label, or a sub-step of a multi-stage task) only
  // when it adds info beyond the task title; a lone generic stage just mirrors it.
  const showStage = isPhase || item.multiStage;
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
    <div
      className={`card item ${item.scheduled_state}${inProgress ? " in-progress" : ""}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, input, select, textarea, a")) onOpen(item.task.id);
      }}
    >
      <div className="cardrow">
        <span className={`sched ${item.scheduled_state}`}>{SCHED_LABEL[item.scheduled_state]}</span>
        {inProgress && <span className="badge in-progress">⟳ in progress</span>}
        <PriorityEditor item={item} onChange={onChange} />
        <DueEditor item={item} onChange={onChange} />
        {item.is_delegation_candidate && <span className="badge delegate">⇄ delegate</span>}
      </div>
      <div className="title" style={{ marginTop: 4 }}>
        <EditableTitle id={item.task.id} title={item.task.title} onChange={onChange} />
        {showStage ? <> · {item.stage.name}</> : null} <span className="kind">· {item.stage.kind}</span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>#{item.task.id}</div>
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

function Lane({ lane, number, onChange, onOpen }: { lane: TodayLane; number: number; onChange: () => void; onOpen: (id: number) => void }) {
  // In-progress first, then by due date (soonest first, undated last), then priority.
  const items = [...lane.items].sort(compareLaneItems);
  return (
    <div className="lane">
      <div className="lane-head">
        <span className="ln">lane {number}</span>
        <span className="owner">{lane.executor?.name ?? "unassigned"}</span>
        {lane.executor && <span className="ek">{lane.executor.kind}</span>}
      </div>
      {items.map((it) => (
        <Item key={`${it.task.id}-${it.stage.id}`} item={it} onChange={onChange} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function Today({
  data,
  onChange,
  redate,
  onOpen,
}: {
  data: TodayData;
  onChange: () => void;
  redate?: { done: number; total: number } | null;
  onOpen: (id: number) => void;
}) {
  if (!data.plan) {
    return <div className="empty">No current plan. Run <code>spear plan</code> to generate today's execution flow.</div>;
  }
  const pct = redate && redate.total ? Math.round((redate.done / redate.total) * 100) : 0;
  const [query, setQuery] = useState("");
  const results = rankTasks(
    data.lanes.flatMap((l) => l.items),
    query,
    (it) => ({ title: it.task.title, stageName: it.stage.name, type: it.task.type, description: it.task.description }),
  );
  const searching = query.trim().length > 0;
  return (
    <div>
      <div className="narrative">
        <div className="head">
          <span>
            ░ Execution Flow — {data.plan.plan_date} · {data.plan.trigger} ·{" "}
            {data.plan.model ? "llm" : "deterministic"}
          </span>
          <button
            className="redate-btn"
            disabled={!!redate}
            title="Re-decide every task's completion date from the current lane order (keeps lane order)"
            onClick={() => void replanDates()}
          >
            ⟳ replan dates
          </button>
        </div>
        {redate && (
          <div className="redate-progress" title="re-deciding completion dates">
            <div className="redate-fill" style={{ width: `${pct}%` }} />
            <span className="redate-label">re-dating lanes… {redate.done}/{redate.total} ({pct}%)</span>
          </div>
        )}
        {data.plan.narrative}
      </div>
      <div className="task-search">
        <span className="task-search-icon">⌕</span>
        <input
          className="task-search-input"
          placeholder="search tasks — title, stage, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && (
          <button className="task-search-x" title="clear" onClick={() => setQuery("")}>
            ✕
          </button>
        )}
      </div>
      {searching ? (
        <div className="search-results">
          <div className="muted" style={{ marginBottom: 8 }}>
            {results.length} match{results.length === 1 ? "" : "es"} for “{query.trim()}”
          </div>
          {results.map((it) => (
            <Item key={`${it.task.id}-${it.stage.id}`} item={it} onChange={onChange} onOpen={onOpen} />
          ))}
          {results.length === 0 && <div className="empty">no matching tasks.</div>}
        </div>
      ) : data.lanes.length === 0 ? (
        <div className="empty">inbox zero — no open work.</div>
      ) : (
        <div className="lanes">
          {data.lanes.map((l, i) => (
            <Lane key={l.lane} lane={l} number={i + 1} onChange={onChange} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

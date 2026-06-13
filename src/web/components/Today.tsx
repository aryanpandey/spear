import { type DueBand, type ScheduledState, type TodayData, type TodayItem, type TodayLane } from "../api";

const SCHED_LABEL: Record<ScheduledState, string> = {
  start_now: "▶ now",
  background: "⟳ background",
  waiting: "… waiting",
};

function DueBadge({ band }: { band: DueBand }) {
  if (band === "overdue") return <span className="badge due-overdue">⌛ overdue</span>;
  if (band === "today") return <span className="badge due-today">⏰ today</span>;
  return null;
}

function Item({ item }: { item: TodayItem }) {
  return (
    <div className={`card item ${item.scheduled_state}`}>
      <div className="cardrow">
        <span className={`sched ${item.scheduled_state}`}>{SCHED_LABEL[item.scheduled_state]}</span>
        <span className={`badge pri-${item.task.priority}`}>{item.task.priority}</span>
        <DueBadge band={item.dueBand} />
        {item.is_delegation_candidate && <span className="badge delegate">⇄ delegate</span>}
      </div>
      <div className="title" style={{ marginTop: 4 }}>
        {item.stage.name} <span className="kind">· {item.stage.kind}</span>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        #{item.task.id} {item.task.title}
      </div>
      {item.rationale && <div className="why">{item.rationale}</div>}
    </div>
  );
}

function Lane({ lane, number }: { lane: TodayLane; number: number }) {
  return (
    <div className="lane">
      <div className="lane-head">
        <span className="ln">lane {number}</span>
        <span className="owner">{lane.executor?.name ?? "unassigned"}</span>
        {lane.executor && <span className="ek">{lane.executor.kind}</span>}
      </div>
      {lane.items.map((it) => (
        <Item key={`${it.task.id}-${it.stage.id}`} item={it} />
      ))}
    </div>
  );
}

export function Today({ data }: { data: TodayData }) {
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
            <Lane key={l.lane} lane={l} number={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

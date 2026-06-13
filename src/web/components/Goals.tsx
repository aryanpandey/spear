import { useCallback, useEffect, useState } from "react";
import {
  goalsApi,
  type GoalsData,
  type Goal,
  type Scorecard,
  type ScorecardMetric,
  type ScorecardBonus,
} from "../api";

type SubTab = "list" | "scorecard";

export function Goals() {
  const [data, setData] = useState<GoalsData | null>(null);
  const [sub, setSub] = useState<SubTab>("list");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await goalsApi.fetch());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Self-contained live updates: reload on any server event (goals or planner).
  useEffect(() => {
    load();
    const es = new EventSource("/events");
    es.onmessage = () => load();
    const safety = window.setInterval(load, 20000);
    return () => {
      es.close();
      window.clearInterval(safety);
    };
  }, [load]);

  if (err) return <div className="empty" style={{ color: "var(--crit)" }}>● {err}</div>;
  if (!data) return <div className="empty">loading…</div>;

  return (
    <div className="goals">
      <div className="subtabs">
        <button className={`subtab ${sub === "list" ? "active" : ""}`} onClick={() => setSub("list")}>
          List
        </button>
        <button className={`subtab ${sub === "scorecard" ? "active" : ""}`} onClick={() => setSub("scorecard")}>
          Scorecard
        </button>
      </div>
      {sub === "list" ? <GoalList goals={data.goals} reload={load} /> : <ScorecardView data={data} reload={load} />}
    </div>
  );
}

/* ---------------- inline editing helpers ---------------- */

function commit(value: string, original: string, fn: (v: string) => Promise<unknown>): void {
  if (value !== original) void fn(value);
}

function TextField({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => Promise<unknown>;
  className?: string;
  placeholder?: string;
}) {
  // key={value} remounts with fresh defaultValue when the server value changes.
  return (
    <input
      key={value}
      className={`gfield ${className ?? ""}`}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => commit(e.target.value, value, onCommit)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function NumField({ value, onCommit }: { value: number; onCommit: (v: number) => Promise<unknown> }) {
  return (
    <input
      key={value}
      type="number"
      step="any"
      className="gfield num"
      defaultValue={value}
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n !== value) void onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/* ---------------- List sub-tab ---------------- */

function GoalList({ goals, reload }: { goals: Goal[]; reload: () => Promise<void> }) {
  const [title, setTitle] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await goalsApi.addGoal(title.trim());
    setTitle("");
    reload();
  }

  return (
    <div className="goal-list">
      <form className="goal-add" onSubmit={add}>
        <input
          type="text"
          placeholder="add a goal — e.g. ship the trade-log agent"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit">add</button>
      </form>
      {goals.length === 0 && <div className="muted" style={{ padding: "12px 2px" }}>no goals yet.</div>}
      {goals.map((g) => (
        <div key={g.id} className={`goal-row ${g.status === "done" ? "done" : ""}`}>
          <button
            className={`chk ${g.status === "done" ? "on" : ""}`}
            title="toggle done"
            onClick={async () => {
              await goalsApi.toggleGoal(g.id);
              reload();
            }}
          >
            {g.status === "done" ? "✓" : ""}
          </button>
          <TextField
            className="grow"
            value={g.title}
            onCommit={async (v) => {
              await goalsApi.patchGoal(g.id, { title: v });
              reload();
            }}
          />
          <button
            className="del"
            title="delete"
            onClick={async () => {
              await goalsApi.deleteGoal(g.id);
              reload();
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Scorecard sub-tab ---------------- */

const fmt = (n: number, d = 2): string => (Number.isFinite(n) ? n.toFixed(d) : "0");

function ScorecardView({ data, reload }: { data: GoalsData; reload: () => Promise<void> }) {
  const card = data.scorecard;
  const [newTitle, setNewTitle] = useState("Weekly Focus: ");

  if (!card) {
    return (
      <div className="scorecard-empty">
        <p className="muted">No scorecard yet. Start one for this week:</p>
        <form
          className="goal-add"
          onSubmit={async (e) => {
            e.preventDefault();
            await goalsApi.createScorecard(newTitle.trim() || "Weekly Focus");
            reload();
          }}
        >
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <button type="submit">create</button>
        </form>
      </div>
    );
  }

  return <ScorecardCard card={card} all={data.scorecards} reload={reload} />;
}

function ScorecardCard({
  card,
  all,
  reload,
}: {
  card: Scorecard;
  all: GoalsData["scorecards"];
  reload: () => Promise<void>;
}) {
  const weightGoal = Math.round(card.totals.weight);

  return (
    <div className="scorecard">
      <div className="sc-head">
        <TextField
          className="sc-title"
          value={card.title}
          onCommit={async (v) => {
            await goalsApi.patchScorecard(card.id, { title: v });
            reload();
          }}
        />
        <div className="sc-controls">
          <TextField
            className="sc-week"
            value={card.week_of ?? ""}
            placeholder="week of…"
            onCommit={async (v) => {
              await goalsApi.patchScorecard(card.id, { week_of: v || null });
              reload();
            }}
          />
          {all.length > 1 && (
            <select
              className="sc-select"
              value={card.id}
              onChange={async (e) => {
                await goalsApi.patchScorecard(Number(e.target.value), { current: true });
                reload();
              }}
            >
              {all.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
          <button
            className="subtab"
            title="start a new weekly scorecard"
            onClick={async () => {
              await goalsApi.createScorecard("Weekly Focus");
              reload();
            }}
          >
            + new week
          </button>
        </div>
      </div>

      <table className="sc-table">
        <thead>
          <tr>
            <th className="left">Task</th>
            <th>Progress</th>
            <th>Goal</th>
            <th>Score</th>
            <th>Weight</th>
            <th>% Completion</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {card.metrics.map((m) => (
            <MetricRow key={m.id} m={m} reload={reload} />
          ))}
          <tr className="sc-total">
            <td className="left">Total</td>
            <td />
            <td />
            <td>{fmt(card.totals.earned, 1)}</td>
            <td>{fmt(card.totals.weight, 1)}</td>
            <td className={`pct ${card.totals.pct >= 100 ? "good" : "bad"}`}>{fmt(card.totals.pct)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <AddRow placeholder="+ add task row" onAdd={(name) => goalsApi.addMetric(card.id, name).then(reload)} />

      <div className="sc-bonus">
        <div className="sc-bonus-head">
          <span className="bonus-label">Bonus Tasks (only count if you finish {weightGoal}/{weightGoal})</span>
          <span className="reward-label">Reward</span>
        </div>
        {card.bonuses.map((b) => (
          <BonusRow key={b.id} b={b} reload={reload} />
        ))}
        <AddRow placeholder="+ add bonus task" onAdd={(task) => goalsApi.addBonus(card.id, task).then(reload)} />

        <div className="sc-final-bonus">
          <span className="bonus-label">BONUS: Finish all Bonus Tasks</span>
          <TextField
            className="grow"
            value={card.bonus_reward}
            placeholder="reward for finishing everything…"
            onCommit={async (v) => {
              await goalsApi.patchScorecard(card.id, { bonus_reward: v });
              reload();
            }}
          />
        </div>
      </div>

      <button
        className="del sc-delete"
        title="delete this scorecard"
        onClick={async () => {
          if (confirm(`Delete scorecard "${card.title}"?`)) {
            await goalsApi.deleteScorecard(card.id);
            reload();
          }
        }}
      >
        ✕ delete scorecard
      </button>
    </div>
  );
}

function MetricRow({ m, reload }: { m: ScorecardMetric; reload: () => Promise<void> }) {
  const patch = (p: Partial<Pick<ScorecardMetric, "name" | "progress" | "goal" | "weight">>) =>
    goalsApi.patchMetric(m.id, p).then(reload);
  return (
    <tr>
      <td className="left">
        <TextField className="grow" value={m.name} onCommit={(v) => patch({ name: v })} />
      </td>
      <td>
        <NumField value={m.progress} onCommit={(v) => patch({ progress: v })} />
      </td>
      <td>
        <NumField value={m.goal} onCommit={(v) => patch({ goal: v })} />
      </td>
      <td className="ro">{fmt(m.earned, 1)}</td>
      <td>
        <NumField value={m.weight} onCommit={(v) => patch({ weight: v })} />
      </td>
      <td className={`pct ${m.pct >= 100 ? "good" : "bad"}`}>{fmt(m.pct)}</td>
      <td>
        <button className="del" title="remove row" onClick={() => goalsApi.deleteMetric(m.id).then(reload)}>
          ✕
        </button>
      </td>
    </tr>
  );
}

function BonusRow({ b, reload }: { b: ScorecardBonus; reload: () => Promise<void> }) {
  const patch = (p: Partial<Pick<ScorecardBonus, "task" | "reward" | "done">>) =>
    goalsApi.patchBonus(b.id, p).then(reload);
  return (
    <div className={`bonus-row ${b.done ? "done" : ""}`}>
      <button className={`chk ${b.done ? "on" : ""}`} title="toggle done" onClick={() => patch({ done: !b.done })}>
        {b.done ? "✓" : ""}
      </button>
      <TextField className="grow" value={b.task} onCommit={(v) => patch({ task: v })} />
      <TextField className="grow reward" value={b.reward} placeholder="reward…" onCommit={(v) => patch({ reward: v })} />
      <button className="del" title="remove" onClick={() => goalsApi.deleteBonus(b.id).then(reload)}>
        ✕
      </button>
    </div>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => Promise<unknown> }) {
  const [v, setV] = useState("");
  return (
    <form
      className="goal-add inline"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.trim()) return;
        await onAdd(v.trim());
        setV("");
      }}
    >
      <input type="text" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
      <button type="submit">add</button>
    </form>
  );
}

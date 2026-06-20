import { useState } from "react";
import type { MetricsData, MetricsDayPoint } from "../api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtRange(start: string, end: string): string {
  const [, sm, sd] = start.split("-").map(Number);
  const [sy, em, ed] = [Number(end.split("-")[0]), Number(end.split("-")[1]), Number(end.split("-")[2])];
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${sy}`;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`metric-stat${accent ? " accent" : ""}`}>
      <div className="metric-num">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

// Hand-drawn burndown: remaining (descending) + cumulative completed (ascending),
// plotted across the past+today weekdays. No chart lib — plain SVG. Hovering a day
// shows a bubble with that day's date + both values.
function Burndown({ days }: { days: MetricsDayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 230;
  const padL = 30;
  const padR = 14;
  const padT = 16;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const past = days.filter((d) => !d.isFuture);
  const maxVal = Math.max(1, ...days.map((d) => Math.max(d.remaining, d.completed)));
  // X position per weekday index (all 7 columns shown; lines only over past+today).
  const x = (i: number) => padL + (days.length === 1 ? plotW / 2 : (plotW * i) / (days.length - 1));
  const y = (v: number) => padT + plotH - (plotH * v) / maxVal;
  const spacing = days.length > 1 ? plotW / (days.length - 1) : plotW;

  const line = (key: "remaining" | "completed") =>
    past.map((d) => `${x(days.indexOf(d))},${y(d[key])}`).join(" ");

  // A few horizontal gridlines / y-axis ticks.
  const ticks = maxVal <= 4 ? maxVal : 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => Math.round((maxVal * i) / ticks));

  // Tooltip bubble for the hovered day.
  const tw = 116;
  const th = 56;
  const hd = hover != null ? days[hover] : null;
  let tip: { tx: number; ty: number; cx: number; title: string; d: MetricsDayPoint } | null = null;
  if (hd && !hd.isFuture && hover != null) {
    const cx = x(hover);
    const topY = Math.min(y(hd.remaining), y(hd.completed));
    const botY = Math.max(y(hd.remaining), y(hd.completed));
    let ty = topY - th - 10;
    if (ty < padT) ty = botY + 10;
    const tx = Math.max(padL, Math.min(cx - tw / 2, W - padR - tw));
    const [, mo, da] = hd.date.split("-").map(Number);
    tip = { tx, ty, cx, title: `${hd.weekday} ${MONTHS[mo - 1]} ${da}`, d: hd };
  }

  return (
    <div className="burndown">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="weekly burndown" onMouseLeave={() => setHover(null)}>
        {tickVals.map((v) => (
          <g key={v}>
            <line className="bd-grid" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} />
            <text className="bd-axis" x={padL - 6} y={y(v) + 3} textAnchor="end">{v}</text>
          </g>
        ))}
        {days.map((d, i) => (
          <text key={d.date} className={`bd-axis${d.isToday ? " today" : ""}`} x={x(i)} y={H - 9} textAnchor="middle">
            {d.weekday}
          </text>
        ))}
        {past.length > 0 && <polyline className="bd-line remaining" points={line("remaining")} />}
        {past.length > 0 && <polyline className="bd-line completed" points={line("completed")} />}
        {tip && <line className="bd-guide" x1={tip.cx} x2={tip.cx} y1={padT} y2={padT + plotH} />}
        {past.map((d) => {
          const i = days.indexOf(d);
          const on = hover === i;
          return (
            <g key={`r-${d.date}`}>
              <circle className="bd-dot remaining" cx={x(i)} cy={y(d.remaining)} r={on ? 5 : 3} />
              <circle className="bd-dot completed" cx={x(i)} cy={y(d.completed)} r={on ? 5 : 3} />
            </g>
          );
        })}
        {/* Tooltip bubble. */}
        {tip && (
          <g className="bd-tip" transform={`translate(${tip.tx},${tip.ty})`}>
            <rect className="bd-tip-box" width={tw} height={th} rx={4} />
            <text className="bd-tip-title" x={9} y={17}>{tip.title}</text>
            <text x={9} y={34}><tspan fill="var(--green)">● </tspan><tspan className="bd-tip-val">open {tip.d.remaining}</tspan></text>
            <text x={9} y={49}><tspan fill="#e3b341">● </tspan><tspan className="bd-tip-val">done {tip.d.completed}</tspan></text>
          </g>
        )}
        {/* Transparent per-day hover targets (full column height). */}
        {past.map((d) => {
          const i = days.indexOf(d);
          return (
            <rect
              key={`hit-${d.date}`}
              className="bd-hit"
              x={x(i) - spacing / 2}
              y={padT}
              width={spacing}
              height={plotH}
              onMouseEnter={() => setHover(i)}
            />
          );
        })}
      </svg>
      <div className="bd-legend">
        <span className="bd-key remaining">● open remaining</span>
        <span className="bd-key completed">● completed (cumulative)</span>
      </div>
    </div>
  );
}

export function Metrics({ data }: { data: MetricsData | null }) {
  if (!data) return <div className="empty">loading metrics…</div>;
  return (
    <div className="metrics">
      <div className="metrics-row">
        <section className="metric-card">
          <div className="metric-head">▦ Today</div>
          <div className="metric-stats">
            <Stat label="completed" value={data.today.completed} accent />
            <Stat label="added" value={data.today.added} />
          </div>
        </section>
        <section className="metric-card">
          <div className="metric-head">
            ▦ This Week <span className="muted">· {fmtRange(data.week.weekStart, data.week.weekEnd)}</span>
          </div>
          <div className="metric-stats">
            <Stat label="completed" value={data.week.completed} accent />
            <Stat label="added" value={data.week.added} />
            <Stat label="open now" value={data.totalOpen} />
          </div>
        </section>
      </div>

      <section className="metric-card">
        <div className="metric-head">░ Weekly burndown</div>
        <Burndown days={data.burndown} />
      </section>
    </div>
  );
}

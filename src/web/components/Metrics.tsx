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
// plotted across the past+today weekdays. No chart lib — plain SVG.
function Burndown({ days }: { days: MetricsDayPoint[] }) {
  const W = 720;
  const H = 260;
  const padL = 34;
  const padR = 14;
  const padT = 16;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const past = days.filter((d) => !d.isFuture);
  const maxVal = Math.max(1, ...days.map((d) => Math.max(d.remaining, d.completed)));
  // X position per weekday index (all 7 columns shown; lines only over past+today).
  const x = (i: number) => padL + (days.length === 1 ? plotW / 2 : (plotW * i) / (days.length - 1));
  const y = (v: number) => padT + plotH - (plotH * v) / maxVal;

  const line = (key: "remaining" | "completed") =>
    past.map((d) => `${x(days.indexOf(d))},${y(d[key])}`).join(" ");

  // A few horizontal gridlines / y-axis ticks.
  const ticks = maxVal <= 4 ? maxVal : 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => Math.round((maxVal * i) / ticks));

  return (
    <div className="burndown">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="weekly burndown">
        {tickVals.map((v) => (
          <g key={v}>
            <line className="bd-grid" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} />
            <text className="bd-axis" x={padL - 6} y={y(v) + 3} textAnchor="end">{v}</text>
          </g>
        ))}
        {days.map((d, i) => (
          <text key={d.date} className={`bd-axis${d.isToday ? " today" : ""}`} x={x(i)} y={H - 10} textAnchor="middle">
            {d.weekday}
          </text>
        ))}
        {past.length > 0 && <polyline className="bd-line remaining" points={line("remaining")} />}
        {past.length > 0 && <polyline className="bd-line completed" points={line("completed")} />}
        {past.map((d) => (
          <g key={`r-${d.date}`}>
            <circle className="bd-dot remaining" cx={x(days.indexOf(d))} cy={y(d.remaining)} r={3} />
            <circle className="bd-dot completed" cx={x(days.indexOf(d))} cy={y(d.completed)} r={3} />
          </g>
        ))}
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

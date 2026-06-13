import { useCallback, useEffect, useState } from "react";
import { Rain } from "./components/Rain";
import { Board } from "./components/Board";
import { Today } from "./components/Today";
import { fetchBoard, fetchToday, type BoardData, type TodayData } from "./api";

type Tab = "today" | "board";

export function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [today, setToday] = useState<TodayData | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hours, setHours] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const h = hours.trim() === "" ? undefined : Number(hours);
      const [b, t] = await Promise.all([fetchBoard(), fetchToday(h)]);
      setBoard(b);
      setToday(t);
      setUpdated(Date.now());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [hours]);

  // Live updates via SSE; the server pushes on every mutation/re-plan.
  // A slow interval is a safety net if the stream drops.
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

  return (
    <div className="app">
      <Rain />
      <header className="bar">
        <span className="brand">
          spear<span className="caret">_</span>
        </span>
        <div className="tabs">
          <button className={`tab ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
            Today
          </button>
          <button className={`tab ${tab === "board" ? "active" : ""}`} onClick={() => setTab("board")}>
            Board
          </button>
        </div>
        <div className="spacer" />
        {tab === "today" && (
          <label className="hours-ctl">
            hrs left
            <input
              type="number"
              min="0"
              step="0.5"
              value={hours}
              placeholder="auto"
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
        )}
        <span className="status">
          {err ? (
            <span style={{ color: "var(--crit)" }}>● {err}</span>
          ) : (
            <>
              <span className="live">● live</span>
              {updated ? ` · ${new Date(updated).toLocaleTimeString()}` : " · …"}
            </>
          )}
        </span>
      </header>
      <main>
        {tab === "today"
          ? today && <Today data={today} />
          : board && <Board data={board} />}
        {!board && !today && !err && <div className="empty">loading…</div>}
      </main>
    </div>
  );
}

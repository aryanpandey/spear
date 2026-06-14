import { useCallback, useEffect, useState } from "react";
import { Rain } from "./components/Rain";
import { Board } from "./components/Board";
import { Today } from "./components/Today";
import { Goals } from "./components/Goals";
import { AddTask } from "./components/AddTask";
import { DesktopButton } from "./components/DesktopButton";
import { Logo } from "./components/Logo";
import { fetchBoard, fetchToday, type BoardData, type TodayData } from "./api";

type Tab = "today" | "board" | "goals";

export function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [today, setToday] = useState<TodayData | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, t] = await Promise.all([fetchBoard(), fetchToday()]);
      setBoard(b);
      setToday(t);
      setUpdated(Date.now());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Refresh: re-fetch the latest data and, in the desktop app, ask the main
  // process to check for an app update (which prompts the user to install).
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
      if (window.spear?.isDesktop) await window.spear.checkForUpdates();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

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
          <Logo />
          spear<span className="caret">_</span>
        </span>
        <div className="tabs">
          <button className={`tab ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
            Today
          </button>
          <button className={`tab ${tab === "board" ? "active" : ""}`} onClick={() => setTab("board")}>
            Board
          </button>
          <button className={`tab ${tab === "goals" ? "active" : ""}`} onClick={() => setTab("goals")}>
            Goals
          </button>
        </div>
        <div className="spacer" />
        <button
          className="tab"
          onClick={refresh}
          disabled={refreshing}
          title="Refresh data & check for an app update"
        >
          {refreshing ? "⟳ …" : "⟳ refresh"}
        </button>
        <DesktopButton />
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
        {tab === "today" && (
          <>
            <AddTask onAdded={load} />
            {today && <Today data={today} onChange={load} />}
          </>
        )}
        {tab === "board" && board && <Board data={board} onChange={load} />}
        {tab === "goals" && <Goals />}
        {tab !== "goals" && !board && !today && !err && <div className="empty">loading…</div>}
      </main>
    </div>
  );
}

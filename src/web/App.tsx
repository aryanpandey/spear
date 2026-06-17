import { useCallback, useEffect, useRef, useState } from "react";
import { Rain } from "./components/Rain";
import { Board } from "./components/Board";
import { Today } from "./components/Today";
import { Calendar } from "./components/Calendar";
import { Goals } from "./components/Goals";
import { AddTask } from "./components/AddTask";
import { DesktopButton } from "./components/DesktopButton";
import { Logo } from "./components/Logo";
import { fetchBoard, fetchToday, fetchConfig, setMaxLanes, setTheme as persistTheme, type BoardData, type TodayData } from "./api";
import { coerceTheme, THEMES, type Theme } from "../util/theme";

type Tab = "today" | "board" | "week" | "goals";

export function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [today, setToday] = useState<TodayData | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [lanes, setLanes] = useState<number>(6);
  const [redate, setRedate] = useState<{ done: number; total: number } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => coerceTheme(localStorage.getItem("spear-theme")));

  // Apply + cache the theme (config is the synced source of truth; localStorage avoids a flash).
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("spear-theme", theme);
  }, [theme]);

  const changeTheme = useCallback((t: Theme) => {
    setTheme(t); // optimistic; applied by the effect
    void persistTheme(t).catch(() => {});
  }, []);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const [b, t] = await Promise.all([fetchBoard(), fetchToday()]);
      if (seq !== loadSeq.current) return; // a newer load() superseded this one — drop stale data
      setBoard(b);
      setToday(t);
      setUpdated(Date.now());
      setErr(null);
    } catch (e) {
      if (seq === loadSeq.current) setErr(e instanceof Error ? e.message : String(e));
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
  const changeLanes = useCallback(async (n: number) => {
    setLanes(n); // optimistic; the re-plan's SSE will refresh the board
    try {
      await setMaxLanes(n);
    } catch {
      /* leave the optimistic value; next fetchConfig corrects it */
    }
  }, []);

  useEffect(() => {
    load();
    fetchConfig()
      .then((c) => {
        setLanes(c.maxLanes);
        setTheme(coerceTheme(c.theme));
      })
      .catch(() => {});
    const es = new EventSource("/events");
    let safetyTimer: number | undefined;
    es.onmessage = (e) => {
      let msg: { type?: string; phase?: string } | null = null;
      try {
        msg = JSON.parse(e.data);
      } catch {
        /* non-JSON; treat as a plain refresh */
      }
      if (msg?.type === "replan" && msg.phase === "start") {
        setReplanning(true);
        // Safety: never let the bar stick if the "end" event is missed.
        window.clearTimeout(safetyTimer);
        safetyTimer = window.setTimeout(() => setReplanning(false), 150000);
        return;
      }
      if (msg?.type === "replan" && msg.phase === "end") {
        window.clearTimeout(safetyTimer);
        setReplanning(false);
      }
      if (msg?.type === "redate") {
        const m = msg as { phase?: string; done?: number; total?: number };
        if (m.phase === "end") setRedate(null);
        else setRedate({ done: m.done ?? 0, total: m.total ?? 0 });
        load();
        return;
      }
      load();
    };
    const safety = window.setInterval(load, 20000);
    return () => {
      es.close();
      window.clearInterval(safety);
      window.clearTimeout(safetyTimer);
    };
  }, [load]);

  return (
    <div className="app">
      {theme === "matrix" && <Rain />}
      {replanning && <div className="replan-bar" title="Re-planning with Claude…" />}
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
          <button className={`tab ${tab === "week" ? "active" : ""}`} onClick={() => setTab("week")}>
            Week
          </button>
          <button className={`tab ${tab === "goals" ? "active" : ""}`} onClick={() => setTab("goals")}>
            Goals
          </button>
        </div>
        <label className="lanes-ctl" title="App theme">
          theme
          <select value={theme} onChange={(e) => changeTheme(e.target.value as Theme)}>
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="lanes-ctl" title="Max parallel lanes — changing this re-plans the board">
          lanes
          <select value={lanes} onChange={(e) => void changeLanes(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
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
          ) : replanning ? (
            <span className="replanning">⟳ re-planning…</span>
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
            <AddTask onAdded={load} replanning={replanning} />
            {today && <Today data={today} onChange={load} redate={redate} />}
          </>
        )}
        {tab === "board" && board && <Board data={board} onChange={load} />}
        {tab === "week" && board && <Calendar data={board} onChange={load} />}
        {tab === "goals" && <Goals />}
        {tab !== "goals" && !board && !today && !err && <div className="empty">loading…</div>}
      </main>
    </div>
  );
}

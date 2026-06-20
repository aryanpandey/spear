import { useCallback, useEffect, useRef, useState } from "react";
import { Rain } from "./components/Rain";
import { Board } from "./components/Board";
import { Today } from "./components/Today";
import { Calendar } from "./components/Calendar";
import { Goals } from "./components/Goals";
import { AddTask } from "./components/AddTask";
import { DesktopButton } from "./components/DesktopButton";
import { Logo } from "./components/Logo";
import { TaskDetail } from "./components/TaskDetail";
import { Metrics } from "./components/Metrics";
import { fetchBoard, fetchToday, fetchMetrics, fetchConfig, setMaxLanes, setCapacity, setTheme as persistTheme, type BoardData, type TodayData, type MetricsData } from "./api";
import { coerceTheme, THEMES, type Theme } from "../util/theme";

type Tab = "today" | "board" | "week" | "metrics" | "goals";

export function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [today, setToday] = useState<TodayData | null>(null);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [lanes, setLanes] = useState<number>(6);
  const [capacity, setCapacityState] = useState<number>(0); // 0 = auto (= lane count)
  const [redate, setRedate] = useState<boolean>(false);
  const [theme, setTheme] = useState<Theme>(() => coerceTheme(localStorage.getItem("spear-theme")));
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

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
      const [b, t, m] = await Promise.all([fetchBoard(), fetchToday(), fetchMetrics()]);
      if (seq !== loadSeq.current) return; // a newer load() superseded this one — drop stale data
      setBoard(b);
      setToday(t);
      setMetrics(m);
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

  const changeCapacity = useCallback(async (n: number) => {
    setCapacityState(n); // optimistic; the redate's SSE will refresh the board
    try {
      await setCapacity(n);
    } catch {
      /* leave the optimistic value; next fetchConfig corrects it */
    }
  }, []);

  useEffect(() => {
    load();
    fetchConfig()
      .then((c) => {
        setLanes(c.maxLanes);
        setCapacityState(c.dailyTaskCapacity ?? 0);
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
        const m = msg as { phase?: string };
        setRedate(m.phase !== "end"); // single global call: active until "end"
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
          {(["today", "board", "week", "metrics", "goals"] as Tab[]).map((tb) => (
            <button
              key={tb}
              className={`tab ${tab === tb && selectedTaskId == null ? "active" : ""}`}
              onClick={() => {
                setTab(tb);
                setSelectedTaskId(null);
              }}
            >
              {tb}
            </button>
          ))}
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
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="lanes-ctl" title="Tasks you finish per day — used by ‘replan dates’ (auto = lane count)">
          tasks/day
          <select value={capacity} onChange={(e) => void changeCapacity(Number(e.target.value))}>
            <option value={0}>auto ({lanes})</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((n) => (
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
        {selectedTaskId != null ? (
          <TaskDetail taskId={selectedTaskId} onBack={() => setSelectedTaskId(null)} onChange={load} />
        ) : (
          <>
            {tab === "today" && (
              <>
                <AddTask onAdded={load} replanning={replanning} />
                {today && <Today data={today} onChange={load} redate={redate} onOpen={setSelectedTaskId} />}
              </>
            )}
            {tab === "board" && board && <Board data={board} onChange={load} onOpen={setSelectedTaskId} />}
            {tab === "week" && board && <Calendar data={board} onChange={load} onOpen={setSelectedTaskId} />}
            {tab === "metrics" && <Metrics data={metrics} />}
            {tab === "goals" && <Goals />}
            {tab !== "goals" && tab !== "metrics" && !board && !today && !err && <div className="empty">loading…</div>}
          </>
        )}
      </main>
    </div>
  );
}

import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { buildAndSavePlan } from "../planner/build.js";

/**
 * After a CLI mutation, keep the plan + dashboard in sync:
 *  - if a server is running, hand off (it re-plans via the Claude CLI and pushes
 *    the update to any open browser over SSE);
 *  - otherwise re-plan inline (also via the Claude CLI) so `today`/`serve` show
 *    the latest.
 */
export async function triggerReplan(store: Store, cfg: SpearConfig): Promise<"server" | "inline"> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 400);
    const res = await fetch(`http://127.0.0.1:${cfg.port}/internal/replan`, {
      method: "POST",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) return "server";
  } catch {
    /* no server listening — fall through to inline */
  }

  const { error } = await buildAndSavePlan(store, cfg, "adhoc");
  if (error) process.stderr.write(`spear: re-plan failed (${error})\n`);
  return "inline";
}

/**
 * Ask a running server to broadcast a refresh WITHOUT re-planning — used after
 * a plan has already been persisted (e.g. the morning job) so an open dashboard
 * reloads it without clobbering it.
 */
export async function pingRefresh(port: number): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 400);
    await fetch(`http://127.0.0.1:${port}/internal/refresh`, { method: "POST", signal: ctrl.signal });
    clearTimeout(t);
  } catch {
    /* no server running */
  }
}

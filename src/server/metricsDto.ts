import type { Store } from "../db/store.js";
import { buildMetrics, type MetricsView } from "../util/metrics.js";

/** Today/active-week task metrics + a Mon→Sun burndown, from every task's timestamps. */
export function metricsDto(store: Store, now: Date = new Date()): MetricsView {
  const tasks = store.listAllTasks().map((t) => ({ created_at: t.created_at, completed_at: t.completed_at }));
  return buildMetrics(tasks, now);
}

import type { Store } from "../db/store.js";
import { addTask, completeTask, setTaskStatus } from "../service.js";
import { breakdownForAdd } from "../breakdown/index.js";
import type { Priority, TaskStatus, TaskType } from "../types.js";

/** One row of a Notion-board export. Tolerant of a few field name variants. */
export interface NotionSeedTask {
  external_id?: string;
  id?: string;
  title?: string;
  task?: string;
  name?: string;
  status?: string;
  priority?: string;
  due?: string | null;
  due_date?: string | null;
  notes?: string;
  description?: string;
  type?: string;
}

const STATUS_MAP: Record<string, TaskStatus> = {
  backlog: "backlog",
  todo: "todo",
  "to do": "todo",
  "not started": "todo",
  open: "todo",
  "in progress": "in_progress",
  in_progress: "in_progress",
  doing: "in_progress",
  "in review": "in_progress",
  blocked: "blocked",
  done: "done",
  complete: "done",
  completed: "done",
};

const PRIORITY_MAP: Record<string, Priority> = {
  critical: "critical",
  urgent: "critical",
  high: "high",
  medium: "medium",
  med: "medium",
  normal: "medium",
  low: "low",
};

export function mapStatus(s?: string): TaskStatus {
  if (!s) return "todo";
  return STATUS_MAP[s.trim().toLowerCase()] ?? "todo";
}

export function mapPriority(p?: string): Priority {
  if (!p) return "medium";
  return PRIORITY_MAP[p.trim().toLowerCase()] ?? "medium";
}

function titleOf(t: NotionSeedTask): string | undefined {
  return t.title ?? t.task ?? t.name;
}

function applyImportedStatus(store: Store, id: number, status: TaskStatus): void {
  if (status === "done") completeTask(store, id);
  else setTaskStatus(store, id, status);
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportOpts {
  breakdown: boolean;
  model: string;
  effort: "low" | "medium" | "high" | "max";
}

/** Idempotently upsert seed tasks into the store, keyed by external_id. */
export async function importSeed(
  store: Store,
  tasks: NotionSeedTask[],
  opts: ImportOpts,
): Promise<ImportResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const t of tasks) {
    const title = titleOf(t);
    const ext = t.external_id ?? t.id ?? null;
    if (!title) {
      skipped++;
      continue;
    }
    const status = mapStatus(t.status);
    const priority = mapPriority(t.priority);
    const due = t.due ?? t.due_date ?? null;
    const description = t.notes ?? t.description ?? "";

    const existing = ext ? store.getTaskByExternalId(ext) : undefined;
    if (existing) {
      store.updateTask(existing.id, { title, priority, due, description });
      applyImportedStatus(store, existing.id, status);
      updated++;
      continue;
    }

    if (opts.breakdown) {
      const broken = await breakdownForAdd({
        title,
        description,
        forcedType: t.type as TaskType | undefined,
        useLlm: true,
        model: opts.model,
        effort: opts.effort,
      });
      const { task } = addTask(store, {
        title: broken.title,
        type: broken.type,
        priority,
        description,
        source: "notion",
        external_id: ext,
        stages: broken.stages,
      });
      store.updateTask(task.id, { due });
      applyImportedStatus(store, task.id, status);
    } else {
      const { task } = addTask(store, {
        title,
        type: (t.type as TaskType) ?? "other",
        priority,
        description,
        source: "notion",
        external_id: ext,
        stages: [{ name: title, kind: "generic", effort: "medium", delegatable_to: ["self"] }],
      });
      store.updateTask(task.id, { due });
      applyImportedStatus(store, task.id, status);
    }
    created++;
  }

  return { created, updated, skipped };
}

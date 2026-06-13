export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'other',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  effort TEXT,
  due TEXT,
  source TEXT NOT NULL DEFAULT 'cli',
  external_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'generic',
  seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  effort TEXT,
  delegatable_to TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_stages_task ON stages(task_id);

CREATE TABLE IF NOT EXISTS dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_by_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id, blocked_by_task_id)
);

CREATE TABLE IF NOT EXISTS executors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  handles TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS daily_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_date TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  narrative TEXT NOT NULL DEFAULT '',
  model TEXT,
  is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL,
  stage_id INTEGER NOT NULL,
  lane INTEGER NOT NULL,
  order_in_lane INTEGER NOT NULL,
  executor_id INTEGER,
  is_delegation_candidate INTEGER NOT NULL DEFAULT 0,
  scheduled_state TEXT NOT NULL DEFAULT 'start_now',
  rationale TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id);
`;

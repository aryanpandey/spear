import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dbPath } from "../paths.js";
import { SCHEMA_SQL } from "./schema.js";

export type DB = Database.Database;

/** Open (creating if needed) the spear database and ensure the schema exists. */
export function openDb(file?: string): DB {
  const target = file ?? dbPath();
  if (target !== ":memory:") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}

/** Idempotent migrations for databases created before a column existed. */
function migrate(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map((r) => r.name);
  if (!cols.includes("lane")) db.exec("ALTER TABLE tasks ADD COLUMN lane INTEGER");
  if (!cols.includes("suggested_due")) db.exec("ALTER TABLE tasks ADD COLUMN suggested_due TEXT");
  if (!cols.includes("suggested_due_reason")) db.exec("ALTER TABLE tasks ADD COLUMN suggested_due_reason TEXT");
  if (!cols.includes("completed_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN completed_at TEXT");
    // Backfill: approximate existing done tasks' completion with their last-updated time.
    db.exec("UPDATE tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL");
  }
  const stageCols = (db.prepare("PRAGMA table_info(stages)").all() as { name: string }[]).map((r) => r.name);
  if (!stageCols.includes("due")) db.exec("ALTER TABLE stages ADD COLUMN due TEXT");
}

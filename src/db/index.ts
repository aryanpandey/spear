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
  return db;
}

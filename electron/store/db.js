// SQLite file for Tessera data (node:sqlite, no native modules).
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS keyring (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  kdf         TEXT NOT NULL,
  salt        BLOB NOT NULL,
  wrapped_dek BLOB NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES folders(id),
  position   INTEGER NOT NULL,
  name       BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS folders_parent ON folders(parent_id, position);
CREATE TABLE IF NOT EXISTS items (
  id             TEXT PRIMARY KEY,
  folder_id      TEXT REFERENCES folders(id),
  name           BLOB NOT NULL,
  favorite       INTEGER NOT NULL DEFAULT 0,
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_folder ON items(folder_id);
CREATE TABLE IF NOT EXISTS fields (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  name       BLOB NOT NULL,
  value      BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fields_item ON fields(item_id, position);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;");
  db.exec(SCHEMA);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!row) {
    db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  } else if (Number(row.value) > SCHEMA_VERSION) {
    db.close();
    throw new Error(`Data file was written by a newer version (schema ${row.value})`);
  }
  return db;
}

// Runs fn inside one transaction; rolls back on any error.
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

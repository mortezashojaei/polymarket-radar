import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

const dir = path.dirname(env.dbPath);
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(env.dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS seen_alerts (
  key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at INTEGER NOT NULL,
  posted_count INTEGER NOT NULL,
  note TEXT
);
`);

export const hasSeen = (key: string): boolean => {
  const row = db.prepare("SELECT key FROM seen_alerts WHERE key = ?").get(key);
  return !!row;
};

export const markSeen = (key: string): void => {
  db.prepare(
    "INSERT OR IGNORE INTO seen_alerts(key, created_at) VALUES (?, ?)"
  ).run(key, Date.now());
};

export const saveRun = (postedCount: number, note = "ok"): void => {
  db.prepare("INSERT INTO runs(run_at, posted_count, note) VALUES (?, ?, ?)").run(
    Date.now(),
    postedCount,
    note
  );
};

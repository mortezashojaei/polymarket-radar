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
CREATE TABLE IF NOT EXISTS market_state (
  market_id TEXT PRIMARY KEY,
  top_outcome TEXT,
  top_prob REAL,
  volume24h REAL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_messages (
  message_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`);

try {
  db.exec("ALTER TABLE market_state ADD COLUMN volume24h REAL");
} catch {
  // ignore if column already exists
}

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

export const getMarketState = (
  marketId: string
): { topOutcome: string; topProb: number; volume24h: number; updatedAt: number } | null => {
  const row = db
    .prepare(
      "SELECT top_outcome, top_prob, COALESCE(volume24h, 0) AS volume24h, updated_at FROM market_state WHERE market_id = ?"
    )
    .get(marketId) as
    | { top_outcome: string; top_prob: number; volume24h: number; updated_at: number }
    | undefined;

  if (!row) return null;
  return {
    topOutcome: row.top_outcome,
    topProb: row.top_prob,
    volume24h: row.volume24h,
    updatedAt: row.updated_at,
  };
};

export const upsertMarketState = (
  marketId: string,
  topOutcome: string,
  topProb: number,
  volume24h: number
): void => {
  db.prepare(
    `INSERT INTO market_state(market_id, top_outcome, top_prob, volume24h, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(market_id)
     DO UPDATE SET top_outcome = excluded.top_outcome,
                   top_prob = excluded.top_prob,
                   volume24h = excluded.volume24h,
                   updated_at = excluded.updated_at`
  ).run(marketId, topOutcome, topProb, volume24h, Date.now());
};

export const saveSentMessage = (messageId: number): void => {
  db.prepare("INSERT OR IGNORE INTO sent_messages(message_id, created_at) VALUES (?, ?)").run(
    messageId,
    Date.now()
  );
};

export const listSentMessageIds = (limit: number): number[] => {
  const rows = db
    .prepare("SELECT message_id FROM sent_messages ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<{ message_id: number }>;
  return rows.map((r) => r.message_id);
};

export const clearSentMessages = (): void => {
  db.prepare("DELETE FROM sent_messages").run();
};

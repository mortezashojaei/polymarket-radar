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
  updated_at INTEGER NOT NULL,
  last_delta REAL DEFAULT 0,
  last_direction INTEGER DEFAULT 0,
  flip_count_6h INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS signal_state (
  market_id TEXT PRIMARY KEY,
  last_score INTEGER NOT NULL,
  last_tier TEXT NOT NULL,
  last_direction INTEGER NOT NULL,
  last_alert_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_messages (
  message_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  text TEXT,
  kind TEXT,
  tier TEXT
);
CREATE TABLE IF NOT EXISTS pending_digest_signals (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv_state (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  confidence TEXT NOT NULL,
  direction INTEGER NOT NULL,
  entry_prob REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  question TEXT NOT NULL,
  category TEXT NOT NULL,
  top_outcome TEXT NOT NULL,
  top_prob REAL NOT NULL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_posts_market_time ON alert_posts(market_id, created_at);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_market_time ON market_snapshots(market_id, captured_at);
`);

for (const ddl of [
  "ALTER TABLE market_state ADD COLUMN volume24h REAL",
  "ALTER TABLE market_state ADD COLUMN last_delta REAL DEFAULT 0",
  "ALTER TABLE market_state ADD COLUMN last_direction INTEGER DEFAULT 0",
  "ALTER TABLE market_state ADD COLUMN flip_count_6h INTEGER DEFAULT 0",
  "ALTER TABLE sent_messages ADD COLUMN text TEXT",
  "ALTER TABLE sent_messages ADD COLUMN kind TEXT",
  "ALTER TABLE sent_messages ADD COLUMN tier TEXT",
]) {
  try {
    db.exec(ddl);
  } catch {
    // ignore if column already exists
  }
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
): {
  topOutcome: string;
  topProb: number;
  volume24h: number;
  updatedAt: number;
  lastDelta: number;
  lastDirection: number;
  flipCount6h: number;
} | null => {
  const row = db
    .prepare(
      `SELECT top_outcome, top_prob, COALESCE(volume24h, 0) AS volume24h, updated_at,
              COALESCE(last_delta, 0) AS last_delta,
              COALESCE(last_direction, 0) AS last_direction,
              COALESCE(flip_count_6h, 0) AS flip_count_6h
       FROM market_state WHERE market_id = ?`
    )
    .get(marketId) as
    | {
        top_outcome: string;
        top_prob: number;
        volume24h: number;
        updated_at: number;
        last_delta: number;
        last_direction: number;
        flip_count_6h: number;
      }
    | undefined;

  if (!row) return null;
  return {
    topOutcome: row.top_outcome,
    topProb: row.top_prob,
    volume24h: row.volume24h,
    updatedAt: row.updated_at,
    lastDelta: row.last_delta,
    lastDirection: row.last_direction,
    flipCount6h: row.flip_count_6h,
  };
};

export const upsertMarketState = (
  marketId: string,
  topOutcome: string,
  topProb: number,
  volume24h: number,
  lastDelta: number,
  lastDirection: number,
  flipCount6h: number
): void => {
  db.prepare(
    `INSERT INTO market_state(market_id, top_outcome, top_prob, volume24h, updated_at, last_delta, last_direction, flip_count_6h)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(market_id)
     DO UPDATE SET top_outcome = excluded.top_outcome,
                   top_prob = excluded.top_prob,
                   volume24h = excluded.volume24h,
                   updated_at = excluded.updated_at,
                   last_delta = excluded.last_delta,
                   last_direction = excluded.last_direction,
                   flip_count_6h = excluded.flip_count_6h`
  ).run(marketId, topOutcome, topProb, volume24h, Date.now(), lastDelta, lastDirection, flipCount6h);
};

export const saveSentMessage = (
  messageId: number,
  meta?: { text?: string; kind?: string; tier?: string }
): void => {
  db.prepare(
    `INSERT OR REPLACE INTO sent_messages(message_id, created_at, text, kind, tier)
     VALUES (?, ?, ?, ?, ?)`
  ).run(messageId, Date.now(), meta?.text ?? null, meta?.kind ?? null, meta?.tier ?? null);
};

export const listSentMessageIds = (limit: number): number[] => {
  const rows = db
    .prepare("SELECT message_id FROM sent_messages ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<{ message_id: number }>;
  return rows.map((r) => r.message_id);
};

export interface SentMessageRow {
  messageId: number;
  createdAt: number;
  text: string | null;
  kind: string | null;
  tier: string | null;
}

export const listSentMessagesSince = (sinceTs: number, limit = 5000): SentMessageRow[] => {
  const rows = db
    .prepare(
      `SELECT message_id, created_at, text, kind, tier
       FROM sent_messages
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(sinceTs, limit) as Array<{
    message_id: number;
    created_at: number;
    text: string | null;
    kind: string | null;
    tier: string | null;
  }>;

  return rows.map((r) => ({
    messageId: r.message_id,
    createdAt: r.created_at,
    text: r.text,
    kind: r.kind,
    tier: r.tier,
  }));
};

export const clearSentMessages = (): void => {
  db.prepare("DELETE FROM sent_messages").run();
};

export const getSignalState = (
  marketId: string
): { lastScore: number; lastTier: string; lastDirection: number; lastAlertAt: number } | null => {
  const row = db
    .prepare(
      "SELECT last_score, last_tier, last_direction, last_alert_at FROM signal_state WHERE market_id = ?"
    )
    .get(marketId) as
    | { last_score: number; last_tier: string; last_direction: number; last_alert_at: number }
    | undefined;

  if (!row) return null;
  return {
    lastScore: row.last_score,
    lastTier: row.last_tier,
    lastDirection: row.last_direction,
    lastAlertAt: row.last_alert_at,
  };
};

export const upsertSignalState = (
  marketId: string,
  lastScore: number,
  lastTier: string,
  lastDirection: number,
  lastAlertAt: number
): void => {
  db.prepare(
    `INSERT INTO signal_state(market_id, last_score, last_tier, last_direction, last_alert_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(market_id)
     DO UPDATE SET last_score = excluded.last_score,
                   last_tier = excluded.last_tier,
                   last_direction = excluded.last_direction,
                   last_alert_at = excluded.last_alert_at`
  ).run(marketId, lastScore, lastTier, lastDirection, lastAlertAt);
};

export const queueDigestSignal = (key: string, payload: string): void => {
  db.prepare(
    "INSERT OR IGNORE INTO pending_digest_signals(key, payload, created_at) VALUES (?, ?, ?)"
  ).run(key, payload, Date.now());
};

export const listQueuedDigestSignals = (limit: number): string[] => {
  const rows = db
    .prepare("SELECT payload FROM pending_digest_signals ORDER BY created_at ASC LIMIT ?")
    .all(limit) as Array<{ payload: string }>;
  return rows.map((r) => r.payload);
};

export const clearQueuedDigestSignals = (): void => {
  db.prepare("DELETE FROM pending_digest_signals").run();
};


export const saveAlertPost = (args: {
  marketId: string;
  signalType: string;
  confidence: string;
  direction: number;
  entryProb: number;
  createdAt?: number;
}): void => {
  db.prepare(
    `INSERT INTO alert_posts(market_id, signal_type, confidence, direction, entry_prob, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    args.marketId,
    args.signalType,
    args.confidence,
    args.direction,
    args.entryProb,
    args.createdAt ?? Date.now()
  );
};

export const listMarketPostCounts = (sinceTs: number): Map<string, number> => {
  const rows = db
    .prepare(
      `SELECT market_id, COUNT(*) AS c
       FROM alert_posts
       WHERE created_at >= ?
       GROUP BY market_id`
    )
    .all(sinceTs) as Array<{ market_id: string; c: number }>;

  return new Map(rows.map((r) => [r.market_id, r.c]));
};

export const listAlertPostsBetween = (startTs: number, endTs: number) => {
  return db
    .prepare(
      `SELECT market_id, signal_type, confidence, direction, entry_prob, created_at
       FROM alert_posts
       WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at DESC`
    )
    .all(startTs, endTs) as Array<{
    market_id: string;
    signal_type: string;
    confidence: string;
    direction: number;
    entry_prob: number;
    created_at: number;
  }>;
};

export const upsertMarketSnapshot = (
  marketId: string,
  question: string,
  category: string,
  topOutcome: string,
  topProb: number,
  capturedAt: number
): void => {
  db.prepare(
    `INSERT INTO market_snapshots(market_id, question, category, top_outcome, top_prob, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(marketId, question, category, topOutcome, topProb, capturedAt);
};

export const listMarketShiftsBetween = (startTs: number, endTs: number) => {
  const firstRows = db
    .prepare(
      `SELECT s.market_id, s.question, s.category, s.top_prob
       FROM market_snapshots s
       JOIN (
         SELECT market_id, MIN(captured_at) AS t
         FROM market_snapshots
         WHERE captured_at >= ? AND captured_at < ?
         GROUP BY market_id
       ) firsts ON firsts.market_id = s.market_id AND firsts.t = s.captured_at`
    )
    .all(startTs, endTs) as Array<{ market_id: string; question: string; category: string; top_prob: number }>;

  const lastRows = db
    .prepare(
      `SELECT s.market_id, s.top_prob
       FROM market_snapshots s
       JOIN (
         SELECT market_id, MAX(captured_at) AS t
         FROM market_snapshots
         WHERE captured_at >= ? AND captured_at < ?
         GROUP BY market_id
       ) lasts ON lasts.market_id = s.market_id AND lasts.t = s.captured_at`
    )
    .all(startTs, endTs) as Array<{ market_id: string; top_prob: number }>;

  const lastMap = new Map(lastRows.map((r) => [r.market_id, r.top_prob]));
  return firstRows
    .map((r) => ({
      marketId: r.market_id,
      question: r.question,
      category: r.category,
      fromProb: r.top_prob,
      toProb: lastMap.get(r.market_id) ?? r.top_prob,
      delta: (lastMap.get(r.market_id) ?? r.top_prob) - r.top_prob,
    }))
    .filter((r) => Number.isFinite(r.delta));
};

export const getKv = (key: string): string | null => {
  const row = db.prepare("SELECT v FROM kv_state WHERE k = ?").get(key) as { v: string } | undefined;
  return row?.v ?? null;
};

export const setKv = (key: string, value: string): void => {
  db.prepare(
    `INSERT INTO kv_state(k, v, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(k)
     DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`
  ).run(key, value, Date.now());
};

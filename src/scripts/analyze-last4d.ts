import fs from "node:fs";

process.env.TELEGRAM_BOT_TOKEN ||= "analysis-only";
process.env.TELEGRAM_CHANNEL_ID ||= "analysis-only";

const daysArg = Number(process.argv[2] ?? 4);
const days = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 4;
const sinceTs = Date.now() - days * 24 * 60 * 60 * 1000;

const cliDbArg = process.argv.find((a) => a.startsWith("--db="))?.slice(5);
if (!process.env.DATABASE_PATH) {
  if (cliDbArg) {
    process.env.DATABASE_PATH = cliDbArg;
  } else if (fs.existsSync("/opt/polymarket-radar/data/radar.db")) {
    process.env.DATABASE_PATH = "/opt/polymarket-radar/data/radar.db";
  }
}

const { listSentMessagesSince } = await import("../db/sqlite.js");
const rows = listSentMessagesSince(sinceTs, 10_000);

const byKind = rows.reduce<Record<string, number>>((acc, r) => {
  const k = r.kind ?? "unknown";
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});

const byTier = rows.reduce<Record<string, number>>((acc, r) => {
  const t = r.tier ?? "unknown";
  acc[t] = (acc[t] ?? 0) + 1;
  return acc;
}, {});

const summary = {
  days,
  dbPath: process.env.DATABASE_PATH ?? "./data/radar.db",
  sinceIso: new Date(sinceTs).toISOString(),
  totalMessages: rows.length,
  byKind,
  byTier,
};

console.log(JSON.stringify(summary, null, 2));
console.log("\n--- Recent messages (newest first) ---");
for (const r of rows.slice(0, 200)) {
  const preview = (r.text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  console.log(`${new Date(r.createdAt).toISOString()} | id=${r.messageId} | kind=${r.kind ?? "-"} | tier=${r.tier ?? "-"} | ${preview}`);
}

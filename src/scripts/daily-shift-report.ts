import fs from "node:fs";

process.env.TELEGRAM_BOT_TOKEN ||= "analysis-only";
process.env.TELEGRAM_CHANNEL_ID ||= "analysis-only";

const cliDbArg = process.argv.find((a) => a.startsWith("--db="))?.slice(5);
if (!process.env.DATABASE_PATH) {
  if (cliDbArg) {
    process.env.DATABASE_PATH = cliDbArg;
  } else if (fs.existsSync("/opt/polymarket-radar/data/radar.db")) {
    process.env.DATABASE_PATH = "/opt/polymarket-radar/data/radar.db";
  }
}

const { listSentMessagesSince } = await import("../db/sqlite.js");

const arg = (name: string, fallback?: string): string | undefined => {
  const fromEq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (fromEq) return fromEq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  return fallback;
};

const dayArg = arg("--date");
const topN = Number(arg("--top", "5") ?? "5");
const minDelta = Number(arg("--min-delta", "3") ?? "3");
const includeResolved = (arg("--include-resolved", "false") ?? "false") === "true";
const reliabilityWindow = Number(arg("--reliability-window", "5") ?? "5");

const day = (() => {
  if (dayArg && /^\d{4}-\d{2}-\d{2}$/.test(dayArg)) return dayArg;
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
})();

const dayStart = new Date(`${day}T00:00:00.000Z`).getTime();
const dayEnd = dayStart + 24 * 60 * 60 * 1000;
const prevDayStart = dayStart - 24 * 60 * 60 * 1000;

interface ShiftSignal {
  market: string;
  bet: string;
  from: number;
  to: number;
  delta: number;
  category: "Sports" | "Politics" | "Crypto" | "Other";
}

const parseSignals = (text: string): ShiftSignal[] => {
  const normalized = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized.includes("📈") || !normalized.includes("🎯 Bet:")) return [];

  const out: ShiftSignal[] = [];
  const rx = /(🔥|👀|▫️)\s*([^🎯]+?)\s*🎯 Bet:\s*([^📈]+?)\s*📈\s*(\d+(?:\.\d+)?)%\s*→\s*(\d+(?:\.\d+)?)%\s*\(([+-]\d+(?:\.\d+)?)%\)/g;

  for (const m of normalized.matchAll(rx)) {
    const market = (m[2] ?? "").trim();
    const bet = (m[3] ?? "").trim();
    const from = Number(m[4]);
    const to = Number(m[5]);
    const delta = Number(m[6]);
    if (!market || !bet || !Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(delta)) continue;

    out.push({
      market,
      bet,
      from,
      to,
      delta,
      category: inferCategory(market),
    });
  }

  return out;
};

const inferCategory = (market: string): ShiftSignal["category"] => {
  const s = market.toLowerCase();

  if (
    s.includes("bitcoin") ||
    s.includes("ethereum") ||
    s.includes("solana") ||
    s.includes("crypto") ||
    s.includes("fdv") ||
    s.includes("opensea")
  ) {
    return "Crypto";
  }

  if (
    s.includes("election") ||
    s.includes("fed") ||
    s.includes("ceasefire") ||
    s.includes("iran") ||
    s.includes("usa") ||
    s.includes("ukraine") ||
    s.includes("russia") ||
    s.includes("conflict") ||
    s.includes("inva")
  ) {
    return "Politics";
  }

  if (
    s.includes(" vs. ") ||
    s.includes("win on") ||
    s.includes("spread") ||
    s.includes("masters") ||
    s.includes("mls") ||
    s.includes("map") ||
    s.includes("bo3") ||
    s.includes("bo5")
  ) {
    return "Sports";
  }

  return "Other";
};

const loadSignalsForWindow = (startTs: number, endTs: number): ShiftSignal[] => {
  const rows = listSentMessagesSince(startTs, 50_000).filter((r) => r.createdAt < endTs);
  const all = rows.flatMap((r) => parseSignals(r.text ?? ""));

  return all.filter((s) => {
    if (!includeResolved && (s.from <= 0 || s.from >= 100 || s.to <= 0 || s.to >= 100)) return false;
    if (Math.abs(s.delta) < minDelta) return false;
    return true;
  });
};

const todaySignals = loadSignalsForWindow(dayStart, dayEnd);
const prevSignals = loadSignalsForWindow(prevDayStart, dayStart);

const dedupe = (signals: ShiftSignal[]): ShiftSignal[] => {
  const byKey = new Map<string, ShiftSignal>();
  for (const s of signals) {
    const k = `${s.market}||${s.bet}`;
    const curr = byKey.get(k);
    if (!curr || Math.abs(s.delta) > Math.abs(curr.delta)) byKey.set(k, s);
  }
  return [...byKey.values()];
};

const uniqueToday = dedupe(todaySignals);
const uniquePrev = dedupe(prevSignals);

const topUp = [...uniqueToday].filter((s) => s.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, Math.max(1, topN));
const topDown = [...uniqueToday]
  .filter((s) => s.delta < 0)
  .sort((a, b) => a.delta - b.delta)
  .slice(0, Math.max(1, topN));

const counts = uniqueToday.reduce<Record<ShiftSignal["category"], number>>(
  (acc, s) => {
    acc[s.category] += 1;
    return acc;
  },
  { Sports: 0, Politics: 0, Crypto: 0, Other: 0 }
);

const todayByKey = new Map(uniqueToday.map((s) => [`${s.market}||${s.bet}`, s]));
const prevTopForReliability = [...uniquePrev]
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  .slice(0, Math.max(1, reliabilityWindow));

let followed = 0;
let faded = 0;
for (const p of prevTopForReliability) {
  const t = todayByKey.get(`${p.market}||${p.bet}`);
  if (!t) continue;
  if (Math.sign(t.delta) === Math.sign(p.delta)) followed += 1;
  else faded += 1;
}

const pct = (n: number) => `${n.toFixed(1)}%`;
const fmt = (s: ShiftSignal) =>
  `- ${emojiForCategory(s.category)} ${s.market}: \`${pct(s.from)} → ${pct(s.to)}\` \`${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(1)}pp\``;

const emojiForCategory = (c: ShiftSignal["category"]) => {
  if (c === "Sports") return "🏟️";
  if (c === "Politics") return "🏛️";
  if (c === "Crypto") return "🪙";
  return "🧩";
};

const lines = [
  `📊 Daily Prediction Shift — ${day}`,
  "",
  "🔥 Top Moves Up *(active markets only)*",
  ...(topUp.length ? topUp.map(fmt) : ["- ✅ No major upward shifts"]),
  "",
  "📉 Top Moves Down *(active markets only)*",
  ...(topDown.length ? topDown.map(fmt) : ["- ✅ No major downward shifts"]),
  "",
  "🧭 Where movement happened",
  `- 🏟️ Sports: ${counts.Sports}`,
  `- 🏛️ Politics: ${counts.Politics}`,
  `- 🪙 Crypto: ${counts.Crypto}`,
  ...(counts.Other > 0 ? [`- 🧩 Other: ${counts.Other}`] : []),
  "",
  "🎯 Signal Reliability",
  "- ✅ Followed-through: yesterday's strongest signals continued in the same direction",
  "- ⚠️ Faded: yesterday's strongest signals reversed direction",
  `- Today: **${followed} followed-through | ${faded} faded**`,
  "",
  `Filters: min |Δ| >= ${minDelta}pp, include_resolved=${includeResolved}`,
];

console.log(lines.join("\n"));

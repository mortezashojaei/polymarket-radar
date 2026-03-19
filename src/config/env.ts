import "dotenv/config";

const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID"] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing env: ${key}`);
}

const num = (k: string, d: number) => {
  const raw = process.env[k];
  if (raw === undefined || raw.trim() === "") return d;
  const n = Number(raw);
  return Number.isFinite(n) ? n : d;
};
const bool = (k: string, d = false) => {
  const v = (process.env[k] ?? "").toLowerCase().trim();
  if (!v) return d;
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

export const env = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
  telegramChannelId: process.env.TELEGRAM_CHANNEL_ID!,
  runEveryMinutes: num("RUN_EVERY_MINUTES", 10),
  minLiquidity: num("MIN_LIQUIDITY", 10_000),
  minVolume24h: num("MIN_VOLUME_24H", 5_000),
  minOddsSwing: num("MIN_ODDS_SWING", 10),
  topSignals: num("TOP_SIGNALS", 15),
  clearOnStart: bool("CLEAR_ON_START", false),
  clearOnStartLimit: num("CLEAR_ON_START_LIMIT", 200),
  dbPath: process.env.DATABASE_PATH ?? "./data/radar.db",
  polymarketEventsUrl:
    process.env.POLYMARKET_EVENTS_URL ??
    "https://gamma-api.polymarket.com/events?closed=false&limit=200&active=true",

  // Radar v2 scoring and routing
  scoreTierA: num("SCORE_TIER_A", 75),
  scoreTierB: num("SCORE_TIER_B", 55),
  mergeWindowMinutes: num("MERGE_WINDOW_MINUTES", 20),
  cooldownMinutes: num("COOLDOWN_MINUTES", 45),
  flipLookbackHours: num("FLIP_LOOKBACK_HOURS", 6),
  flipPtsThreshold: num("FLIP_PTS_THRESHOLD", 8),
  reemitScoreDelta: num("REEMIT_SCORE_DELTA", 15),
  minWhaleNotional: num("MIN_WHALE_NOTIONAL", 10_000),
  minFlowMultiple: num("MIN_FLOW_MULTIPLE", 2.5),
  postTierBInDigest: bool("POST_TIER_B_IN_DIGEST", true),

  // Whale transaction polling
  whalePollEnabled: bool("WHALE_POLL_ENABLED", true),
  whalePollMinutes: num("WHALE_POLL_MINUTES", 5),
  whaleSingleTxNotional: num("WHALE_SINGLE_TX_NOTIONAL", 10_000),
  whaleTxWindowMinutes: num("WHALE_TX_WINDOW_MINUTES", 10),
  whaleTxMaxPerPoll: num("WHALE_TX_MAX_PER_POLL", 3),
  whaleMaxProb: num("WHALE_MAX_PROB", 0.98),
  whaleMinProb: num("WHALE_MIN_PROB", 0.02),

  // Global reporting guardrails
  minReportLiquidity: num("MIN_REPORT_LIQUIDITY", 500_000),
};

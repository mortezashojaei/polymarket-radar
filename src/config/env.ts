import "dotenv/config";

const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID"] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing env: ${key}`);
}

const num = (k: string, d: number) => Number(process.env[k] ?? d);
const bool = (k: string, d = false) => {
  const v = (process.env[k] ?? "").toLowerCase().trim();
  if (!v) return d;
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

export const env = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
  telegramChannelId: process.env.TELEGRAM_CHANNEL_ID!,
  runEveryMinutes: num("RUN_EVERY_MINUTES", 15),
  minLiquidity: num("MIN_LIQUIDITY", 10_000),
  minVolume24h: num("MIN_VOLUME_24H", 5_000),
  minOddsSwing: num("MIN_ODDS_SWING", 8),
  topSignals: num("TOP_SIGNALS", 5),
  clearOnStart: bool("CLEAR_ON_START", false),
  clearOnStartLimit: num("CLEAR_ON_START_LIMIT", 200),
  dbPath: process.env.DATABASE_PATH ?? "./data/radar.db",
  polymarketEventsUrl:
    process.env.POLYMARKET_EVENTS_URL ??
    "https://gamma-api.polymarket.com/events?closed=false&limit=200&active=true",
};

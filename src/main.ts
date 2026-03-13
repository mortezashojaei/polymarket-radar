import { env } from "./config/env.js";
import {
  clearQueuedDigestSignals,
  clearSentMessages,
  getKv,
  hasSeen,
  listQueuedDigestSignals,
  listSentMessageIds,
  markSeen,
  queueDigestSignal,
  saveRun,
  saveSentMessage,
  setKv,
} from "./db/sqlite.js";
import { detectSignals } from "./detectors/signals.js";
import { renderDigest } from "./formatters/digest.js";
import { fetchAllMarkets } from "./services/polymarket.js";
import { deleteTelegramMessage, sendTelegramMessage } from "./services/telegram.js";
import { fetchRecentTradeFlow } from "./services/trades.js";
import type { MarketSignal } from "./types/polymarket.js";

const clearChannelOnStart = async () => {
  if (!env.clearOnStart) return;

  const ids = listSentMessageIds(env.clearOnStartLimit);
  if (!ids.length) {
    console.log("[radar] clear_on_start enabled but no tracked messages found");
    return;
  }

  let deleted = 0;
  for (const id of ids) {
    try {
      await deleteTelegramMessage(id);
      deleted += 1;
    } catch {
      // best effort (older msgs may fail by API limits/permissions)
    }
  }

  clearSentMessages();
  console.log(`[radar] clear_on_start deleted ${deleted}/${ids.length} tracked messages`);
};

const hourKeyUtc = (ts = Date.now()): string => {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}`;
};

const flushHourlyDigestIfDue = async () => {
  if (!env.postTierBInDigest) return 0;

  const currentHour = hourKeyUtc();
  const lastDigestHour = getKv("last_digest_hour");
  if (lastDigestHour === currentHour) return 0;

  const payloads = listQueuedDigestSignals(env.topSignals * 4);
  const signals = payloads
    .map((p) => {
      try {
        return JSON.parse(p) as MarketSignal;
      } catch {
        return null;
      }
    })
    .filter((s): s is MarketSignal => !!s)
    .filter((s) => s.tier === "B")
    .sort((a, b) => b.score - a.score)
    .slice(0, env.topSignals);

  setKv("last_digest_hour", currentHour);

  if (!signals.length) {
    clearQueuedDigestSignals();
    return 0;
  }

  const text = renderDigest(signals);
  const messageId = await sendTelegramMessage(`Hourly watchlist digest\n\n${text}`);
  if (messageId) saveSentMessage(messageId);

  clearQueuedDigestSignals();
  return signals.length;
};

const runOnce = async () => {
  const markets = await fetchAllMarkets();
  const tradeFlow = await fetchRecentTradeFlow(86400, 4000).catch(() => new Map());
  const freshSignals = detectSignals(markets, tradeFlow).filter((s) => !hasSeen(s.key));

  for (const s of freshSignals) markSeen(s.key);

  const aSignals = freshSignals.filter((s) => s.tier === "A");
  const bSignals = freshSignals.filter((s) => s.tier === "B");

  for (const s of bSignals) queueDigestSignal(s.key, JSON.stringify(s));

  let postedRealtime = 0;
  if (aSignals.length) {
    const text = renderDigest(aSignals.slice(0, env.topSignals));
    const messageId = await sendTelegramMessage(text);
    if (messageId) saveSentMessage(messageId);
    postedRealtime = aSignals.length;
  }

  const postedDigest = await flushHourlyDigestIfDue();

  const postedTotal = postedRealtime + postedDigest;
  if (postedTotal === 0) {
    saveRun(
      0,
      `markets=${markets.length}; fresh=${freshSignals.length}; a=${aSignals.length}; bQueued=${bSignals.length}; skipped=no-post`
    );
    console.log(
      `[radar] no post from ${markets.length} markets (fresh=${freshSignals.length}, A=${aSignals.length}, B queued=${bSignals.length})`
    );
    return;
  }

  saveRun(
    postedTotal,
    `markets=${markets.length}; fresh=${freshSignals.length}; realtimeA=${postedRealtime}; digestB=${postedDigest}`
  );

  console.log(
    `[radar] posted total=${postedTotal} from ${markets.length} markets (A=${postedRealtime}, digestB=${postedDigest})`
  );
};

const start = async () => {
  await clearChannelOnStart();
  await runOnce();
  const ms = env.runEveryMinutes * 60 * 1000;
  console.log(`[radar] schedule: every ${env.runEveryMinutes} minute(s)`);
  setInterval(() => {
    runOnce().catch((e) => {
      console.error("[radar] run failed", e);
      saveRun(0, `error=${String(e)}`);
    });
  }, ms);
};

start().catch((e) => {
  console.error("startup failed", e);
  process.exit(1);
});

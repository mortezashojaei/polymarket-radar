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
import { fetchRecentTradeFlow, fetchRecentWhaleTrades } from "./services/trades.js";
import type { MarketSignal } from "./types/polymarket.js";
import { bucketLabel, getMarketBucket, thresholdProfileForBucket } from "./utils/market-bucket.js";

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
  const payload = `Hourly watchlist digest\n\n${text}`;
  const messageId = await sendTelegramMessage(payload);
  if (messageId) saveSentMessage(messageId, { text: payload, kind: "digest", tier: "B" });

  clearQueuedDigestSignals();
  return signals.length;
};

const pollWhaleTransactions = async () => {
  if (!env.whalePollEnabled) return;

  const minWhaleFetchFloor = Math.min(
    env.whaleSingleTxNotional,
    env.minWhaleNotional,
    env.minWhaleNotionalNoisy,
    env.minWhaleNotionalPolitics
  );

  const whales = await fetchRecentWhaleTrades(
    minWhaleFetchFloor,
    env.whaleTxWindowMinutes * 60,
    5000
  ).catch(() => []);

  if (!whales.length) return;

  const markets = await fetchAllMarkets().catch(() => []);
  const byCondition = new Map(
    markets
      .filter((m) => !!m.conditionId && (m.liquidity ?? 0) >= env.minReportLiquidity)
      .map((m) => [m.conditionId as string, m])
  );

  let posted = 0;
  for (const w of whales) {
    const key = `whale_tx:${w.conditionId}:${w.outcome}:${w.side}:${Math.round(w.notional)}:${w.timestamp}`;
    if (hasSeen(key)) continue;

    const m = byCondition.get(w.conditionId);
    if (!m) continue; // fully ignore low-volume/unknown markets

    const bucket = getMarketBucket(m);
    const profile = thresholdProfileForBucket(bucket);
    const minWhaleNotionalByBucket =
      profile === "sensitive"
        ? env.minWhaleNotionalPolitics
        : profile === "noisy"
        ? env.minWhaleNotionalNoisy
        : env.minWhaleNotional;

    if (w.notional < Math.max(env.whaleSingleTxNotional, minWhaleNotionalByBucket)) continue;

    // Ignore near-resolved markets (default: >=98% or <=2%)
    const prices = (() => {
      if (Array.isArray(m.outcomePrices)) return m.outcomePrices.map(Number).filter(Number.isFinite);
      if (typeof m.outcomePrices === "string") {
        try {
          const parsed = JSON.parse(m.outcomePrices);
          if (Array.isArray(parsed)) return parsed.map(Number).filter(Number.isFinite);
        } catch {
          return [] as number[];
        }
      }
      return [] as number[];
    })();

    const topProb = prices.length ? Math.max(...prices) : 0;
    if (topProb >= env.whaleMaxProb || topProb <= env.whaleMinProb) continue;

    const title = m.question;
    const link = m.eventSlug
      ? `https://polymarket.com/event/${encodeURIComponent(m.eventSlug)}`
      : m.slug
      ? `https://polymarket.com/event/${encodeURIComponent(m.slug)}`
      : "https://polymarket.com";

    const maxPayout = w.price > 0 ? w.notional / w.price : 0;
    const netProfitIfCorrect = Math.max(0, maxPayout - w.notional);

    const text = [
      "🐋 Whale transaction alert",
      "",
      `🏷️ Category: <b>${bucketLabel(bucket)}</b>`,
      `📍 <b>${title}</b>`,
      `🎯 Outcome: <b>${w.outcome.toUpperCase()}</b>`,
      `↕️ Side: <b>${w.side}</b>`,
      `💵 Notional: <b>$${Math.round(w.notional).toLocaleString()}</b>`,
      `💲 Price: <b>${(w.price * 100).toFixed(1)}%</b>`,
      `📦 Size: <b>${Math.round(w.size).toLocaleString()}</b>`,
      ...(w.side === "BUY"
        ? [
            `🏆 Max payout (if correct): <b>$${Math.round(maxPayout).toLocaleString()}</b>`,
            `💰 Net profit (if correct): <b>$${Math.round(netProfitIfCorrect).toLocaleString()}</b>`,
          ]
        : []),
      `🔗 <a href="${link}">Go to market</a>`,
    ].join("\n");

    const messageId = await sendTelegramMessage(text);
    if (messageId) saveSentMessage(messageId, { text, kind: "whale_tx", tier: "A" });

    markSeen(key);
    posted += 1;
    if (posted >= env.whaleTxMaxPerPoll) break;
  }

  if (posted > 0) console.log(`[radar] whale poll posted ${posted} alert(s)`);
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
    if (messageId) saveSentMessage(messageId, { text, kind: "realtime", tier: "A" });
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
  await pollWhaleTransactions();

  const ms = env.runEveryMinutes * 60 * 1000;
  console.log(`[radar] schedule: every ${env.runEveryMinutes} minute(s)`);
  setInterval(() => {
    runOnce().catch((e) => {
      console.error("[radar] run failed", e);
      saveRun(0, `error=${String(e)}`);
    });
  }, ms);

  if (env.whalePollEnabled) {
    const whaleMs = env.whalePollMinutes * 60 * 1000;
    console.log(`[radar] whale poll: every ${env.whalePollMinutes} minute(s)`);
    setInterval(() => {
      pollWhaleTransactions().catch((e) => {
        console.error("[radar] whale poll failed", e);
      });
    }, whaleMs);
  }
};

start().catch((e) => {
  console.error("startup failed", e);
  process.exit(1);
});

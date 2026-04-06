import { env } from "./config/env.js";
import {
  clearSentMessages,
  getKv,
  hasSeen,
  listAlertPostsBetween,
  listMarketShiftsBetween,
  listSentMessageIds,
  markSeen,
  saveAlertPost,
  saveRun,
  saveSentMessage,
  setKv,
  getMarketState,
} from "./db/sqlite.js";
import { detectSignals } from "./detectors/signals.js";
import { renderBroadcasts, renderDailyRecap } from "./formatters/digest.js";
import { fetchAllMarkets } from "./services/polymarket.js";
import { deleteTelegramMessage, sendTelegramMessage } from "./services/telegram.js";
import { fetchRecentTradeFlow, fetchRecentWhaleTrades } from "./services/trades.js";
import { bucketLabel, getMarketBucket, thresholdProfileForBucket } from "./utils/market-bucket.js";

const escHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escAttr = (s: string): string => escHtml(s).replaceAll('"', "&quot;");

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
      // best effort
    }
  }

  clearSentMessages();
  console.log(`[radar] clear_on_start deleted ${deleted}/${ids.length} tracked messages`);
};

const dayKeyUtc = (ts = Date.now()): string => {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
};

const startOfUtcDay = (ts = Date.now()): number => {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const maybePostDailyRecap = async (): Promise<boolean> => {
  const now = Date.now();
  const todayKey = dayKeyUtc(now);
  const recapKey = `daily_recap:${todayKey}`;
  if (getKv(recapKey) === "1") return false;

  const nowDate = new Date(now);
  if (nowDate.getUTCHours() < env.dailyRecapHourUtc) return false;

  const todayStart = startOfUtcDay(now);
  const yesterdayStart = todayStart - 24 * 3_600_000;

  const shifts = listMarketShiftsBetween(yesterdayStart, todayStart);
  if (!shifts.length) {
    setKv(recapKey, "1");
    return false;
  }

  const increases = shifts
    .filter((s) => s.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);
  const collapses = shifts
    .filter((s) => s.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 5);

  const themeMap = new Map<string, number>();
  for (const s of shifts.filter((x) => Math.abs(x.delta) >= 4)) {
    themeMap.set(s.category, (themeMap.get(s.category) ?? 0) + 1);
  }
  const themes = [...themeMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const posts = listAlertPostsBetween(yesterdayStart, todayStart);
  let held = 0;
  let faded = 0;
  for (const p of posts) {
    const state = getMarketState(p.market_id);
    if (!state) continue;
    const realized = state.topProb - p.entry_prob;
    if ((p.direction > 0 && realized >= 0) || (p.direction < 0 && realized <= 0)) held += 1;
    else faded += 1;
  }

  const recapText = renderDailyRecap({
    increases,
    collapses,
    themes,
    followThrough: { held, faded },
    recapDateLabel: new Date(yesterdayStart).toISOString().slice(0, 10),
  });

  const messageId = await sendTelegramMessage(recapText);
  if (messageId) saveSentMessage(messageId, { text: recapText, kind: "daily_recap", tier: "A" });
  setKv(recapKey, "1");
  return true;
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
    if (!m) continue;

    const bucket = getMarketBucket(m);
    const profile = thresholdProfileForBucket(bucket);
    const minWhaleNotionalByBucket =
      profile === "sensitive"
        ? w.side === "SELL"
          ? env.minWhaleNotionalPoliticsSell
          : env.minWhaleNotionalPolitics
        : profile === "noisy"
        ? env.minWhaleNotionalNoisy
        : env.minWhaleNotional;

    if (w.notional < Math.max(env.whaleSingleTxNotional, minWhaleNotionalByBucket)) continue;

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
    if (w.side === "BUY" && netProfitIfCorrect < env.whaleMinBuyProfitIfCorrect) continue;

    const text = [
      "🐋 Whale transaction alert",
      "",
      `🏷️ Category: <b>${bucketLabel(bucket)}</b>`,
      `📍 <b>${escHtml(title)}</b>`,
      `🎯 Outcome: <b>${escHtml(w.outcome.toUpperCase())}</b>`,
      `↕️ Side: <b>${escHtml(w.side)}</b>`,
      `💵 Notional: <b>$${Math.round(w.notional).toLocaleString()}</b>`,
      `💲 Price: <b>${(w.price * 100).toFixed(1)}%</b>`,
      `🔗 <a href="${escAttr(link)}">Go to market</a>`,
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

  if (freshSignals.length) {
    const text = renderBroadcasts(freshSignals.slice(0, env.topSignals));
    const messageId = await sendTelegramMessage(text);
    if (messageId) saveSentMessage(messageId, { text, kind: "broadcast", tier: "A" });

    for (const s of freshSignals.slice(0, env.topSignals)) {
      saveAlertPost({
        marketId: s.marketId,
        signalType: s.type,
        confidence: s.confidence,
        direction: s.evidence.deltaPts >= 0 ? 1 : -1,
        entryProb: s.evidence.toProb,
        createdAt: s.createdAt,
      });
    }
  }

  const postedRecap = await maybePostDailyRecap();
  const postedTotal = (freshSignals.length ? 1 : 0) + (postedRecap ? 1 : 0);

  if (postedTotal === 0) {
    saveRun(0, `markets=${markets.length}; fresh=${freshSignals.length}; skipped=no-post`);
    console.log(`[radar] no post from ${markets.length} markets (fresh=${freshSignals.length})`);
    return;
  }

  saveRun(postedTotal, `markets=${markets.length}; broadcasts=${freshSignals.length ? 1 : 0}; recap=${postedRecap ? 1 : 0}`);
  console.log(`[radar] posted total=${postedTotal} from ${markets.length} markets`);
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

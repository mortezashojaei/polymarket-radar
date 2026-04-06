import { env } from "../config/env.js";
import {
  getMarketState,
  getSignalState,
  listMarketPostCounts,
  upsertMarketState,
  upsertSignalState,
  upsertMarketSnapshot,
} from "../db/sqlite.js";
import type {
  MarketSignal,
  PredictiveConfidence,
  RawMarket,
  SignalTier,
  SignalType,
} from "../types/polymarket.js";
import type { TradeFlowSummary } from "../types/trades.js";
import { bucketLabel, getMarketBucket, thresholdProfileForBucket } from "../utils/market-bucket.js";

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const parsePrices = (m: RawMarket): number[] => {
  if (Array.isArray(m.outcomePrices)) return m.outcomePrices.map(Number).filter(Number.isFinite);
  if (typeof m.outcomePrices === "string") {
    try {
      const arr = JSON.parse(m.outcomePrices);
      if (Array.isArray(arr)) return arr.map(Number).filter(Number.isFinite);
    } catch {}
  }
  return [];
};

const parseOutcomes = (m: RawMarket): string[] => {
  if (Array.isArray(m.outcomes)) return m.outcomes.map(String);
  if (typeof m.outcomes === "string") {
    try {
      const arr = JSON.parse(m.outcomes);
      if (Array.isArray(arr)) return arr.map(String);
    } catch {}
  }
  return ["Yes", "No"];
};

const marketUrl = (m: RawMarket): string => {
  const slug = m.eventSlug ?? m.slug;
  return slug ? `https://polymarket.com/event/${encodeURIComponent(slug)}` : "https://polymarket.com";
};

const confidenceFromScore = (score: number): PredictiveConfidence => {
  if (score >= env.predictiveConfidenceHigh) return "High";
  if (score >= env.predictiveConfidenceMed) return "Med";
  return "Low";
};

const tierFromScore = (score: number): SignalTier => {
  if (score >= env.scoreTierA) return "A";
  if (score >= env.scoreTierB) return "B";
  return "C";
};

const classifySignalType = (
  fromProb: number,
  toProb: number,
  absDelta: number,
  flow: TradeFlowSummary | undefined
): SignalType | null => {
  const crossFavorite = (fromProb >= 50 && toProb < 50) || (fromProb < 50 && toProb >= 50);
  const zoneBreak =
    (fromProb >= 70 && toProb < 60) ||
    (fromProb >= 90 && toProb < 80) ||
    (fromProb <= 30 && toProb > 40) ||
    (fromProb <= 10 && toProb > 20);

  if ((fromProb >= 75 && toProb <= 65) || (fromProb <= 25 && toProb >= 35)) return "CONSENSUS_CRACK";
  if (crossFavorite || zoneBreak) return "REGIME_SHIFT";
  if ((flow?.whaleCount ?? 0) >= env.minWhaleCountForCoordination && absDelta >= env.minOddsSwing) {
    return "COORDINATED_WHALE_FLOW";
  }
  if (absDelta >= env.minOddsSwing) return "CONVICTION_SPIKE";
  return null;
};

const whyItMatters = (type: SignalType, question: string): string => {
  switch (type) {
    case "REGIME_SHIFT":
      return `The market's base case changed for: ${question}.`;
    case "CONSENSUS_CRACK":
      return "A previously high-confidence stance is being repriced lower, raising outcome uncertainty.";
    case "COORDINATED_WHALE_FLOW":
      return "Large, aligned capital can lead price discovery before broader positioning catches up.";
    default:
      return "Money-backed repricing suggests real-world expectations may be shifting now.";
  }
};

const invalidationLine = (toProb: number): string =>
  `Invalidated if price reverts below ${Math.max(5, toProb - 4).toFixed(1)}% within ${env.invalidationWindowHours}h with weak follow-through flow.`;

export const detectSignals = (
  markets: RawMarket[],
  tradeFlowByCondition: Map<string, TradeFlowSummary> = new Map()
): MarketSignal[] => {
  const now = Date.now();
  const filtered = markets.filter(
    (m) =>
      (m.liquidity ?? 0) >= env.minLiquidity &&
      (m.volume24hr ?? 0) >= env.minVolume24h &&
      (m.liquidity ?? 0) >= env.minReportLiquidity
  );

  const recentCounts = listMarketPostCounts(now - 24 * 3_600_000);
  const out: MarketSignal[] = [];

  for (const m of filtered) {
    const prices = parsePrices(m);
    const outcomes = parseOutcomes(m);
    if (!prices.length) continue;

    const ranked = prices.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
    const topIdx = ranked[0]?.i ?? 0;
    const secondIdx = ranked[1]?.i ?? topIdx;

    const top = (prices[topIdx] ?? 0) * 100;
    const second = (prices[secondIdx] ?? 0) * 100;
    const topOutcome = outcomes[topIdx] ?? "Top";
    const nearResolved = top >= 98;

    const prev = getMarketState(m.id);
    const fromProb = prev?.topProb ?? top;
    const delta = top - fromProb;
    const absDelta = Math.abs(delta);
    const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;

    const bucket = getMarketBucket(m);
    const profile = thresholdProfileForBucket(bucket);
    const minOddsSwingByBucket =
      profile === "sensitive"
        ? env.minOddsSwingPolitics
        : profile === "noisy"
        ? env.minOddsSwingNoisy
        : env.minOddsSwing;

    const flow = m.conditionId ? tradeFlowByCondition.get(m.conditionId) : undefined;
    const netFlow = Math.max(0, flow?.netNotional ?? 0);
    const tradeCount = flow?.tradeCount ?? 0;
    const walletDiversity = flow?.walletDiversity ?? 0;
    const whaleCount = flow?.whaleCount ?? 0;

    const noveltyMinutes = prev ? (now - prev.updatedAt) / 60_000 : 999;
    const velocity = prev ? absDelta / Math.max(noveltyMinutes / 60, 0.1) : absDelta;
    const persistenceScore = clamp(noveltyMinutes / 90, 0, 1);
    const spreadBps = clamp(1200 / Math.max((m.liquidity ?? 1) / 10_000, 1), 8, 250);

    const moveQuality = clamp(absDelta * 4 + velocity * 2 + persistenceScore * 18, 0, 100);
    const moneyQuality = clamp(netFlow / 4_000 + tradeCount * 1.5 + walletDiversity * 2 + whaleCount * 8, 0, 100);
    const marketQuality = clamp((m.liquidity ?? 0) / 40_000 + (250 - spreadBps) * 0.2, 0, 100);

    let stabilityPenalty = 0;
    let flipCount6h = prev?.flipCount6h ?? 0;
    if (prev) {
      const withinFlipWindow = now - prev.updatedAt <= env.flipLookbackHours * 3_600_000;
      if (withinFlipWindow && prev.lastDirection !== 0 && direction !== 0 && prev.lastDirection !== direction) {
        if (absDelta >= env.flipPtsThreshold || Math.abs(prev.lastDelta) >= env.flipPtsThreshold) {
          flipCount6h += 1;
        }
      } else if (!withinFlipWindow) {
        flipCount6h = 0;
      }
    }

    if (flipCount6h >= 1) stabilityPenalty += 15;
    if (spreadBps > 120) stabilityPenalty += 10;
    if ((m.liquidity ?? 0) < env.minReportLiquidity * 1.2) stabilityPenalty += 8;

    const predictiveScore = clamp(
      Math.round(moveQuality * 0.34 + moneyQuality * 0.33 + marketQuality * 0.23 - stabilityPenalty),
      0,
      100
    );

    const type = classifySignalType(fromProb, top, absDelta, flow);
    const confidence = confidenceFromScore(predictiveScore);
    const tier = tierFromScore(predictiveScore);

    const evidenceStrongEnough =
      absDelta >= minOddsSwingByBucket &&
      tradeCount >= env.minTradeCountForBroadcast &&
      netFlow >= env.minNetFlowForBroadcast;
    const confidencePass =
      confidence === "High" || (confidence === "Med" && env.allowMedConfidenceBroadcasts);

    const signalState = getSignalState(m.id);
    const elapsedMs = signalState ? now - signalState.lastAlertAt : Number.MAX_SAFE_INTEGER;
    const inCooldown = elapsedMs < env.broadcastCooldownMinutes * 60_000;
    const dailyCount = recentCounts.get(m.id) ?? 0;
    const dailyCapReached = dailyCount >= env.broadcastDailyCapPerMarket;

    const categoryRepeatPenalty = dailyCount >= 2 ? 8 : 0;
    const adjustedScore = clamp(predictiveScore - categoryRepeatPenalty, 0, 100);

    const shouldEmit =
      !!type &&
      !nearResolved &&
      tier !== "C" &&
      confidencePass &&
      evidenceStrongEnough &&
      !inCooldown &&
      !dailyCapReached;

    if (shouldEmit) {
      const link = marketUrl(m);
      const category = bucketLabel(bucket);
      const moveSummary = `${topOutcome.toUpperCase()} ${fromProb.toFixed(1)}% → ${top.toFixed(1)}% (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%)`;
      const typeLabel = type.replaceAll("_", " ");

      out.push({
        key: `v3:${m.id}:${type}:${Math.round(top)}:${Math.sign(delta)}:${Math.round(adjustedScore / 5)}`,
        marketId: m.id,
        outcome: topOutcome,
        type,
        title: `${m.categoryEmoji ?? "🧩"} [${typeLabel}] ${m.question}`,
        body: [
          `Move: ${moveSummary}`,
          `Money evidence: Net flow $${Math.round(netFlow).toLocaleString()} | Trades ${tradeCount} | Whale count ${whaleCount}`,
          `Microstructure: Liquidity $${Math.round(m.liquidity ?? 0).toLocaleString()} | Spread ${Math.round(spreadBps)} bps`,
          `Predictive confidence: ${confidence}`,
          `Why it matters: ${whyItMatters(type, m.question)}`,
          invalidationLine(top),
          `Link: ${link}`,
        ].join(" | "),
        confidence,
        score: adjustedScore,
        tier,
        reasons: [type, `MOVE_${Math.round(moveQuality)}`, `MONEY_${Math.round(moneyQuality)}`],
        createdAt: now,
        link,
        category,
        invalidation: invalidationLine(top),
        whyItMatters: whyItMatters(type, m.question),
        evidence: {
          fromProb,
          toProb: top,
          deltaPts: delta,
          velocityPtsPerHour: velocity,
          persistenceScore,
          netFlow,
          tradeCount,
          whaleCount,
          liquidity: m.liquidity ?? 0,
          spreadBps,
        },
      });

      upsertSignalState(m.id, adjustedScore, tier, direction, now);
    }

    upsertMarketState(m.id, topOutcome, top, m.volume24hr ?? 0, delta, direction, flipCount6h);
    upsertMarketSnapshot(m.id, m.question, bucketLabel(bucket), topOutcome, top, now);
  }

  const ranked = out
    .sort((a, b) => b.score - a.score)
    .filter((s, i, arr) => arr.findIndex((x) => x.marketId === s.marketId) === i)
    .slice(0, env.topSignals);

  return ranked;
};

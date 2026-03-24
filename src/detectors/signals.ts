import { env } from "../config/env.js";
import { getMarketState, getSignalState, upsertMarketState, upsertSignalState } from "../db/sqlite.js";
import type { MarketSignal, RawMarket, SignalTier } from "../types/polymarket.js";
import type { TradeFlowSummary } from "../types/trades.js";
import { getMarketBucket } from "../utils/market-bucket.js";

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const confidenceFromTier = (tier: SignalTier): "Low" | "Med" | "High" => {
  if (tier === "A") return "High";
  if (tier === "B") return "Med";
  return "Low";
};

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

const sideEmoji = (s: string): string => {
  const u = s.toUpperCase();
  if (u === "YES") return "🟢 YES";
  if (u === "NO") return "🔴 NO";
  return u;
};

const tierFromScore = (score: number): SignalTier => {
  if (score >= env.scoreTierA) return "A";
  if (score >= env.scoreTierB) return "B";
  return "C";
};

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

  const baselineVolume =
    filtered.reduce((acc, m) => acc + (m.volume24hr ?? 0), 0) / Math.max(filtered.length, 1);

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
    const secondOutcome = outcomes[secondIdx] ?? "Other";
    const nearResolved = top >= 98;

    const prev = getMarketState(m.id);
    const delta = prev ? top - prev.topProb : 0;
    const absDelta = Math.abs(delta);
    const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;
    const volume24h = m.volume24hr ?? 0;

    const volumeDelta = prev ? Math.max(0, volume24h - prev.volume24h) : 0;
    const flow = m.conditionId ? tradeFlowByCondition.get(m.conditionId) : undefined;
    const flowMultiple = baselineVolume > 0 ? volume24h / baselineVolume : 1;
    const flowScore = clamp(((flowMultiple - 1) / 6) * 100, 0, 100);

    const bucket = getMarketBucket(m);
    const minWhaleNotionalByBucket =
      bucket === "politics"
        ? env.minWhaleNotionalPolitics
        : bucket === "noisy"
        ? env.minWhaleNotionalNoisy
        : env.minWhaleNotional;
    const minOddsSwingByBucket =
      bucket === "politics"
        ? env.minOddsSwingPolitics
        : bucket === "noisy"
        ? env.minOddsSwingNoisy
        : env.minOddsSwing;

    const volatilityScale = Math.max(minOddsSwingByBucket, Math.abs(prev?.lastDelta ?? minOddsSwingByBucket));
    const moveScore = clamp((absDelta / (volatilityScale || 1)) * 100, 0, 100);

    const liquidityNorm = clamp(((m.liquidity ?? 0) - env.minLiquidity) / (env.minLiquidity * 4), 0, 1);
    const liqScore = Math.round(liquidityNorm * 100);

    const noveltyMinutes = prev ? (now - prev.updatedAt) / 60_000 : 999;
    const noveltyScore = clamp((noveltyMinutes / env.mergeWindowMinutes) * 100, 0, 100);

    const proximityScore = clamp((top >= 98 ? 0 : top >= 90 ? 20 : 60) + (top <= 10 ? 10 : 0), 0, 100);

    let penalties = 0;
    const reasons: string[] = [];

    if (absDelta >= minOddsSwingByBucket) reasons.push("LARGE_REPRICE");
    if (flowMultiple >= env.minFlowMultiple) reasons.push("FLOW_SPIKE");
    if ((flow?.netNotional ?? 0) >= minWhaleNotionalByBucket) reasons.push("WHALE_SIZE");

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

    if (flipCount6h >= 1) {
      penalties += 12;
      reasons.push("FLIP_RISK");
    }
    if ((m.liquidity ?? 0) < env.minLiquidity * 1.5) {
      penalties += 8;
      reasons.push("THIN_LIQUIDITY");
    }

    const scoreRaw =
      moveScore * 0.25 + liqScore * 0.2 + flowScore * 0.25 + noveltyScore * 0.2 + proximityScore * 0.1;
    const score = clamp(Math.round(scoreRaw - penalties), 0, 100);
    const tier = tierFromScore(score);

    // Dedup + cooldown behavior by market
    const state = getSignalState(m.id);
    const elapsedMs = state ? now - state.lastAlertAt : Number.MAX_SAFE_INTEGER;
    const inCooldown = elapsedMs < env.cooldownMinutes * 60_000;
    const improvedEnough = !state || score - state.lastScore >= env.reemitScoreDelta;
    const tierUpgraded = !!state && state.lastTier !== "A" && tier === "A";
    const directionFlipped = !!state && direction !== 0 && state.lastDirection !== 0 && direction !== state.lastDirection;

    const shouldEmit =
      !nearResolved &&
      tier !== "C" &&
      absDelta >= minOddsSwingByBucket &&
      (!inCooldown || improvedEnough || tierUpgraded || directionFlipped);

    if (shouldEmit) {
      const link = marketUrl(m);
      const flowText = flow ? ` | Flow: ${flow.side} ~$${Math.round(flow.netNotional).toLocaleString()}` : "";
      const flipLabel = reasons.includes("FLIP_RISK") ? " | Regime: Volatile" : "";

      const catPrefix = m.categoryEmoji ?? "🧩";

      const hasPrev = !!prev;
      const moveSummary = hasPrev
        ? `${topOutcome.toUpperCase()} ${prev.topProb.toFixed(1)}% → ${top.toFixed(1)}% (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%)`
        : `${topOutcome.toUpperCase()} → ${top.toFixed(1)}%`;

      out.push({
        key: `v2:${m.id}:${tier}:${Math.round(top)}:${Math.sign(delta)}:${Math.round(score / 5)}`,
        marketId: m.id,
        outcome: topOutcome,
        type: "MERGED_SIGNAL",
        title: `${catPrefix} · Signal ${tier}: ${m.question}`,
        body:
          `${moveSummary} (vs ${secondOutcome.toUpperCase()} ${second.toFixed(1)}%).` +
          ` | Score: ${score}/100 (move ${Math.round(moveScore)}, flow ${Math.round(flowScore)}, liq ${liqScore})` +
          `${flowText}${flipLabel}` +
          ` | Read: ${reasons.join(", ") || "MOMENTUM"}` +
          ` | Link: ${link}`,
        confidence: confidenceFromTier(tier),
        score,
        tier,
        reasons,
        createdAt: now,
      });

      upsertSignalState(m.id, score, tier, direction, now);
    }

    upsertMarketState(m.id, topOutcome, top, volume24h, delta, direction, flipCount6h);
  }

  const ranked = out
    .sort((a, b) => b.score - a.score)
    .filter((s, i, arr) => arr.findIndex((x) => x.marketId === s.marketId) === i);

  const aTier = ranked.filter((s) => s.tier === "A");
  const bTier = ranked.filter((s) => s.tier === "B");

  const picked = env.postTierBInDigest
    ? [...aTier, ...bTier].slice(0, env.topSignals)
    : aTier.slice(0, env.topSignals);

  return picked;
};

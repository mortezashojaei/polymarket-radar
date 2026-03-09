import { env } from "../config/env.js";
import { getMarketState, upsertMarketState } from "../db/sqlite.js";
import type { MarketSignal, RawMarket } from "../types/polymarket.js";
import type { TradeFlowSummary } from "../types/trades.js";

const confidenceFromScore = (score: number): "Low" | "Med" | "High" => {
  if (score >= 80) return "High";
  if (score >= 50) return "Med";
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

const sideEmoji = (s: string): string =>
  s.toUpperCase() === "YES" ? "🟢 YES" : s.toUpperCase() === "NO" ? "🔴 NO" : s.toUpperCase();

export const detectSignals = (
  markets: RawMarket[],
  tradeFlowByCondition: Map<string, TradeFlowSummary> = new Map()
): MarketSignal[] => {
  const filtered = markets.filter(
    (m) => (m.liquidity ?? 0) >= env.minLiquidity && (m.volume24hr ?? 0) >= env.minVolume24h
  );

  const baselineVolume =
    filtered.reduce((acc, m) => acc + (m.volume24hr ?? 0), 0) / Math.max(filtered.length, 1);

  const out: MarketSignal[] = [];

  const byCondition = new Map<string, RawMarket>();
  for (const m of filtered) {
    if (m.conditionId) byCondition.set(m.conditionId, m);
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

    const vol = Math.round(m.volume24hr ?? 0);
    const liq = Math.round(m.liquidity ?? 0);
    const link = marketUrl(m);

    const prev = getMarketState(m.id);
    const delta = prev ? top - prev.topProb : 0;
    const absDelta = Math.abs(delta);
    const volumeDelta = prev ? Math.max(0, (m.volume24hr ?? 0) - (prev.volume24h ?? 0)) : 0;

    const tooStale = top >= 90 && absDelta < 5;

    if (!tooStale && absDelta >= 6) {
      const score = Math.min(100, Math.round(absDelta * 9));
      out.push({
        key: `move:${m.id}:${Math.round(top)}:${Math.sign(delta)}`,
        type: "PRICE_MOVE",
        title: `Price Move: ${m.question}`,
        body: `What happened: ${topOutcome.toUpperCase()} moved ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts to ${top.toFixed(1)}% (vs ${secondOutcome.toUpperCase()} ${second.toFixed(1)}%). | Why flagged: 1h-style move >= 6 pts with vol ${vol}, liq ${liq}. | Link: ${link}`,
        confidence: confidenceFromScore(score),
        score,
      });
    }

    if (!tooStale && (m.volume24hr ?? 0) >= baselineVolume * 2.2 && absDelta >= 3 && baselineVolume > 0) {
      const multiple = (m.volume24hr ?? 0) / baselineVolume;
      const score = Math.min(100, Math.round(multiple * 28 + absDelta * 6));
      out.push({
        key: `spike:${m.id}:${Math.floor((m.volume24hr ?? 0) / 1000)}:${Math.round(top)}`,
        type: "VOLUME_SPIKE",
        title: `Flow + Move: ${m.question}`,
        body: `What happened: heavy flow (${multiple.toFixed(1)}x baseline) while ${topOutcome.toUpperCase()} moved ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts. | Why flagged: volume acceleration + price movement (vol ${vol}, liq ${liq}). | Link: ${link}`,
        confidence: confidenceFromScore(score),
        score,
      });
    }

    if (!tooStale && prev && prev.topProb < 60 && top >= 70) {
      const score = Math.min(100, Math.round((top - 60) * 3 + absDelta * 8));
      out.push({
        key: `break:${m.id}:${Math.round(top)}`,
        type: "BREAKOUT",
        title: `Breakout: ${m.question}`,
        body: `What happened: ${topOutcome.toUpperCase()} crossed into strong-consensus zone at ${top.toFixed(1)}% (from ${prev.topProb.toFixed(1)}%). | Why flagged: crossed 70% after being sub-60%. | Link: ${link}`,
        confidence: confidenceFromScore(score),
        score,
      });
    }

    const tradeFlow = m.conditionId ? tradeFlowByCondition.get(m.conditionId) : undefined;
    const flowSide = tradeFlow?.side;
    const flowOutcome = tradeFlow?.outcome;
    const flowNet = Math.round(tradeFlow?.netNotional ?? 0);

    const hasStrongFlow = flowNet >= 10;
    const hasDeltaSignal = prev && (volumeDelta >= 50_000 || (volumeDelta >= 25_000 && absDelta >= 2));
    const hasBootstrapSignal = !prev && flowNet >= 10;

    if (
      !tooStale &&
      liq >= env.minLiquidity * 2 &&
      flowSide &&
      flowOutcome &&
      hasStrongFlow &&
      (hasDeltaSignal || hasBootstrapSignal)
    ) {
      const score = Math.min(
        100,
        Math.round((hasDeltaSignal ? volumeDelta / 1200 + absDelta * 8 : 35) + flowNet * 2)
      );
      const moved = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
      const flowText = flowSide === "BUY" ? "Added" : "Reduced";
      const movedText = prev ? `(${moved})` : "";
      out.push({
        key: `whale:${m.id}:${Math.floor(flowNet * 10)}:${Math.round(top)}:${flowSide}:${flowOutcome}`,
        type: "WHALE_WATCH",
        title: ``,
        body: `📍 Market: ${m.question} | 🐋 Whale move: ${flowText} ~$${flowNet.toLocaleString()} to ${sideEmoji(flowOutcome)} | 📈 Price reaction: ${sideEmoji(topOutcome)} ${top.toFixed(1)}% ${movedText}`.trim() + ` | 🧠 Read: Visible recent flow leans ${sideEmoji(flowOutcome)} | 🔗 Bet link: ${link}`,
        confidence: confidenceFromScore(score),
        score,
      });
    }

    upsertMarketState(m.id, topOutcome, top, m.volume24hr ?? 0);
  }

  if (out.length === 0) {
    const fallback = [...tradeFlowByCondition.values()]
      .filter((t) => t.netNotional >= 10)
      .sort((a, b) => b.netNotional - a.netNotional)
      .slice(0, Math.max(3, env.topSignals));

    for (const t of fallback) {
      const m = byCondition.get(t.conditionId);
      if (!m) continue;

      const prices = parsePrices(m);
      const outcomes = parseOutcomes(m);
      const ranked = prices.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
      const topIdx = ranked[0]?.i ?? 0;
      const top = (prices[topIdx] ?? 0) * 100;
      const topOutcome = outcomes[topIdx] ?? "Top";
      const link = marketUrl(m);
      const liq = Math.round(m.liquidity ?? 0);
      const vol = Math.round(m.volume24hr ?? 0);
      const flowText = t.side === "BUY" ? "Added" : "Reduced";
      const flowNet = Math.round(t.netNotional);

      out.push({
        key: `fallback:${m.id}:${t.side}:${t.outcome}:${flowNet}`,
        type: "WHALE_WATCH",
        title: "",
        body: `📍 Market: ${m.question} | 🐋 Whale move: ${flowText} ~$${flowNet.toLocaleString()} to ${sideEmoji(t.outcome)} | 📈 Price reaction: ${sideEmoji(topOutcome)} ${top.toFixed(1)}% (24h context) | 🧠 Read: Visible recent flow leans ${sideEmoji(t.outcome)} | 🔗 Bet link: ${link}`,
        confidence: "Med",
        score: 45,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, env.topSignals);
};

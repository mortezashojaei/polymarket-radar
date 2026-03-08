import { env } from "../config/env.js";
import type { MarketSignal, RawMarket } from "../types/polymarket.js";

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

const marketUrl = (m: RawMarket): string =>
  m.slug ? `https://polymarket.com/event/${m.slug}` : "https://polymarket.com";

export const detectSignals = (markets: RawMarket[]): MarketSignal[] => {
  const filtered = markets.filter(
    (m) => (m.liquidity ?? 0) >= env.minLiquidity && (m.volume24hr ?? 0) >= env.minVolume24h
  );

  const baselineVolume =
    filtered.reduce((acc, m) => acc + (m.volume24hr ?? 0), 0) / Math.max(filtered.length, 1);

  const out: MarketSignal[] = [];

  for (const m of filtered) {
    const prices = parsePrices(m);
    const outcomes = parseOutcomes(m);
    const topIdx = prices.length ? prices.indexOf(Math.max(...prices)) : 0;
    const secondIdx =
      prices.length > 1
        ? prices
            .map((p, i) => ({ p, i }))
            .sort((a, b) => b.p - a.p)[1]?.i ?? 1
        : 1;

    const top = prices.length ? (prices[topIdx] ?? 0) * 100 : 0;
    const second = prices.length > 1 ? (prices[secondIdx] ?? 0) * 100 : 0;
    const topOutcome = outcomes[topIdx] ?? "Top";
    const secondOutcome = outcomes[secondIdx] ?? "Other";
    const gap = top - second;
    const vol = Math.round(m.volume24hr ?? 0);
    const liq = Math.round(m.liquidity ?? 0);
    const link = marketUrl(m);

    if (gap >= env.minOddsSwing) {
      const score = Math.min(100, Math.round(gap * 4));
      out.push({
        key: `gap:${m.id}:${Math.round(top)}`,
        type: "ODDS_SWING",
        title: `Consensus Gap: ${m.question}`,
        body: `What happened: ${topOutcome.toUpperCase()} leads ${top.toFixed(1)}% vs ${secondOutcome.toUpperCase()} ${second.toFixed(1)}% (gap ${gap.toFixed(1)} pts). | Why flagged: gap >= ${env.minOddsSwing} pts (vol ${vol}, liq ${liq}). | Link: ${link}`,
        confidence: confidenceFromScore(score),
        score,
      });
    }

    if ((m.volume24hr ?? 0) >= baselineVolume * 1.8 && baselineVolume > 0) {
      const multiple = (m.volume24hr ?? 0) / baselineVolume;
      const score = Math.min(100, Math.round(multiple * 30));
      out.push({
        key: `vol:${m.id}:${Math.floor((m.volume24hr ?? 0) / 1000)}`,
        type: "VOLUME_SPIKE",
        title: `Volume Spike: ${m.question}`,
        body: `What happened: 24h volume jumped to ${vol} (${multiple.toFixed(1)}x market baseline). | Why flagged: volume spike threshold is 1.8x baseline (liq ${liq}). | Link: ${link}`,
        confidence: confidenceFromScore(score),
        score,
      });
    }

    if ((m.volume24hr ?? 0) > env.minVolume24h * 3 && (m.liquidity ?? 0) > env.minLiquidity * 2) {
      const score = Math.min(100, Math.round(((m.volume24hr ?? 0) / env.minVolume24h) * 20));
      out.push({
        key: `trend:${m.id}:${Math.floor((m.volume24hr ?? 0) / 5000)}`,
        type: "TRENDING",
        title: `Trending Market: ${m.question}`,
        body: `What happened: sustained activity with vol ${vol} and liquidity ${liq}. | Why flagged: vol > ${env.minVolume24h * 3} and liq > ${env.minLiquidity * 2}. | Link: ${link}`,
        confidence: confidenceFromScore(score),
        score,
      });
    }
  }

  if (out.length === 0) {
    const base = filtered.length ? filtered : markets;
    const fallback = base
      .slice()
      .sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0))
      .slice(0, Math.min(env.topSignals, 3));

    for (const m of fallback) {
      const vol = Math.round(m.volume24hr ?? 0);
      const liq = Math.round(m.liquidity ?? 0);
      const link = marketUrl(m);
      out.push({
        key: `fallback:${m.id}:${Math.floor(vol / 1000)}`,
        type: "TRENDING",
        title: `Market Watch: ${m.question}`,
        body: `What happened: this is one of the most active political markets right now. | Why flagged: fallback watchlist by highest 24h volume (${vol}) with liquidity ${liq}. | Link: ${link}`,
        confidence: "Low",
        score: 35,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, env.topSignals);
};

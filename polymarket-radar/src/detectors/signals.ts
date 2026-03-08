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

export const detectSignals = (markets: RawMarket[]): MarketSignal[] => {
  const filtered = markets.filter(
    (m) => (m.liquidity ?? 0) >= env.minLiquidity && (m.volume24hr ?? 0) >= env.minVolume24h
  );

  const baselineVolume =
    filtered.reduce((acc, m) => acc + (m.volume24hr ?? 0), 0) / Math.max(filtered.length, 1);

  const out: MarketSignal[] = [];

  for (const m of filtered) {
    const prices = parsePrices(m);
    const top = prices.length ? Math.max(...prices) * 100 : 0;
    const second = prices.length > 1 ? [...prices].sort((a, b) => b - a)[1] * 100 : 0;
    const swing = top - second;

    if (swing >= env.minOddsSwing) {
      const score = Math.min(100, Math.round(swing * 4));
      out.push({
        key: `odds:${m.id}:${Math.round(top)}`,
        type: "ODDS_SWING",
        title: `Odds Swing: ${m.question}`,
        body: `Top outcome spread is ${swing.toFixed(1)} pts (lead ${top.toFixed(1)}%).`,
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
        body: `24h volume is ${multiple.toFixed(1)}x baseline (${Math.round(m.volume24hr ?? 0)}).`,
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
        body: `High traction with strong liquidity support.`,
        confidence: confidenceFromScore(score),
        score,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, env.topSignals);
};

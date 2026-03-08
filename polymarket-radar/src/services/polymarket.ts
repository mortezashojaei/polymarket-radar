import { env } from "../config/env.js";
import type { RawMarket } from "../types/polymarket.js";

const asNumber = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeMarket = (m: any): RawMarket => ({
  id: String(m.id ?? m.slug ?? m.question ?? crypto.randomUUID()),
  question: String(m.question ?? m.title ?? "Unknown market"),
  liquidity: asNumber(m.liquidity, 0),
  volume24hr: asNumber(m.volume24hr ?? m.volume_24hr ?? m.oneDayVolume, 0),
  volume: asNumber(m.volume, 0),
  outcomes: m.outcomes,
  outcomePrices: m.outcomePrices,
});

export const fetchPoliticalMarkets = async (): Promise<RawMarket[]> => {
  const res = await fetch(env.polymarketEventsUrl, {
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Polymarket fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const events = Array.isArray(data) ? data : [];

  const markets: RawMarket[] = [];
  for (const e of events) {
    const category = String(e.category ?? e.tags?.[0] ?? "").toLowerCase();
    if (!category.includes("politic")) continue;

    if (Array.isArray(e.markets)) {
      for (const m of e.markets) markets.push(normalizeMarket(m));
    }
  }

  return markets;
};

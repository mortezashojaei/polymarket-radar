import { env } from "../config/env.js";
import type { RawMarket } from "../types/polymarket.js";

const asNumber = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeMarket = (m: any, eventSlug?: string): RawMarket => ({
  id: String(m.id ?? m.slug ?? m.question ?? crypto.randomUUID()),
  slug: m.slug ? String(m.slug) : undefined,
  eventSlug,
  conditionId: m.conditionId ? String(m.conditionId) : undefined,
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

  const isPoliticalEvent = (e: any): boolean => {
    const flat = [e.category, e.subCategory, e.ticker, e.slug, e.title]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const tagText = Array.isArray(e.tags)
      ? e.tags
          .map((t: any) => `${t?.slug ?? ""} ${t?.label ?? ""}`.toLowerCase())
          .join(" ")
      : "";

    const hay = `${flat} ${tagText}`;
    return (
      hay.includes("politic") ||
      hay.includes("election") ||
      hay.includes("geopolit") ||
      hay.includes("government") ||
      hay.includes("president") ||
      hay.includes("senate")
    );
  };

  const markets: RawMarket[] = [];
  for (const e of events) {
    if (!isPoliticalEvent(e)) continue;
    if (Array.isArray(e.markets)) {
      for (const m of e.markets) markets.push(normalizeMarket(m, e.slug ? String(e.slug) : undefined));
    }
  }

  return markets;
};

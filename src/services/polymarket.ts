import { env } from "../config/env.js";
import type { RawMarket } from "../types/polymarket.js";

const DEFAULT_PAGE_SIZE = 500;
const MAX_TOTAL_EVENTS = 10_000;

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

const buildPagedUrl = (base: string, limit: number, offset: number): string => {
  const url = new URL(base);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return url.toString();
};

const resolvePageSize = (base: string): number => {
  const parsed = new URL(base);
  const raw = Number(parsed.searchParams.get("limit"));
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, DEFAULT_PAGE_SIZE);
  return DEFAULT_PAGE_SIZE;
};

export const fetchAllMarkets = async (): Promise<RawMarket[]> => {
  const pageSize = resolvePageSize(env.polymarketEventsUrl);
  let offset = 0;
  let fetchedEvents = 0;

  const markets: RawMarket[] = [];

  while (fetchedEvents < MAX_TOTAL_EVENTS) {
    const url = buildPagedUrl(env.polymarketEventsUrl, pageSize, offset);
    const res = await fetch(url, {
      headers: { accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Polymarket fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const events = Array.isArray(data) ? data : [];

    for (const e of events) {
      if (Array.isArray(e.markets)) {
        for (const m of e.markets) markets.push(normalizeMarket(m, e.slug ? String(e.slug) : undefined));
      }
    }

    fetchedEvents += events.length;

    if (events.length < pageSize) break;
    offset += pageSize;
  }

  return markets;
};

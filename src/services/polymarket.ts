import { env } from "../config/env.js";
import type { RawMarket } from "../types/polymarket.js";

const DEFAULT_PAGE_SIZE = 500;
const MAX_TOTAL_EVENTS = 10_000;

const asNumber = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
};

const categoryEmoji = (tags: string[]): { category?: string; categoryEmoji?: string } => {
  const t = tags.map((x) => x.toLowerCase());

  if (t.some((x) => ["politics", "geopolitics", "world"].includes(x))) return { category: "Politics", categoryEmoji: "🗳️" };
  if (t.some((x) => ["crypto", "bitcoin", "ethereum", "finance", "economy", "business"].includes(x))) return { category: "Crypto/Finance", categoryEmoji: "💰" };
  if (t.some((x) => ["sports", "nba", "nfl", "nhl", "mlb", "soccer", "football", "tennis", "esports"].includes(x))) return { category: "Sports", categoryEmoji: "🏅" };
  if (t.some((x) => ["tech", "ai", "openai", "google", "apple", "meta"].includes(x))) return { category: "Tech", categoryEmoji: "🤖" };
  if (t.some((x) => ["culture", "music", "movie", "oscars", "entertainment", "celebrity"].includes(x))) return { category: "Culture", categoryEmoji: "🎭" };

  return { category: tags[0], categoryEmoji: "🧩" };
};

const normalizeMarket = (m: any, eventSlug?: string, eventTags: string[] = []): RawMarket => {
  const cat = categoryEmoji(eventTags);
  return {
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
    category: cat.category,
    categoryEmoji: cat.categoryEmoji,
  };
};

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
      const eventTags = Array.isArray(e.tags)
        ? e.tags.map((t: any) => String(t?.label ?? t?.slug ?? t?.name ?? "")).filter(Boolean)
        : [];
      if (Array.isArray(e.markets)) {
        for (const m of e.markets) {
          markets.push(normalizeMarket(m, e.slug ? String(e.slug) : undefined, eventTags));
        }
      }
    }

    fetchedEvents += events.length;

    if (events.length < pageSize) break;
    offset += pageSize;
  }

  return markets;
};

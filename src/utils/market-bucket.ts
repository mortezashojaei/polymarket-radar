import type { RawMarket } from "../types/polymarket.js";

export type MarketBucket =
  | "sports"
  | "politics"
  | "crypto"
  | "macro"
  | "tech"
  | "entertainment"
  | "other";

export type ThresholdProfile = "noisy" | "sensitive" | "default";

const WORDS: Record<MarketBucket, string[]> = {
  sports: [
    "sports",
    "nba",
    "nfl",
    "nhl",
    "mlb",
    "soccer",
    "football",
    "tennis",
    "golf",
    "mma",
    "boxing",
    "esports",
    "ufc",
    "champions league",
    "march madness",
    "wildcards",
    "vs.",
    "vs ",
    " fc ",
    "spread:",
    "moneyline",
    "o/u",
    "over/under",
  ],
  politics: [
    "election",
    "president",
    "senate",
    "congress",
    "parliament",
    "government",
    "ceasefire",
    "war",
    "democratic",
    "republican",
    "prime minister",
    "policy",
    "geopolit",
    "iran",
    "iranian",
    "russia",
    "ukraine",
    "israel",
    "gaza",
    "china",
    "taiwan",
    "us x",
    "united states",
  ],
  crypto: ["bitcoin", "btc", "ethereum", "eth", "solana", "crypto", "token", "defi", "airdrop"],
  macro: ["fed", "interest rate", "cpi", "inflation", "gdp", "recession", "unemployment", "treasury"],
  tech: ["ai", "openai", "nvidia", "apple", "google", "meta", "microsoft", "tesla"],
  entertainment: ["oscar", "grammy", "emmy", "movie", "box office", "celebrity", "tv show"],
  other: [],
};

const PRIORITY: MarketBucket[] = ["sports", "politics", "macro", "crypto", "tech", "entertainment"];

const hasAny = (s: string, words: string[]): boolean => words.some((w) => s.includes(w));

const bucketFromCategory = (category?: string): MarketBucket | null => {
  const c = (category ?? "").toLowerCase();
  if (!c) return null;
  if (c.includes("sport")) return "sports";
  if (c.includes("politic") || c.includes("world") || c.includes("news")) return "politics";
  if (c.includes("crypto")) return "crypto";
  if (c.includes("macro") || c.includes("econom")) return "macro";
  if (c.includes("tech")) return "tech";
  if (c.includes("entertain")) return "entertainment";
  return null;
};

export const getMarketBucket = (m: Pick<RawMarket, "question" | "category">): MarketBucket => {
  const direct = bucketFromCategory(m.category);
  if (direct) return direct;

  const text = `${m.category ?? ""} ${m.question ?? ""}`.toLowerCase();
  for (const b of PRIORITY) {
    if (hasAny(text, WORDS[b])) return b;
  }
  return "other";
};

export const bucketLabel = (b: MarketBucket): string => {
  switch (b) {
    case "sports":
      return "Sports";
    case "politics":
      return "Politics";
    case "crypto":
      return "Crypto";
    case "macro":
      return "Macro";
    case "tech":
      return "Tech";
    case "entertainment":
      return "Entertainment";
    default:
      return "Other";
  }
};

export const thresholdProfileForBucket = (b: MarketBucket): ThresholdProfile => {
  if (b === "sports") return "noisy";
  if (b === "politics" || b === "macro") return "sensitive";
  return "default";
};

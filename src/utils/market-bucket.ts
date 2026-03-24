import type { RawMarket } from "../types/polymarket.js";

export type MarketBucket = "politics" | "noisy" | "default";

const NOISY_CATEGORY_WORDS = [
  "sports",
  "sport",
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
  "march madness",
  "champions league",
];

const POLITICS_WORDS = [
  "politic",
  "election",
  "president",
  "senate",
  "congress",
  "parliament",
  "government",
  "ceasefire",
  "war",
  "iran",
  "trump",
  "biden",
  "democratic",
  "republican",
  "fed",
  "interest rate",
  "cpi",
  "inflation",
  "gdp",
];

const hasAny = (s: string, words: string[]): boolean => words.some((w) => s.includes(w));

export const getMarketBucket = (m: Pick<RawMarket, "question" | "category">): MarketBucket => {
  const text = `${m.category ?? ""} ${m.question ?? ""}`.toLowerCase();

  if (hasAny(text, POLITICS_WORDS)) return "politics";
  if (hasAny(text, NOISY_CATEGORY_WORDS)) return "noisy";
  return "default";
};

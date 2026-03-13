export interface RawMarket {
  id: string;
  slug?: string;
  eventSlug?: string;
  conditionId?: string;
  question: string;
  liquidity?: number;
  volume24hr?: number;
  volume?: number;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
  category?: string;
  categoryEmoji?: string;
}

export type SignalType =
  | "PRICE_MOVE"
  | "FLOW_MOVE"
  | "BREAKOUT"
  | "WHALE_WATCH"
  | "MERGED_SIGNAL";

export type SignalTier = "A" | "B" | "C";

export interface MarketSignal {
  key: string;
  marketId: string;
  outcome: string;
  type: SignalType;
  title: string;
  body: string;
  confidence: "Low" | "Med" | "High";
  score: number;
  tier: SignalTier;
  reasons: string[];
  createdAt: number;
}

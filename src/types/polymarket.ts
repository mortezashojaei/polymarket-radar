export interface RawMarket {
  id: string;
  slug?: string;
  question: string;
  liquidity?: number;
  volume24hr?: number;
  volume?: number;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
}

export interface MarketSignal {
  key: string;
  type: "PRICE_MOVE" | "VOLUME_SPIKE" | "BREAKOUT" | "TRENDING";
  title: string;
  body: string;
  confidence: "Low" | "Med" | "High";
  score: number;
}

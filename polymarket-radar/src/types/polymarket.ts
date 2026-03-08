export interface RawMarket {
  id: string;
  question: string;
  liquidity?: number;
  volume24hr?: number;
  volume?: number;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
}

export interface MarketSignal {
  key: string;
  type: "ODDS_SWING" | "VOLUME_SPIKE" | "TRENDING";
  title: string;
  body: string;
  confidence: "Low" | "Med" | "High";
  score: number;
}

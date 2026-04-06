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
  | "CONVICTION_SPIKE"
  | "REGIME_SHIFT"
  | "CONSENSUS_CRACK"
  | "COORDINATED_WHALE_FLOW"
  | "MERGED_SIGNAL";

export type SignalTier = "A" | "B" | "C";
export type PredictiveConfidence = "Low" | "Med" | "High";

export interface SignalEvidence {
  fromProb: number;
  toProb: number;
  deltaPts: number;
  velocityPtsPerHour: number;
  persistenceScore: number;
  netFlow: number;
  tradeCount: number;
  whaleCount: number;
  liquidity: number;
  spreadBps: number;
}

export interface MarketSignal {
  key: string;
  marketId: string;
  outcome: string;
  type: SignalType;
  title: string;
  body: string;
  confidence: PredictiveConfidence;
  score: number;
  tier: SignalTier;
  reasons: string[];
  createdAt: number;
  link: string;
  category: string;
  invalidation: string;
  whyItMatters: string;
  evidence: SignalEvidence;
}

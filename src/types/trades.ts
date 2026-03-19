export interface TradeFlowSummary {
  conditionId: string;
  outcome: string;
  side: "BUY" | "SELL";
  netNotional: number;
  grossNotional: number;
}

export interface WhaleTrade {
  conditionId: string;
  outcome: string;
  side: "BUY" | "SELL";
  notional: number;
  price: number;
  size: number;
  timestamp: number;
}

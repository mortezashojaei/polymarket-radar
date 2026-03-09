export interface TradeFlowSummary {
  conditionId: string;
  outcome: string;
  side: "BUY" | "SELL";
  netNotional: number;
  grossNotional: number;
}

import type { TradeFlowSummary } from "../types/trades.js";

type Trade = {
  conditionId?: string;
  outcome?: string;
  side?: "BUY" | "SELL";
  size?: number;
  price?: number;
  timestamp?: number;
};

export const fetchRecentTradeFlow = async (
  windowSeconds = 3600,
  limit = 2000
): Promise<Map<string, TradeFlowSummary>> => {
  const now = Math.floor(Date.now() / 1000);
  const minTs = now - windowSeconds;
  const url = `https://data-api.polymarket.com/trades?limit=${limit}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`trade flow fetch failed: ${res.status}`);

  const rows = (await res.json()) as Trade[];
  const agg = new Map<string, { buy: number; sell: number; gross: number; outcome: string }>();

  for (const t of rows) {
    if (!t.conditionId || !t.outcome || !t.side || !t.timestamp) continue;
    if (t.timestamp < minTs) continue;

    const notional = Math.max(0, Number(t.size ?? 0) * Number(t.price ?? 0));
    const key = `${t.conditionId}::${t.outcome}`;
    const a = agg.get(key) ?? { buy: 0, sell: 0, gross: 0, outcome: t.outcome };
    if (t.side === "BUY") a.buy += notional;
    else a.sell += notional;
    a.gross += notional;
    agg.set(key, a);
  }

  const byCondition = new Map<string, TradeFlowSummary>();
  for (const [key, a] of agg.entries()) {
    const [conditionId, outcome] = key.split("::");
    const net = a.buy - a.sell;
    const current: TradeFlowSummary = {
      conditionId,
      outcome: outcome || a.outcome,
      side: net >= 0 ? "BUY" : "SELL",
      netNotional: Math.abs(net),
      grossNotional: a.gross,
    };

    const prev = byCondition.get(conditionId);
    if (!prev || current.netNotional > prev.netNotional) byCondition.set(conditionId, current);
  }

  return byCondition;
};

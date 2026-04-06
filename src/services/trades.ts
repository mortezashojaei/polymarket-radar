import type { TradeFlowSummary, WhaleTrade } from "../types/trades.js";

type Trade = {
  conditionId?: string;
  outcome?: string;
  side?: "BUY" | "SELL";
  size?: number;
  price?: number;
  timestamp?: number;
  makerAddress?: string;
  takerAddress?: string;
  owner?: string;
};

const TRADE_API_URL = "https://data-api.polymarket.com/trades";
const MAX_PAGE_SIZE = 1000;
const MAX_OFFSET = 3000;

const fetchTradesPage = async (limit: number, offset: number): Promise<Trade[]> => {
  const url = `${TRADE_API_URL}?limit=${limit}&offset=${offset}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`trade flow fetch failed: ${res.status}`);

  const data = await res.json();
  return Array.isArray(data) ? (data as Trade[]) : [];
};

export const fetchRecentTradeFlow = async (
  windowSeconds = 3600,
  limit = 2000
): Promise<Map<string, TradeFlowSummary>> => {
  const now = Math.floor(Date.now() / 1000);
  const minTs = now - windowSeconds;
  const targetRows = Math.max(1, Math.floor(limit));

  const agg = new Map<string, { buy: number; sell: number; gross: number; outcome: string; tradeCount: number; wallets: Set<string>; whaleCount: number }>();

  let offset = 0;
  let collected = 0;

  while (collected < targetRows && offset <= MAX_OFFSET) {
    const pageSize = Math.min(MAX_PAGE_SIZE, targetRows - collected);
    const rows = await fetchTradesPage(pageSize, offset);

    if (rows.length === 0) break;

    for (const t of rows) {
      if (!t.conditionId || !t.outcome || !t.side || !t.timestamp) continue;
      if (t.timestamp < minTs) continue;

      const notional = Math.max(0, Number(t.size ?? 0) * Number(t.price ?? 0));
      const key = `${t.conditionId}::${t.outcome}`;
      const a = agg.get(key) ?? { buy: 0, sell: 0, gross: 0, outcome: t.outcome, tradeCount: 0, wallets: new Set<string>(), whaleCount: 0 };
      if (t.side === "BUY") a.buy += notional;
      else a.sell += notional;
      a.gross += notional;
      a.tradeCount += 1;
      const maker = typeof t.makerAddress === "string" ? t.makerAddress : "";
      const taker = typeof t.takerAddress === "string" ? t.takerAddress : "";
      const owner = typeof t.owner === "string" ? t.owner : "";
      for (const w of [maker, taker, owner]) {
        if (w) a.wallets.add(w);
      }
      if (notional >= 10_000) a.whaleCount += 1;
      agg.set(key, a);
    }

    collected += rows.length;

    const oldestTs = rows[rows.length - 1]?.timestamp ?? 0;
    if (rows.length < pageSize || oldestTs < minTs) break;

    offset += rows.length;
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
      tradeCount: a.tradeCount,
      walletDiversity: a.wallets.size,
      whaleCount: a.whaleCount,
    };

    const prev = byCondition.get(conditionId);
    if (!prev || current.netNotional > prev.netNotional) byCondition.set(conditionId, current);
  }

  return byCondition;
};

export const fetchRecentWhaleTrades = async (
  minNotional: number,
  windowSeconds = 600,
  limit = 3000
): Promise<WhaleTrade[]> => {
  const now = Math.floor(Date.now() / 1000);
  const minTs = now - windowSeconds;
  const targetRows = Math.max(1, Math.floor(limit));

  const out: WhaleTrade[] = [];
  let offset = 0;
  let collected = 0;

  while (collected < targetRows && offset <= MAX_OFFSET) {
    const pageSize = Math.min(MAX_PAGE_SIZE, targetRows - collected);
    const rows = await fetchTradesPage(pageSize, offset);
    if (rows.length === 0) break;

    for (const t of rows) {
      if (!t.conditionId || !t.outcome || !t.side || !t.timestamp) continue;
      if (t.timestamp < minTs) continue;

      const size = Number(t.size ?? 0);
      const price = Number(t.price ?? 0);
      const notional = Math.max(0, size * price);
      if (notional < minNotional) continue;

      out.push({
        conditionId: t.conditionId,
        outcome: t.outcome,
        side: t.side,
        size,
        price,
        notional,
        timestamp: t.timestamp,
      });
    }

    collected += rows.length;

    const oldestTs = rows[rows.length - 1]?.timestamp ?? 0;
    if (rows.length < pageSize || oldestTs < minTs) break;

    offset += rows.length;
  }

  out.sort((a, b) => b.notional - a.notional || b.timestamp - a.timestamp);
  return out;
};

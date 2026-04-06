import type { MarketSignal } from "../types/polymarket.js";

const esc = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escAttr = (s: string): string => esc(s).replaceAll('"', "&quot;");

const typeEmoji = (t: MarketSignal["type"]): string => {
  switch (t) {
    case "CONVICTION_SPIKE":
      return "🚨";
    case "REGIME_SHIFT":
      return "🔄";
    case "CONSENSUS_CRACK":
      return "🧱";
    case "COORDINATED_WHALE_FLOW":
      return "🐋";
    default:
      return "📡";
  }
};

export const renderBroadcasts = (signals: MarketSignal[]): string => {
  if (!signals.length) return "Prediction Pulse\n\nNo qualifying broadcasts right now.";

  const lines = signals.map((s) => {
    const move = `${s.outcome.toUpperCase()} ${s.evidence.fromProb.toFixed(1)}% → ${s.evidence.toProb.toFixed(1)}% (${s.evidence.deltaPts >= 0 ? "+" : ""}${s.evidence.deltaPts.toFixed(1)}%)`;

    return [
      `${typeEmoji(s.type)} <b>${esc(s.title)}</b>`,
      `• Move: ${esc(move)}`,
      `• Money evidence: Net flow <b>$${Math.round(s.evidence.netFlow).toLocaleString()}</b> | Trades <b>${s.evidence.tradeCount}</b> | Whale count <b>${s.evidence.whaleCount}</b>`,
      `• Microstructure: Liquidity <b>$${Math.round(s.evidence.liquidity).toLocaleString()}</b> | Spread <b>${Math.round(s.evidence.spreadBps)} bps</b>`,
      `• Predictive confidence: <b>${s.confidence}</b>`,
      `• Why it matters: ${esc(s.whyItMatters)}`,
      `• Invalidation: ${esc(s.invalidation)}`,
      `• 🔗 <a href="${escAttr(s.link)}">Go to market</a>`,
      "",
    ].join("\n");
  });

  return ["Prediction Pulse", "", ...lines].join("\n");
};

interface DailyShift {
  question: string;
  category: string;
  fromProb: number;
  toProb: number;
  delta: number;
}

export const renderDailyRecap = (args: {
  increases: DailyShift[];
  collapses: DailyShift[];
  themes: Array<{ category: string; count: number }>;
  followThrough: { held: number; faded: number };
  recapDateLabel: string;
}): string => {
  const fmtShift = (s: DailyShift) =>
    `• ${esc(s.question)} — ${s.fromProb.toFixed(1)}% → ${s.toProb.toFixed(1)}% (${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(1)}%)`;

  const incLines = args.increases.length ? args.increases.map(fmtShift) : ["• No major increases captured."];
  const decLines = args.collapses.length ? args.collapses.map(fmtShift) : ["• No major collapses captured."];
  const themeLines = args.themes.length
    ? args.themes.map((t) => `• ${esc(t.category)}: ${t.count} significant shift(s)`)
    : ["• No strong category cluster today."];

  const totalCalls = args.followThrough.held + args.followThrough.faded;
  const follow = totalCalls
    ? `• Followed-through: ${args.followThrough.held} | Faded: ${args.followThrough.faded}`
    : "• No prior calls to evaluate yet.";

  return [
    `Daily Prediction Shift — ${esc(args.recapDateLabel)}`,
    "",
    "1) Biggest expectation increases",
    ...incLines,
    "",
    "2) Biggest expectation collapses",
    ...decLines,
    "",
    "3) Emerging themes by category",
    ...themeLines,
    "",
    "4) Yesterday's calls: followed-through vs faded",
    follow,
  ].join("\n");
};

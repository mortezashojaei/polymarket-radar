import type { MarketSignal } from "../types/polymarket.js";

export const renderDigest = (signals: MarketSignal[]): string => {
  if (!signals.length) {
    return "📡 Polymarket Radar (Politics)\n\nNo high-quality signals this hour.";
  }

  const lines = signals.map((s, i) => {
    const [what = s.body, why = ""] = s.body.split(" | ");
    return [
      `${i + 1}) ${s.title}`,
      `   - ${what}`,
      `   - ${why}`,
      `   - Confidence: ${s.confidence}`,
    ].join("\n");
  });

  return [
    "📡 Polymarket Radar (Politics)",
    "",
    ...lines,
    "",
    "Read-only signals. Do your own research.",
  ].join("\n");
};

import type { MarketSignal } from "../types/polymarket.js";

const confEmoji = (c: MarketSignal["confidence"]) => {
  if (c === "High") return "🟢";
  if (c === "Med") return "🟡";
  return "⚪️";
};

export const renderDigest = (signals: MarketSignal[]): string => {
  if (!signals.length) {
    return [
      "📡 Polymarket Radar — Politics",
      "",
      "Quiet hour. No strong signals right now.",
      "",
      "We’ll post when activity picks up.",
    ].join("\n");
  }

  const lines = signals.map((s, i) => {
    if (s.type === "WHALE_WATCH") {
      const parts = s.body.split(" | ");
      return [
        `${i + 1}) ${s.title}`,
        ...parts.map((p) => `   ${p}`),
        `   ${confEmoji(s.confidence)} Confidence: ${s.confidence}`,
        "",
      ].join("\n");
    }

    const [what = s.body, why = "", link = ""] = s.body.split(" | ");
    const cleanWhat = what.replace(/^What happened:\s*/i, "");
    const cleanWhy = why.replace(/^Why flagged:\s*/i, "");
    const cleanLink = link.replace(/^Link:\s*/i, "");

    return [
      `${i + 1}) ${s.title}`,
      `   ${cleanWhat}`,
      `   Trigger: ${cleanWhy}`,
      `   🔗 ${cleanLink}`,
      `   ${confEmoji(s.confidence)} Confidence: ${s.confidence}`,
      "",
    ].join("\n");
  });

  return [
    "📡 Polymarket Radar — Politics",
    "Top signals this hour:",
    "",
    ...lines,
    "DYOR. Not financial advice.",
  ].join("\n");
};

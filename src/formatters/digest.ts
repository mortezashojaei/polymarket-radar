import type { MarketSignal } from "../types/polymarket.js";

const confEmoji = (c: MarketSignal["confidence"]) => {
  if (c === "High") return "🟢";
  if (c === "Med") return "🟡";
  return "⚪️";
};

const esc = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escAttr = (s: string): string => esc(s).replaceAll('"', "&quot;");

export const renderDigest = (signals: MarketSignal[]): string => {
  if (!signals.length) {
    return ["Politics signals", "", "No strong signals this hour."].join("\n");
  }

  const lines = signals.map((s, i) => {
    if (s.type === "WHALE_WATCH") {
      const parts = s.body.split(" | ");
      const market = esc((parts.find((p) => p.startsWith("📍 Market:")) ?? "").replace("📍 Market: ", ""));
      const move = esc((parts.find((p) => p.startsWith("🐋 Whale move:")) ?? "").replace("🐋 Whale move: ", ""));
      const reaction = esc(
        (parts.find((p) => p.startsWith("📈 Price reaction:")) ?? "").replace("📈 Price reaction: ", "")
      );
      const read = esc((parts.find((p) => p.startsWith("🧠 Read:")) ?? "").replace("🧠 Read: ", ""));
      const link = (parts.find((p) => p.startsWith("🔗 Bet link:")) ?? "").replace("🔗 Bet link: ", "");

      return [
        `${i + 1})`,
        `📍 <b>Market: <i>${market}</i></b>`,
        `🐋 Whale move: <b>${move}</b>`,
        `📈 Price reaction: <b>${reaction}</b>`,
        `🧠 Read: ${read}`,
        `🔗 <a href="${escAttr(link)}">Go to market</a>`,
        `${confEmoji(s.confidence)} Confidence: ${s.confidence}`,
        "",
      ].join("\n");
    }

    const [what = s.body, _why = "", linkPart = ""] = s.body.split(" | ");
    const cleanWhat = esc(what.replace(/^What happened:\s*/i, ""));
    const cleanLink = linkPart.replace(/^Link:\s*/i, "");

    return [
      `${i + 1}) ${esc(s.title)}`,
      `${cleanWhat}`,
      `🔗 <a href="${escAttr(cleanLink)}">Go to market</a>`,
      `${confEmoji(s.confidence)} Confidence: ${s.confidence}`,
      "",
    ].join("\n");
  });

  return ["Politics signals", "", ...lines].join("\n");
};

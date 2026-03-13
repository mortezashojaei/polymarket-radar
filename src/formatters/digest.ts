import type { MarketSignal } from "../types/polymarket.js";

const confEmoji = (c: MarketSignal["confidence"]) => {
  if (c === "High") return "🟢";
  if (c === "Med") return "🟡";
  return "⚪️";
};

const tierEmoji = (t: MarketSignal["tier"]) => {
  if (t === "A") return "🔥";
  if (t === "B") return "👀";
  return "▫️";
};

const esc = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escAttr = (s: string): string => esc(s).replaceAll('"', "&quot;");

const reasonLabel = (code: string): string => {
  switch (code.trim()) {
    case "LARGE_REPRICE":
      return "Sharp repricing";
    case "FLOW_SPIKE":
      return "Unusual flow surge";
    case "WHALE_SIZE":
      return "Whale-sized orders";
    case "FLIP_RISK":
      return "Choppy regime (recent reversals)";
    case "THIN_LIQUIDITY":
      return "Thin liquidity (higher whipsaw risk)";
    case "MOMENTUM":
      return "Momentum continuation";
    default:
      return code
        .toLowerCase()
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
};

const reasonPriority = ["LARGE_REPRICE", "FLOW_SPIKE", "WHALE_SIZE", "FLIP_RISK", "THIN_LIQUIDITY", "MOMENTUM"];

const humanizeRead = (read: string): string => {
  const raw = read
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!raw.length) return "Momentum continuation";

  const sorted = raw.sort((a, b) => {
    const ai = reasonPriority.indexOf(a);
    const bi = reasonPriority.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return sorted
    .slice(0, 3)
    .map(reasonLabel)
    .join(", ");
};

export const renderDigest = (signals: MarketSignal[]): string => {
  if (!signals.length) {
    return ["Polymarket signals", "", "No strong signals this hour."].join("\n");
  }

  const lines = signals.map((s) => {
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
        `📍 <b>Market: <i>${market}</i></b>`,
        `🐋 Whale move: <b>${move}</b>`,
        `📈 Price reaction: <b>${reaction}</b>`,
        `🧠 Read: ${read}`,
        `🔗 <a href="${escAttr(link)}">Go to market</a>`,
        `${confEmoji(s.confidence)} Confidence: ${s.confidence}`,
        "",
      ].join("\n");
    }

    const parts = s.body.split(" | ");
    const summary = esc(parts[0] ?? s.body);
    const score = esc((parts.find((p) => p.startsWith("Score:")) ?? "").replace("Score: ", ""));
    const readRaw = (parts.find((p) => p.startsWith("Read:")) ?? "").replace("Read: ", "");
    const read = esc(humanizeRead(readRaw));
    const link = (parts.find((p) => p.startsWith("Link:")) ?? "").replace("Link: ", "");

    return [
      `${tierEmoji(s.tier)} <b>${esc(s.title)}</b>`,
      `${summary}`,
      score ? `🧮 ${score}` : "",
      read ? `🧠 Why: ${read}` : "",
      `🔗 <a href="${escAttr(link)}">Go to market</a>`,
      `${confEmoji(s.confidence)} Confidence: ${s.confidence}`,
      "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return ["Polymarket signals", "", ...lines].join("\n");
};

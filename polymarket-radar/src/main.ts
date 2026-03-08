import { env } from "./config/env.js";
import { hasSeen, markSeen, saveRun } from "./db/sqlite.js";
import { detectSignals } from "./detectors/signals.js";
import { renderDigest } from "./formatters/digest.js";
import { fetchPoliticalMarkets } from "./services/polymarket.js";
import { sendTelegramMessage } from "./services/telegram.js";

const runOnce = async () => {
  const markets = await fetchPoliticalMarkets();
  const signals = detectSignals(markets).filter((s) => !hasSeen(s.key));

  for (const s of signals) markSeen(s.key);

  const text = renderDigest(signals);
  await sendTelegramMessage(text);
  saveRun(signals.length, `markets=${markets.length}`);

  console.log(`[radar] posted ${signals.length} signals from ${markets.length} markets`);
};

const start = async () => {
  await runOnce();
  const ms = env.runEveryMinutes * 60 * 1000;
  setInterval(() => {
    runOnce().catch((e) => {
      console.error("[radar] run failed", e);
      saveRun(0, `error=${String(e)}`);
    });
  }, ms);
};

start().catch((e) => {
  console.error("startup failed", e);
  process.exit(1);
});

import { env } from "./config/env.js";
import {
  clearSentMessages,
  hasSeen,
  listSentMessageIds,
  markSeen,
  saveRun,
  saveSentMessage,
} from "./db/sqlite.js";
import { detectSignals } from "./detectors/signals.js";
import { renderDigest } from "./formatters/digest.js";
import { fetchPoliticalMarkets } from "./services/polymarket.js";
import { deleteTelegramMessage, sendTelegramMessage } from "./services/telegram.js";

const clearChannelOnStart = async () => {
  if (!env.clearOnStart) return;

  const ids = listSentMessageIds(env.clearOnStartLimit);
  if (!ids.length) {
    console.log("[radar] clear_on_start enabled but no tracked messages found");
    return;
  }

  let deleted = 0;
  for (const id of ids) {
    try {
      await deleteTelegramMessage(id);
      deleted += 1;
    } catch {
      // best effort (older msgs may fail by API limits/permissions)
    }
  }

  clearSentMessages();
  console.log(`[radar] clear_on_start deleted ${deleted}/${ids.length} tracked messages`);
};

const runOnce = async () => {
  const markets = await fetchPoliticalMarkets();
  const signals = detectSignals(markets).filter((s) => !hasSeen(s.key));

  for (const s of signals) markSeen(s.key);

  const text = renderDigest(signals);
  const messageId = await sendTelegramMessage(text);
  if (messageId) saveSentMessage(messageId);

  saveRun(signals.length, `markets=${markets.length}`);

  console.log(`[radar] posted ${signals.length} signals from ${markets.length} markets`);
};

const start = async () => {
  await clearChannelOnStart();
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

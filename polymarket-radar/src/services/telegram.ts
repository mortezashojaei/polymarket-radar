import { env } from "../config/env.js";

export const sendTelegramMessage = async (text: string): Promise<void> => {
  const url = `https://api.telegram.org/bot${env.telegramToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.telegramChannelId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${body}`);
  }
};

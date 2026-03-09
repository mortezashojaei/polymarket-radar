import { env } from "../config/env.js";

export const sendTelegramMessage = async (text: string): Promise<number> => {
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

  const body = (await res.json()) as { ok: boolean; result?: { message_id?: number } };
  return body.result?.message_id ?? 0;
};

export const deleteTelegramMessage = async (messageId: number): Promise<void> => {
  const url = `https://api.telegram.org/bot${env.telegramToken}/deleteMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.telegramChannelId,
      message_id: messageId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram delete failed: ${res.status} ${body}`);
  }
}

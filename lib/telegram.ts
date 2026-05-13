import { saveTelegramMessageLink } from "@/lib/chat-store";

type TelegramNotificationParams = {
  kind: "message" | "handover";
  conversationId: string | null;
  userMessage: string;
  intent: string;
  confidence: string;
  handover: boolean;
  userInfo?: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
  };
};

function escapeTelegramText(text: string): string {
  return text.replace(/[&<>]/g, (char) => {
    if (char === "&") {
      return "&amp;";
    }

    if (char === "<") {
      return "&lt;";
    }

    return "&gt;";
  });
}

function buildTelegramMessage(params: TelegramNotificationParams): string {
  return [
    "📩 มีลูกค้าเริ่มแชทกับ Payso Assistant",
    "",
    `👤 ชื่อ: ${escapeTelegramText(params.userInfo?.name?.trim() || "-")}`,
    `📞 เบอร์: ${escapeTelegramText(params.userInfo?.phone?.trim() || "-")}`,
    `✉️ อีเมล: ${escapeTelegramText(params.userInfo?.email?.trim() || "-")}`,
    `🏢 บริษัท: ${escapeTelegramText(params.userInfo?.company?.trim() || "-")}`,
    "",
    "💬 คำถามล่าสุด:",
    escapeTelegramText(params.userMessage),
    "",
    `🎯 Intent: ${escapeTelegramText(params.intent)}`,
  ].join("\n");
}

export async function sendTelegramNotification(
  params: TelegramNotificationParams,
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return;
  }

  try {
    const replyMarkup =
      params.conversationId && !params.handover
        ? {
            inline_keyboard: [
              [
                {
                  text: "รับแชทโดยแอดมิน",
                  callback_data: `takeover:${params.conversationId}`,
                },
              ],
            ],
          }
        : undefined;

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildTelegramMessage(params),
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }),
    });

    if (!response.ok || !params.conversationId) {
      return;
    }

    const payload = (await response.json()) as {
      result?: {
        chat?: { id?: number };
        message_id?: number;
      };
    };

    const telegramChatId = payload.result?.chat?.id;
    const telegramMessageId = payload.result?.message_id;

    if (typeof telegramChatId === "number" && typeof telegramMessageId === "number") {
      await saveTelegramMessageLink({
        conversationId: params.conversationId,
        telegramChatId,
        telegramMessageId,
      });
    }
  } catch {
    // Skip silently to preserve chat behavior.
  }
}

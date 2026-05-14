import { saveTelegramMessageLink } from "@/lib/chat-store";

type TelegramNotificationParams = {
  kind: "message" | "handover";
  conversationId: string | null;
  userMessage: string;
  aiAnswer?: string | null;
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

function stripAnswerSections(text: string): string {
  return text
    .replace(/ดูเพิ่มเติม:[\s\S]*$/u, "")
    .replace(/คำถามที่เกี่ยวข้อง:[\s\S]*$/u, "")
    .replace(/Reference links:[\s\S]*$/iu, "")
    .replace(/Related questions:[\s\S]*$/iu, "")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeText(text: string | null | undefined, fallback: string): string {
  const cleaned = stripAnswerSections(text ?? "");

  if (!cleaned) {
    return fallback;
  }

  const sentences = cleaned
    .split(/(?<=[.!?。！？])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  const summary = sentences || cleaned;

  return summary.length > 260 ? `${summary.slice(0, 257).trim()}...` : summary;
}

function buildConversationSummary(params: TelegramNotificationParams): string {
  const latestQuestion = summarizeText(params.userMessage, "-");
  return summarizeText(
    `ลูกค้าสอบถามเรื่อง ${params.intent}: ${latestQuestion}`,
    "ลูกค้าส่งข้อความล่าสุดเข้ามาในแชท Payso Assistant",
  );
}

function buildTelegramMessage(params: TelegramNotificationParams): string {
  const profileLines = [
    `👤 ชื่อ: ${escapeTelegramText(params.userInfo?.name?.trim() || "-")}`,
    params.userInfo?.phone?.trim()
      ? `📞 เบอร์: ${escapeTelegramText(params.userInfo.phone.trim())}`
      : null,
    params.userInfo?.email?.trim()
      ? `✉️ อีเมล: ${escapeTelegramText(params.userInfo.email.trim())}`
      : null,
    params.userInfo?.company?.trim()
      ? `🏢 บริษัท: ${escapeTelegramText(params.userInfo.company.trim())}`
      : null,
  ].filter((line): line is string => Boolean(line));

  const conversationSummary = buildConversationSummary(params);
  const aiAnswerSummary = summarizeText(params.aiAnswer, "ยังไม่มีคำตอบล่าสุดจาก AI สำหรับข้อความนี้");

  return [
    "📩 มีลูกค้าเริ่มแชทกับ Payso Assistant",
    "",
    ...profileLines,
    "",
    "💬 คำถามล่าสุด:",
    escapeTelegramText(summarizeText(params.userMessage, "-")),
    "",
    `🎯 Intent: ${escapeTelegramText(params.intent)}`,
    "",
    "🧾 สรุปบทสนทนา:",
    escapeTelegramText(conversationSummary),
    "",
    "🤖 AI ตอบไปแล้ว:",
    escapeTelegramText(aiAnswerSummary),
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
      params.conversationId
        ? {
            inline_keyboard: [
              [
                {
                  text: "รับแชทโดยแอดมิน",
                  callback_data: `admin_takeover:${params.conversationId}`,
                },
                {
                  text: "ให้ AI ตอบต่อ",
                  callback_data: `ai_resume:${params.conversationId}`,
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

import { NextResponse } from "next/server";
import {
  findConversationIdByTelegramReply,
  getConversationStatus,
  markConversationAdminTakeover,
  saveChatMessage,
} from "@/lib/chat-store";

type TelegramCallbackQuery = {
  id?: string;
  data?: string;
  message?: {
    chat?: {
      id?: number;
    };
    message_id?: number;
  };
};

type TelegramUpdate = {
  callback_query?: TelegramCallbackQuery;
  message?: {
    chat?: {
      id?: number;
    };
    message_id?: number;
    text?: string;
    reply_to_message?: {
      message_id?: number;
    };
  };
};

async function callTelegramApi(method: string, payload: Record<string, unknown>) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();

  if (!botToken) {
    return;
  }

  await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TelegramUpdate;
    const callbackQuery = body.callback_query;
    const callbackData = callbackQuery?.data?.trim() ?? "";

    if (!callbackQuery?.id || !callbackData.startsWith("takeover:")) {
      return NextResponse.json({ ok: true });
    }

    const conversationId = callbackData.slice("takeover:".length).trim();
    const didMarkTakeover = conversationId
      ? await markConversationAdminTakeover(conversationId)
      : false;

    await callTelegramApi("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: didMarkTakeover
        ? "รับแชทโดยแอดมินเรียบร้อยแล้ว"
        : "ไม่สามารถรับช่วงแชทนี้ได้",
      show_alert: false,
    });

    if (callbackQuery.message?.chat?.id && callbackQuery.message?.message_id) {
      await callTelegramApi("editMessageReplyMarkup", {
        chat_id: callbackQuery.message.chat.id,
        message_id: callbackQuery.message.message_id,
        reply_markup: {
          inline_keyboard: [],
        },
      });
    }

    const incomingMessage = body.message;
    const replyToMessageId = incomingMessage?.reply_to_message?.message_id;
    const telegramChatId = incomingMessage?.chat?.id;
    const adminText = incomingMessage?.text?.trim();

    if (typeof telegramChatId === "number" && typeof replyToMessageId === "number" && adminText) {
      const conversationId = await findConversationIdByTelegramReply({
        telegramChatId,
        telegramMessageId: replyToMessageId,
      });
      const conversationStatus = await getConversationStatus(conversationId);

      if (conversationId && conversationStatus === "handover") {
        await saveChatMessage({
          conversationId,
          role: "admin",
          content: adminText,
          intent: "Admin Reply",
          confidence: "High",
          handover: true,
          sources: [],
          reason: "Reply sent by Telegram admin after takeover.",
        });
      }
    }

    return NextResponse.json({ ok: true, adminTakeover: didMarkTakeover });
  } catch (error) {
    console.error("Telegram callback route failed:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

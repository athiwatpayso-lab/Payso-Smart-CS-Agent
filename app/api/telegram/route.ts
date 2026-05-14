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
    console.log(JSON.stringify(body, null, 2));
    console.log("Telegram webhook received", {
      hasCallbackQuery: Boolean(body.callback_query),
      hasMessage: Boolean(body.message),
    });

    const callbackQuery = body.callback_query;
    const callbackData = callbackQuery?.data?.trim() ?? "";
    let didMarkTakeover = false;
    let didSaveAdminReply = false;

    if (callbackQuery?.id && callbackData.startsWith("takeover:")) {
      const conversationId = callbackData.slice("takeover:".length).trim();
      didMarkTakeover = conversationId
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
    }

    const incomingMessage = body.message;
    const telegramChatId = incomingMessage?.chat?.id;
    const repliedMessageId = incomingMessage?.reply_to_message?.message_id;
    const adminText = incomingMessage?.text?.trim();

    if (typeof telegramChatId === "number" && typeof repliedMessageId === "number" && adminText) {
      const conversationId = await findConversationIdByTelegramReply({
        telegramChatId,
        telegramMessageId: repliedMessageId,
      });

      console.log("Telegram webhook resolved conversation_id", {
        telegramChatId,
        repliedMessageId,
        conversationId,
      });

      if (conversationId) {
        const conversationStatus = await getConversationStatus(conversationId);

        if (conversationStatus !== "handover") {
          await markConversationAdminTakeover(conversationId);
        }

        const messageId = await saveChatMessage({
          conversationId,
          role: "admin",
          content: adminText,
          intent: "Admin Reply",
          confidence: "High",
          handover: true,
          sources: [],
          reason: "Reply sent by Telegram admin after takeover.",
        });

        didSaveAdminReply = Boolean(messageId);
        console.log("Telegram webhook admin reply insert", {
          conversationId,
          success: didSaveAdminReply,
        });

        if (!messageId) {
          console.log("Telegram webhook admin reply insert error", {
            conversationId,
            adminText,
          });
        }
      } else {
        console.log("Telegram webhook admin reply insert", {
          conversationId: null,
          success: false,
        });
        console.log("Telegram webhook admin reply insert error", {
          conversationId: null,
          adminText,
        });
      }
    }

    return Response.json({
      ok: true,
      adminTakeover: didMarkTakeover,
      adminReplySaved: didSaveAdminReply,
    });
  } catch (error) {
    console.error("Telegram callback route failed:", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}

import {
  findConversationIdByTelegramReply,
  getConversationStatus,
  markConversationAiActive,
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
    let didResumeAi = false;
    let didSaveAdminReply = false;

    if (callbackQuery?.id && callbackData.startsWith("admin_takeover:")) {
      const conversationId = callbackData.slice("admin_takeover:".length).trim();
      didMarkTakeover = conversationId
        ? await markConversationAdminTakeover(conversationId)
        : false;

      await callTelegramApi("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: didMarkTakeover ? "เปิดโหมดแอดมินแล้ว" : "ไม่สามารถเปิดโหมดแอดมินได้",
        show_alert: false,
      });
    }

    if (callbackQuery?.id && callbackData.startsWith("ai_resume:")) {
      const conversationId = callbackData.slice("ai_resume:".length).trim();
      didResumeAi = conversationId ? await markConversationAiActive(conversationId) : false;

      await callTelegramApi("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: didResumeAi ? "เปิดโหมด AI แล้ว" : "ไม่สามารถเปิดโหมด AI ได้",
        show_alert: false,
      });
    }

    const incomingMessage = body.message;
    const telegramChatId = incomingMessage?.chat?.id;
    const incomingMessageId = incomingMessage?.message_id;
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

        if (conversationStatus !== "admin_takeover" && conversationStatus !== "handover") {
          await callTelegramApi("sendMessage", {
            chat_id: telegramChatId,
            text: "ตอนนี้อยู่ในโหมด AI หากต้องการตอบเอง กรุณากดรับแชทโดยแอดมินก่อน",
            ...(typeof incomingMessageId === "number" ? { reply_to_message_id: incomingMessageId } : {}),
          });

          return Response.json({
            ok: true,
            adminTakeover: didMarkTakeover,
            aiResume: didResumeAi,
            adminReplySaved: false,
          });
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
      aiResume: didResumeAi,
      adminReplySaved: didSaveAdminReply,
    });
  } catch (error) {
    console.error("Telegram callback route failed:", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}

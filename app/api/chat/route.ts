import { NextResponse } from "next/server";
import {
  createHandoverCase,
  getConversationStatus,
  listConversationMessages,
  saveChatMessage,
  saveQuestionEnrichmentCandidate,
} from "@/lib/chat-store";
import { resolveConversationId } from "@/lib/chat";
import {
  SAFE_FALLBACK_EN,
  SAFE_FALLBACK_TH,
  preAnswerGuardrail,
  validateFinalAnswer,
} from "@/lib/guardrails";
import { classifyIntent } from "@/lib/intent-classifier";
import { generateLLMAnswer } from "@/lib/llm";
import { detectLanguage, sanitizeRetrievedContext, type PromptContextItem } from "@/lib/prompt";
import { retrieveKnowledge, type RetrievalResult } from "@/lib/retrieval";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramNotification } from "@/lib/telegram";

type ChatRequestBody = {
  message?: string;
  conversationId?: string;
  userInfo?: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
  };
};

type SourceReference = {
  title: string;
  url: string;
};

type ChatHistoryResponse = {
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "admin";
    content: string;
    meta?: {
      intent: string;
      confidence: string;
      handover: boolean;
      sources: SourceReference[];
      reason: string;
    };
  }>;
};

const CONTACT_PAYSO_LINK: SourceReference = {
  title: "Contact Payso",
  url: "https://payso.co/th/contact",
};

const PAYSO_WEBSITE_LINK: SourceReference = {
  title: "Payso Website",
  url: "https://payso.co/th",
};

const SOURCE_TITLES: Record<string, string> = {
  "https://payso.co/th": "Payso",
  "https://payso.co/th/e-payment": "Payso e-Payment",
  "https://payso.co/th/payment-link": "Payso Payment Link",
  "https://payso.co/th/help": "Payso Help",
  "https://payso.co/th/payment-fee-calculator": "Payso Payment Fee Calculator",
  "https://api-docs.payso.co/docs/api/overviews": "Payso API Docs",
  "https://payso.co/th/contact": "Payso Contact",
  "https://payso.co/th/how-to-register": "Payso Registration Guide",
  "https://payso.co/th/edc": "Payso EDC",
};

const DEFAULT_SUGGESTIONS = {
  th: [
    "Payso มีบริการอะไรบ้าง",
    "Payso เชื่อมต่อผ่าน API ได้ไหม",
    "Payment Link เหมาะกับธุรกิจแบบไหน",
  ],
  en: [
    "What services does Payso offer?",
    "Can Payso integrate via API?",
    "Who is Payment Link suitable for?",
  ],
} as const;

const HANDOVER_INTENTS = new Set(["Human Handover", "Payment Issue", "Technical Issue"]);
const PAYSO_INTENTS = new Set(["Product Info", "Integration", "Payment Issue", "Technical Issue", "Human Handover"]);

let chatLogOptionalColumnsPromise: Promise<Set<string>> | null = null;

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeQuestionForStorage(text: string): string {
  const compact = normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  return compact || normalizeText(text);
}

function getSourceTitle(sourceUrl: string, fallbackTitle: string): string {
  return SOURCE_TITLES[sourceUrl] ?? fallbackTitle;
}

function buildPromptContext(items: RetrievalResult["items"]): PromptContextItem[] {
  const rawContext = items.map((item) => ({
    title: getSourceTitle(item.sourceUrl, item.title),
    content: item.content,
    sourceUrl: item.sourceUrl,
  }));

  const sanitizedContext = sanitizeRetrievedContext(rawContext);

  return sanitizedContext.length > 0 ? sanitizedContext : rawContext;
}

function buildSources(items: RetrievalResult["items"]): SourceReference[] {
  const seen = new Set<string>();

  return items
    .map((item) => ({
      title: getSourceTitle(item.sourceUrl, item.title),
      url: item.sourceUrl,
    }))
    .filter((source) => {
      if (seen.has(source.url)) {
        return false;
      }

      seen.add(source.url);
      return true;
    })
    .slice(0, 2);
}

function isGreetingOrSmallTalk(message: string): boolean {
  const normalized = normalizeText(message);

  return [
    "สวัสดี",
    "หวัดดี",
    "ดีครับ",
    "ดีค่ะ",
    "hello",
    "hi",
    "hey",
    "ขอบคุณ",
    "thank you",
    "thanks",
    "คุณคือใคร",
    "ทำอะไรได้บ้าง",
    "who are you",
    "what can you do",
  ].some((term) => normalized === term || normalized.includes(term));
}

function buildSmallTalkAnswer(message: string, language: "th" | "en"): string {
  const normalized = normalizeText(message);
  const isThanks = normalized.includes("ขอบคุณ") || normalized.includes("thank") || normalized.includes("thanks");

  if (isThanks) {
    return language === "th"
      ? "ยินดีครับ สอบถามเรื่องบริการ Payso, Payment Link, API หรือปัญหาการชำระเงินต่อได้เลยครับ"
      : "You're welcome. You can ask me about Payso services, Payment Link, API integration, or payment issues.";
  }

  return language === "th"
    ? "สวัสดีครับ ผมคือ Payso Assistant ช่วยตอบข้อมูลบริการ การสมัครใช้งาน Payment Link การเชื่อมต่อ API และปัญหาการชำระเงินเบื้องต้นได้ครับ"
    : "Hello. I’m Payso Assistant. I can help with Payso services, registration, Payment Link, API integration, and basic payment issues.";
}

function buildHandoverAnswer(language: "th" | "en"): string {
  return language === "th"
    ? [
        "ผมจะส่งเรื่องให้ทีมงานตรวจสอบต่อนะครับ",
        "",
        "เพื่อให้ทีมช่วยได้เร็วขึ้น รบกวนเตรียมข้อมูลเหล่านี้:",
        "- เวลาที่ทำรายการ",
        "- จำนวนเงิน",
        "- ช่องทางชำระเงิน",
        "- สลิปหรือเลขอ้างอิงถ้ามี",
      ].join("\n")
    : [
        "I’ll pass this to the team for further review.",
        "",
        "To help the team investigate faster, please prepare:",
        "- Transaction time",
        "- Amount",
        "- Payment channel",
        "- Slip or reference number if available",
      ].join("\n");
}

function cleanAnswer(answer: string): string {
  return answer
    .replace(/\[\d+\]/g, "")
    .replace(/\(\s*\d+(?:\s*,\s*\d+)*\s*\)/g, "")
    .replace(/skip to main content/gi, "")
    .replace(/powered by react/gi, "")
    .replace(/แหล่งอ้างอิง:[\s\S]*$/u, "")
    .replace(/sources?:[\s\S]*$/iu, "")
    .replace(/ดูเพิ่มเติม:[\s\S]*$/u, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildRelatedQuestionSection(questions: string[]): string {
  if (questions.length === 0) {
    return "";
  }

  return `คำถามที่เกี่ยวข้อง:\n${questions.slice(0, 3).map((question, index) => `${index + 1}. ${question}`).join("\n")}`;
}

function formatAnswer(answer: string, relatedQuestions: string[]): string {
  const sections = [cleanAnswer(answer), buildRelatedQuestionSection(relatedQuestions)].filter(Boolean);
  return sections.join("\n\n");
}

function buildSuggestions(params: {
  message: string;
  language: "th" | "en";
  intent: string;
  handover: boolean;
  retrievalResult?: RetrievalResult;
}): string[] {
  const { message, language, intent, handover, retrievalResult } = params;
  const normalized = normalizeText(message);

  if (handover || HANDOVER_INTENTS.has(intent)) {
    return language === "th"
      ? ["ต้องเตรียมข้อมูลอะไรให้ทีม Payso", "ติดต่อเจ้าหน้าที่ได้ช่องทางไหน", "ตรวจสอบรายการชำระเงินเบื้องต้นอย่างไร"]
      : ["What details should I prepare?", "How can I contact Payso?", "How do I check a payment issue first?"];
  }

  if (intent === "Integration" || normalized.includes("api") || normalized.includes("webhook")) {
    return language === "th"
      ? ["Payso มี API อะไรบ้าง", "Webhook ใช้งานอย่างไร", "เริ่มเชื่อมต่อระบบจากตรงไหน"]
      : ["What APIs does Payso provide?", "How does webhook work?", "Where should I start integration?"];
  }

  const products = new Set(retrievalResult?.items.map((item) => item.product) ?? []);

  if (products.has("Payment Link")) {
    return language === "th"
      ? ["Payment Link เหมาะกับใคร", "ขายผ่าน LINE หรือ Facebook ใช้ได้ไหม", "เริ่มใช้งาน Payment Link อย่างไร"]
      : ["Who is Payment Link suitable for?", "Can I use it with LINE or Facebook?", "How do I start using Payment Link?"];
  }

  return [...DEFAULT_SUGGESTIONS[language]];
}

function isPaysoRelated(params: {
  message: string;
  intent: string;
  retrievalResult: RetrievalResult;
}): boolean {
  const { message, intent, retrievalResult } = params;
  const normalized = normalizeText(message);

  return (
    PAYSO_INTENTS.has(intent) ||
    retrievalResult.items.length > 0 ||
    normalized.includes("payso") ||
    normalized.includes("payment") ||
    normalized.includes("ชำระ") ||
    normalized.includes("รับเงิน") ||
    normalized.includes("api")
  );
}

function pickSources(params: {
  paysoRelated: boolean;
  handover: boolean;
  intent: string;
  promptContext: PromptContextItem[];
  retrievalResult: RetrievalResult;
}): SourceReference[] {
  const { paysoRelated, handover, intent, promptContext, retrievalResult } = params;

  if (!paysoRelated) {
    return [];
  }

  if (handover || HANDOVER_INTENTS.has(intent)) {
    return [CONTACT_PAYSO_LINK];
  }

  const seen = new Set<string>();
  const contextSources = promptContext
    .map((item) => ({
      title: getSourceTitle(item.sourceUrl, item.title),
      url: item.sourceUrl,
    }))
    .filter((source) => {
      if (seen.has(source.url)) {
        return false;
      }

      seen.add(source.url);
      return true;
    })
    .slice(0, 2);

  const retrievedSources = buildSources(retrievalResult.items);
  const sources = contextSources.length > 0 ? contextSources : retrievedSources;

  return sources.length > 0 ? sources : [PAYSO_WEBSITE_LINK];
}

function buildNotebookLmPrompt(params: {
  question: string;
  language: "th" | "en";
  paysoRelated: boolean;
}): string {
  if (params.language === "th") {
    return params.paysoRelated
      ? `ช่วยตรวจสอบว่าฐานความรู้ Payso มีข้อมูลพอตอบคำถามนี้หรือไม่ และเสนอ FAQ ที่ควรเติมเพิ่ม\n\nคำถามลูกค้า: ${params.question}`
      : `ช่วยจัดกลุ่มคำถามนี้เพื่อใช้เป็น candidate สำหรับฐานความรู้ในอนาคต\n\nคำถามผู้ใช้: ${params.question}`;
  }

  return params.paysoRelated
    ? `Check whether the Payso knowledge base can answer this question and suggest FAQ gaps.\n\nCustomer question: ${params.question}`
    : `Classify this question as a future knowledge-base candidate.\n\nUser question: ${params.question}`;
}

async function getChatLogOptionalColumns(): Promise<Set<string>> {
  if (!chatLogOptionalColumnsPromise) {
    const supabase = getSupabaseAdmin();

    chatLogOptionalColumnsPromise = (async () => {
      if (!supabase) {
        return new Set<string>();
      }

      const { data, error } = await supabase
        .from("information_schema.columns")
        .select("column_name")
        .eq("table_schema", "public")
        .eq("table_name", "chat_logs");

      if (error || !Array.isArray(data)) {
        return new Set<string>();
      }

      return new Set(
        data
          .map((row) => row.column_name)
          .filter((columnName): columnName is string => typeof columnName === "string"),
      );
    })();
  }

  return chatLogOptionalColumnsPromise;
}

async function logChatToSupabase(params: {
  userMessage: string;
  assistantMessage: string;
  conversationId?: string | null;
  intent?: string | null;
  userInfo?: ChatRequestBody["userInfo"];
}) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return;
  }

  const insertPayload: Record<string, unknown> = {
    user_message: params.userMessage,
    assistant_message: params.assistantMessage,
  };

  const optionalColumns = await getChatLogOptionalColumns();

  if (optionalColumns.has("conversation_id")) {
    if (!params.conversationId) {
      console.error("Skipping chat_logs insert because conversation_id could not be resolved.");
      return;
    }

    insertPayload.conversation_id = params.conversationId;
  }

  if (optionalColumns.has("intent")) {
    insertPayload.intent = params.intent ?? null;
  }

  if (optionalColumns.has("user_name")) {
    insertPayload.user_name = params.userInfo?.name?.trim() || null;
  }

  if (optionalColumns.has("user_phone")) {
    insertPayload.user_phone = params.userInfo?.phone?.trim() || null;
  }

  if (optionalColumns.has("user_email")) {
    insertPayload.user_email = params.userInfo?.email?.trim() || null;
  }

  if (optionalColumns.has("user_company")) {
    insertPayload.user_company = params.userInfo?.company?.trim() || null;
  }

  const { error } = await supabase.from("chat_logs").insert(insertPayload);

  if (error) {
    console.error("Failed to insert chat log:", error);
  }
}


async function safeSideEffect(label: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`[Payso chat] ${label} failed:`, error);
  }
}

function buildLLMFallback(params: {
  message: string;
  language: "th" | "en";
  retrievalResult: RetrievalResult;
  paysoRelated: boolean;
}): string {
  const firstChunk = params.retrievalResult.items[0]?.content?.trim();
  const cleanChunk = firstChunk
    ? firstChunk.replace(/skip to main content/gi, "").replace(/powered by react/gi, "").replace(/\s+/g, " ").trim()
    : "";

  if (cleanChunk.length > 40) {
    const excerpt = cleanChunk.length > 450 ? `${cleanChunk.slice(0, 450).trim()}...` : cleanChunk;
    return params.language === "th"
      ? `จากข้อมูล Payso ที่มีอยู่ตอนนี้ สรุปได้ว่า ${excerpt}`
      : `Based on the available Payso information: ${excerpt}`;
  }

  if (params.paysoRelated) {
    return params.language === "th"
      ? "Payso เป็นระบบรับชำระเงินสำหรับธุรกิจ เช่น e-Payment, Payment Link และการเชื่อมต่อ API เพื่อช่วยให้ร้านค้ารับเงินออนไลน์ได้สะดวกขึ้นครับ หากต้องการข้อมูลเฉพาะเรื่อง สามารถถามต่อได้ เช่น Payment Link, API หรือวิธีสมัครใช้งาน"
      : "Payso provides payment solutions for businesses, such as e-Payment, Payment Link, and API integration. You can ask about Payment Link, API integration, or how to get started.";
  }

  return params.language === "th"
    ? "ขออภัยครับ ผมยังไม่พบข้อมูลที่ตรงพอสำหรับคำถามนี้ ลองถามเกี่ยวกับ e-Payment, Payment Link, API หรือปัญหาการชำระเงินของ Payso ได้ครับ"
    : "Sorry, I could not find enough relevant information for this question. You can ask about Payso e-Payment, Payment Link, API integration, or payment issues.";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId")?.trim();

    if (!conversationId) {
      return NextResponse.json({ messages: [] satisfies ChatHistoryResponse["messages"] });
    }

    const records = await listConversationMessages(conversationId);

    return NextResponse.json({
      messages: records.map((record) => ({
        id: record.id,
        role: record.role,
        content: record.content,
        meta: {
          intent: record.intent ?? "",
          confidence: record.confidence ?? "Low",
          handover: record.handover,
          sources: Array.isArray(record.sources) ? record.sources : [],
          reason: record.reason ?? "",
        },
      })),
    } satisfies ChatHistoryResponse);
  } catch (error) {
    console.error("Payso chat history route failed:", error);
    return NextResponse.json({ messages: [] satisfies ChatHistoryResponse["messages"] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let language: "th" | "en" = "th";
  let conversationId: string | null = null;

  try {
    const body = (await request.json()) as ChatRequestBody;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    language = detectLanguage(message);

    try {
      conversationId = await resolveConversationId({
        conversationId: body.conversationId,
        language,
      });
    } catch (error) {
      console.error("[Payso chat] resolveConversationId failed:", error);
      conversationId = body.conversationId?.trim() || null;
    }

    const conversationStatus = conversationId ? await getConversationStatus(conversationId).catch((error) => {
      console.error("[Payso chat] getConversationStatus failed:", error);
      return null;
    }) : null;

    if (conversationId) {
      await safeSideEffect("save user message", () =>
        saveChatMessage({
          conversationId: conversationId as string,
          role: "user",
          content: message,
        }),
      );
    }

    const isAdminTakeoverActive =
      conversationStatus === "handover" || String(conversationStatus) === "admin_takeover";

    if (isAdminTakeoverActive) {
      const takeoverAnswer =
        language === "th"
          ? "ขณะนี้แอดมินกำลังรับช่วงดูแลบทสนทนานี้อยู่ครับ ข้อความล่าสุดของคุณถูกส่งต่อให้ทีมงานแล้ว"
          : "An admin has taken over this conversation. Your latest message has been forwarded to the team.";

      await safeSideEffect("send Telegram admin takeover notification", () =>
        sendTelegramNotification({
          kind: "message",
          conversationId,
          userMessage: message,
          aiAnswer: null,
          intent: "Admin Takeover",
          confidence: "High",
          handover: true,
          userInfo: body.userInfo,
        }),
      );

      await safeSideEffect("log admin takeover chat", () =>
        logChatToSupabase({
          userMessage: message,
          assistantMessage: takeoverAnswer,
          conversationId,
          intent: "Admin Takeover",
          userInfo: body.userInfo,
        }),
      );

      return NextResponse.json({
        answer: takeoverAnswer,
        intent: "Admin Takeover",
        confidence: "High",
        handover: true,
        sources: [],
        reason: "Admin takeover is active for this conversation.",
        suggestions: [],
        conversationId,
        messageId: null,
      });
    }

    const intentResult = classifyIntent(message);
    const retrievalResult = await retrieveKnowledge(message).catch((error) => {
      console.error("[Payso chat] retrieveKnowledge failed:", error);
      return {
        items: [],
        confidence: "Low",
        score: 0,
      } as RetrievalResult;
    });

    const promptContext = buildPromptContext(retrievalResult.items);
    const paysoRelated = isPaysoRelated({ message, intent: intentResult.intent, retrievalResult });

    await safeSideEffect("save enrichment candidate", () =>
      saveQuestionEnrichmentCandidate({
        originalQuestion: message,
        normalizedQuestion: normalizeQuestionForStorage(message),
        language,
        conversationId,
        retrievalConfidence: retrievalResult.confidence,
        paysoRelated,
        notebookLmPrompt: buildNotebookLmPrompt({
          question: message,
          language,
          paysoRelated,
        }),
      }),
    );

    let answer = "";
    let intent = intentResult.intent;
    let confidence = retrievalResult.confidence;
    let handover = false;
    let reason = "";

    if (isGreetingOrSmallTalk(message) && retrievalResult.items.length === 0) {
      answer = buildSmallTalkAnswer(message, language);
      intent = "Greeting";
      confidence = "High";
      reason = "Handled as a lightweight conversational message.";
    } else if (intentResult.intent === "Human Handover") {
      answer = buildHandoverAnswer(language);
      intent = "Human Handover";
      confidence = "High";
      handover = true;
      reason = "User explicitly requested staff support or the topic requires staff review.";
    } else {
      const preGuardrail = preAnswerGuardrail({
        question: message,
        language,
        intentResult,
        retrievalResult,
      });

      if (preGuardrail.blocked) {
        answer = preGuardrail.answer || buildLLMFallback({ message, language, retrievalResult, paysoRelated });
        handover = preGuardrail.handover;
        reason = preGuardrail.reason || "Pre-answer guardrail handled this request.";
        confidence = retrievalResult.items.length > 0 ? retrievalResult.confidence : "Low";
      } else {
        const llmAnswer = await generateLLMAnswer({
          question: message,
          context: promptContext,
          intent: intentResult.intent,
          language,
        }).catch((error) => {
          console.error("[Payso chat] generateLLMAnswer failed:", error);
          return null;
        });

        answer = llmAnswer?.trim() || buildLLMFallback({ message, language, retrievalResult, paysoRelated });

        const finalGuardrail = validateFinalAnswer({
          question: message,
          language,
          intentResult,
          retrievalResult,
          answer,
        });

        if (finalGuardrail.blocked) {
          answer = finalGuardrail.answer || answer || buildLLMFallback({ message, language, retrievalResult, paysoRelated });
          handover = finalGuardrail.handover;
          reason = finalGuardrail.reason || "Final answer guardrail adjusted the response.";
        } else {
          handover = intentResult.handoverRequired;
          reason = retrievalResult.items.length > 0
            ? "Answered from retrieved Payso knowledge."
            : llmAnswer
              ? "Answered by the model with no matching Payso knowledge chunk."
              : "LLM was unavailable, so the route returned a safe local fallback.";
        }
      }
    }

    const suggestions = buildSuggestions({
      message,
      language,
      intent,
      handover,
      retrievalResult,
    }).slice(0, 3);

    answer = formatAnswer(answer || buildLLMFallback({ message, language, retrievalResult, paysoRelated }), suggestions);

    const sources = pickSources({
      paysoRelated,
      handover,
      intent,
      promptContext,
      retrievalResult,
    });

    let assistantMessageId: string | null = null;

    if (conversationId) {
      try {
        assistantMessageId = await saveChatMessage({
          conversationId,
          role: "assistant",
          content: answer,
          intent,
          confidence,
          handover,
          sources,
          reason,
        });
      } catch (error) {
        console.error("[Payso chat] save assistant message failed:", error);
      }
    }

    await safeSideEffect("send Telegram notification", () =>
      sendTelegramNotification({
        kind: "message",
        conversationId,
        userMessage: message,
        aiAnswer: answer,
        intent,
        confidence,
        handover,
        userInfo: body.userInfo,
      }),
    );

    await safeSideEffect("log chat", () =>
      logChatToSupabase({
        userMessage: message,
        assistantMessage: answer,
        conversationId,
        intent,
        userInfo: body.userInfo,
      }),
    );

    if (conversationId && handover) {
      await safeSideEffect("create handover case", () =>
        createHandoverCase({
          conversationId: conversationId as string,
          latestMessageId: assistantMessageId,
          reason,
          priority: intent === "Human Handover" ? "urgent" : confidence === "Low" ? "high" : "normal",
        }),
      );
    }

    return NextResponse.json({
      answer,
      intent,
      confidence,
      handover,
      sources,
      reason,
      suggestions,
      conversationId,
      messageId: assistantMessageId,
    });
  } catch (error) {
    console.error("Payso chat route failed:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const answer =
      language === "th"
        ? "ขออภัยครับ ระบบตอบกลับขัดข้องชั่วคราว แต่ยังใช้งานต่อได้ ลองถามใหม่อีกครั้ง หรือถามเฉพาะเรื่อง Payso เช่น Payment Link, API หรือปัญหาการชำระเงินได้ครับ"
        : "Sorry, the chat service had a temporary issue. Please try again or ask about Payso Payment Link, API, or payment issues.";

    return NextResponse.json(
      {
        answer,
        intent: "Error",
        confidence: "Low",
        handover: false,
        sources: [],
        reason: process.env.NODE_ENV === "production" ? "API route fallback response." : errorMessage,
        suggestions: DEFAULT_SUGGESTIONS[language],
        conversationId,
        messageId: null,
      },
      { status: 200 },
    );
  }
}


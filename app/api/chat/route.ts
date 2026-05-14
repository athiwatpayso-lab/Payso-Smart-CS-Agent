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
  createQuestionHash,
  getCachedAnswerByHash,
  incrementCachedAnswerHit,
  isPrivateOrUserSpecificQuestion,
  normalizeQuestionForCache,
  saveAnswerCacheEntry,
} from "@/lib/answer-cache";
import {
  SAFE_FALLBACK_EN,
  SAFE_FALLBACK_TH,
  preAnswerGuardrail,
  validateFinalAnswer,
} from "@/lib/guardrails";
import { classifyIntent } from "@/lib/intent-classifier";
import { generateLLMAnswer } from "@/lib/llm";
import { detectLanguage } from "@/lib/prompt";
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

type SourceReference = {
  title: string;
  url: string;
};

const PAYSO_WEBSITE_LINK: SourceReference = {
  title: "Payso Website",
  url: "https://payso.co/th",
};

const CONTACT_PAYSO_LINK: SourceReference = {
  title: "Contact Payso",
  url: "https://payso.co/th/contact",
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
    "เริ่มสมัครใช้งาน Payso อย่างไร",
  ],
  en: [
    "What services does Payso offer?",
    "Can Payso integrate via API?",
    "Who is Payment Link suitable for?",
    "How do I get started with Payso?",
  ],
} as const;

const TH_GREETINGS = ["สวัสดี", "หวัดดี", "ดีครับ", "ดีค่ะ", "ฮัลโหล"];
const EN_GREETINGS = ["hello", "hi", "hey", "good morning", "good afternoon", "good evening"];
const THANKS_TERMS = ["ขอบคุณ", "thank you", "thanks", "thx"];
const BYE_TERMS = ["ลาก่อน", "บาย", "bye", "goodbye", "see you"];
const IDENTITY_TERMS = [
  "คุณคือใคร",
  "ทำอะไรได้บ้าง",
  "ช่วยอะไรได้บ้าง",
  "who are you",
  "what can you do",
  "help me",
];
const PAYSO_SIGNALS = [
  "payso",
  "e-payment",
  "payment link",
  "edc",
  "api",
  "plugin",
  "merchant",
  "payment",
  "ชำระเงิน",
  "รับเงิน",
  "ร้านค้า",
  "เชื่อมต่อ",
  "ปลั๊กอิน",
  "ลิงก์ชำระเงิน",
  "ระบบรับชำระเงิน",
];

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3-next-80b-a3b-instruct:free";
let chatLogOptionalColumnsPromise: Promise<Set<string>> | null = null;

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeQuestionForStorage(text: string): string {
  const compact = normalizeText(text).replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  return compact || normalizeText(text);
}

function isFallbackAnswer(answer: string, language: "th" | "en", retrievalResult: RetrievalResult): boolean {
  return (
    answer === SAFE_FALLBACK_TH ||
    answer === SAFE_FALLBACK_EN ||
    answer === buildKnowledgeFallback(language, retrievalResult)
  );
}

function matchesAny(text: string, terms: string[]): boolean {
  const normalized = normalizeText(text);
  return terms.some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalized === normalizedTerm || normalized.includes(normalizedTerm);
  });
}

function isGreeting(message: string): boolean {
  return matchesAny(message, [...TH_GREETINGS, ...EN_GREETINGS]);
}

function isSmallTalk(message: string): boolean {
  return (
    isGreeting(message) ||
    matchesAny(message, THANKS_TERMS) ||
    matchesAny(message, BYE_TERMS) ||
    matchesAny(message, IDENTITY_TERMS)
  );
}

function isPaysoRelated(
  message: string,
  retrievalResult: RetrievalResult,
  intent?: string,
): boolean {
  if (intent === "Payment Issue" || intent === "Technical Issue" || intent === "Human Handover") {
    return true;
  }

  if (matchesAny(message, PAYSO_SIGNALS)) {
    return true;
  }

  return retrievalResult.items.length > 0 && retrievalResult.confidence !== "Low";
}

function getSourceTitle(sourceUrl: string, fallbackTitle: string): string {
  return SOURCE_TITLES[sourceUrl] ?? fallbackTitle;
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
    });
}

function buildKnowledgeFallback(language: "th" | "en", retrievalResult: RetrievalResult): string {
  const snippets = retrievalResult.items
    .map((item) => item.content.trim())
    .filter(Boolean)
    .filter((content, index, all) => all.indexOf(content) === index)
    .slice(0, 2);

  if (snippets.length === 0) {
    return language === "th" ? SAFE_FALLBACK_TH : SAFE_FALLBACK_EN;
  }

  return snippets.join("\n\n");
}

function buildPaymentIssueAnswer(language: "th" | "en"): string {
  if (language === "th") {
    return [
      "ขออภัยครับ 🙏",
      "รบกวนแจ้งเพิ่มเติมได้ไหมครับ:",
      "- ชำระผ่าน QR หรือ Payment Link",
      "- ขึ้นข้อความอะไร",
      "- ทำรายการช่วงเวลาไหน",
      "- มีสลิปหรือภาพหน้าจอไหมครับ",
      "",
      "เดี๋ยวผมช่วยตรวจสอบให้ครับ",
    ].join("\n");
  }

  return [
    "Sorry about that.",
    "Could you please share a few details:",
    "- Was it QR or Payment Link",
    "- What error message appeared",
    "- What time the transaction was attempted",
    "- Any slip or screenshot if available",
    "",
    "I’ll help you check it.",
  ].join("\n");
}

function buildTechnicalIssueAnswer(language: "th" | "en"): string {
  if (language === "th") {
    return [
      "ขออภัยครับ 🙏",
      "รบกวนแจ้งรายละเอียดเพิ่มเติมได้ไหมครับ:",
      "- ใช้งานผ่าน API, webhook หรือหน้า dashboard",
      "- ขึ้นข้อความ error อะไร",
      "- พบปัญหาช่วงเวลาไหน",
      "- มีภาพหน้าจอหรือ request/response ที่เกี่ยวข้องไหมครับ",
      "",
      "เดี๋ยวผมช่วยไล่เช็กให้ครับ",
    ].join("\n");
  }

  return [
    "Sorry about that.",
    "Could you please share a bit more detail:",
    "- Was this on API, webhook, or dashboard",
    "- What error message appeared",
    "- What time it happened",
    "- Any screenshot or related request/response if available",
    "",
    "I’ll help you check it.",
  ].join("\n");
}

function buildHandoverAnswer(language: "th" | "en"): string {
  if (language === "th") {
    return [
      "ขออภัยในความไม่สะดวกครับ 🙏",
      "",
      "รบกวนส่งข้อมูลต่อไปนี้เพื่อให้ทีมช่วยตรวจสอบได้เร็วขึ้น:",
      "- เวลาที่ทำรายการ",
      "- จำนวนเงิน",
      "- ช่องทางชำระ",
      "- สลิปหรือเลขอ้างอิงถ้ามี",
      "",
      "หากต้องการ ผมช่วยส่งต่อให้เจ้าหน้าที่ตรวจสอบต่อได้ครับ",
    ].join("\n");
  }

  return [
    "Sorry for the inconvenience.",
    "",
    "Please share the following so the team can investigate faster:",
    "- Transaction time",
    "- Amount",
    "- Payment channel",
    "- Slip or reference number if available",
    "",
    "If you want, I can help pass this to staff for further review.",
  ].join("\n");
}

function needsContactLink(message: string, intent: string, handover: boolean): boolean {
  if (handover || intent === "Human Handover") {
    return true;
  }

  return matchesAny(message, [
    "contact",
    "staff",
    "admin",
    "handover",
    "ติดต่อ",
    "เจ้าหน้าที่",
    "แอดมิน",
    "คุยกับแอดมิน",
    "ส่งต่อ",
  ]);
}

function buildRelatedLink(params: {
  message: string;
  intent: string;
  handover: boolean;
  paysoRelated: boolean;
}): SourceReference[] {
  if (!params.paysoRelated) {
    return [];
  }

  if (needsContactLink(params.message, params.intent, params.handover)) {
    return [CONTACT_PAYSO_LINK];
  }

  if (
    params.intent === "Product Info" ||
    params.intent === "Integration" ||
    params.intent === "Payment Issue" ||
    params.intent === "Technical Issue"
  ) {
    return [PAYSO_WEBSITE_LINK];
  }

  return [];
}

function buildGreetingAnswer(language: "th" | "en"): string {
  if (language === "th") {
    return "สวัสดีครับ ยินดีต้อนรับสู่ Payso ครับ\nผมคือ AI Customer Success Agent ที่พร้อมให้บริการข้อมูลและสนับสนุนการใช้งานระบบรับชำระเงินของเราตลอด 24 ชั่วโมง เพื่อช่วยให้ธุรกิจของคุณเติบโตได้อย่างมั่นคง";
  }

  return "Hello and welcome to Payso. I am your AI Customer Success Agent, ready to help with product information and payment-system usage guidance.";
}

function buildSmallTalkAnswer(message: string, language: "th" | "en"): string {
  if (isGreeting(message)) {
    return buildGreetingAnswer(language);
  }

  if (matchesAny(message, THANKS_TERMS)) {
    return language === "th"
      ? "ยินดีเสมอครับ ถ้าต้องการ ผมช่วยต่อได้ทั้งเรื่องบริการของ Payso การเชื่อมต่อ API หรือการเริ่มต้นใช้งานครับ"
      : "You're welcome. I can also help with Payso products, API integration, or getting started.";
  }

  if (matchesAny(message, BYE_TERMS)) {
    return language === "th"
      ? "ยินดีให้บริการครับ หากต้องการข้อมูลเกี่ยวกับ Payso เพิ่มเติม ถามกลับมาได้ทุกเมื่อครับ"
      : "Happy to help. If you need anything about Payso later, feel free to come back anytime.";
  }

  return language === "th"
    ? "ผมคือ AI Customer Success Agent ของ Payso ครับ ช่วยตอบได้ทั้งข้อมูลบริการ การเชื่อมต่อ การใช้งาน และคำถามเบื้องต้นเกี่ยวกับระบบรับชำระเงินของ Payso"
    : "I am Payso's AI Customer Success Agent. I can help with Payso services, integrations, usage guidance, and support-related questions.";
}

async function generateGeneralAnswer(
  question: string,
  language: "th" | "en",
): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Payso Smart CS Agent",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL,
        temperature: 0.3,
        max_tokens: 180,
        messages: [
          {
            role: "system",
            content:
              language === "th"
                ? "คุณคือผู้ช่วย AI ที่ตอบสั้น ชัด และเป็นธรรมชาติ ภาษาไทยล้วน หากคำถามไม่เกี่ยวกับ Payso ให้ตอบเหมือนผู้ช่วยทั่วไปได้ แต่กระชับและสุภาพ"
                : "You are a concise, natural AI assistant. If the question is not about Payso, answer it like a normal general assistant in a short and friendly way.",
          },
          { role: "user", content: question },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return payload.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGenericFallback(language: "th" | "en"): string {
  return language === "th"
    ? "ผมตอบคำถามทั่วไปได้ครับ และถ้าต้องการข้อมูลเกี่ยวกับ Payso ผมช่วยต่อได้ทั้งเรื่องบริการ การเชื่อมต่อ API และการเริ่มต้นใช้งาน"
    : "I can help with general questions, and I can also help with Payso products, API integration, and onboarding.";
}

function buildNotebookLmPrompt(params: {
  question: string;
  language: "th" | "en";
  paysoRelated: boolean;
}): string {
  if (params.language === "th") {
    return params.paysoRelated
      ? `ช่วยตอบคำถามนี้จากแหล่งข้อมูล Payso ที่มีอยู่ใน NotebookLM เท่านั้น หากข้อมูลยังไม่พอ ให้สรุปว่าควรเติมข้อมูลอะไรเพิ่ม และช่วยเสนอคำถาม FAQ ที่เกี่ยวข้องอีก 3-5 ข้อ\n\nคำถามลูกค้า: ${params.question}`
      : `ช่วยจัดกลุ่มคำถามนี้และเสนอรูปแบบคำถามที่เหมาะกับการเก็บเป็นฐานความรู้ในอนาคต พร้อมคำถามต่อยอด 3-5 ข้อ\n\nคำถามผู้ใช้: ${params.question}`;
  }

  return params.paysoRelated
    ? `Answer this question using only the Payso sources already in NotebookLM. If the sources are not enough, state what information is still missing and propose 3-5 related FAQ questions.\n\nUser question: ${params.question}`
    : `Classify this question for future knowledge-base enrichment and propose 3-5 related follow-up questions.\n\nUser question: ${params.question}`;
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

function buildSuggestions(params: {
  language: "th" | "en";
  answerType: "greeting" | "smalltalk" | "payso" | "handover" | "general";
  retrievalResult?: RetrievalResult;
}): string[] {
  const { language, answerType, retrievalResult } = params;
  const defaults = [...DEFAULT_SUGGESTIONS[language]];

  if (answerType === "handover") {
    return language === "th"
      ? ["ต้องเตรียมข้อมูลอะไรให้ทีม Payso บ้าง", "ช่องทางติดต่อ Payso อยู่ที่ไหน", "วิธีตรวจสอบรายการชำระเงินเบื้องต้น"]
      : ["What details should I prepare for Payso support?", "How can I contact Payso?", "How do I check a payment issue first?"];
  }

  if (answerType === "greeting" || answerType === "smalltalk") {
    return defaults;
  }

  const products = new Set(retrievalResult?.items.map((item) => item.product) ?? []);

  if (products.has("e-Payment")) {
    return language === "th"
      ? ["e-Payment รองรับการเชื่อมต่อแบบไหนบ้าง", "Payso มี API และ Plugin ไหม", "เหมาะกับธุรกิจแบบใด"]
      : ["What integration methods does e-Payment support?", "Does Payso provide API and plugins?", "What business type is it suitable for?"];
  }

  if (products.has("Payment Link")) {
    return language === "th"
      ? ["Payment Link เหมาะกับใคร", "ขายผ่าน LINE หรือ Facebook ใช้ได้ไหม", "เริ่มใช้งาน Payment Link อย่างไร"]
      : ["Who is Payment Link suitable for?", "Can I use it for LINE or Facebook sales?", "How do I start using Payment Link?"];
  }

  return defaults;
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
  try {
    const body = (await request.json()) as ChatRequestBody;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const language = detectLanguage(message);
    const conversationId = await resolveConversationId({
      conversationId: body.conversationId,
      language,
    });
    const conversationStatus = await getConversationStatus(conversationId);

    if (conversationId) {
      await saveChatMessage({
        conversationId,
        role: "user",
        content: message,
      });
    }

    const intentResult = classifyIntent(message);
    const retrievalResult = await retrieveKnowledge(message);
    const paysoRelated = isPaysoRelated(message, retrievalResult, intentResult.intent);
    const normalizedQuestion = normalizeQuestionForCache(message);
    const questionHash = createQuestionHash(normalizedQuestion);
    const canUseAnswerCache = paysoRelated && !isPrivateOrUserSpecificQuestion(message);

    await saveQuestionEnrichmentCandidate({
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
    });

    const isAdminTakeoverActive =
      conversationStatus === "handover" || String(conversationStatus) === "admin_takeover";

    if (isAdminTakeoverActive) {
      const takeoverAnswer =
        language === "th"
          ? "ขณะนี้แอดมินกำลังรับช่วงดูแลบทสนทนานี้อยู่ครับ ข้อความล่าสุดของคุณถูกส่งต่อให้ทีมงานแล้ว"
          : "An admin has taken over this conversation. Your latest message has been forwarded to the team.";

      await sendTelegramNotification({
        kind: "message",
        conversationId,
        userMessage: message,
        intent: "Admin Takeover",
        confidence: "High",
        handover: true,
        userInfo: body.userInfo,
      });

      await logChatToSupabase({
        userMessage: message,
        assistantMessage: takeoverAnswer,
        conversationId,
        intent: "Admin Takeover",
        userInfo: body.userInfo,
      });

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

    let answer = "";
    let intent: string = intentResult.intent;
    let confidence = retrievalResult.confidence;
    let handover = false;
    let reason = "";
    let suggestions: string[] = [];
    let sources: SourceReference[] = [];

    if (isSmallTalk(message)) {
      answer = buildSmallTalkAnswer(message, language);
      intent = "Greeting";
      confidence = "High";
      reason = "Handled as a lightweight conversational message.";
      suggestions = buildSuggestions({ language, answerType: isGreeting(message) ? "greeting" : "smalltalk" });
    } else if (intentResult.intent === "Payment Issue") {
      answer = buildPaymentIssueAnswer(language);
      intent = "Payment Issue";
      confidence = "High";
      reason = "Handled as a payment issue with a concise troubleshooting reply.";
      suggestions = buildSuggestions({ language, answerType: "handover" });
    } else if (intentResult.intent === "Technical Issue" && retrievalResult.items.length === 0) {
      answer = buildTechnicalIssueAnswer(language);
      intent = "Technical Issue";
      confidence = "High";
      reason = "Handled as a technical issue with a concise troubleshooting reply.";
      suggestions = buildSuggestions({ language, answerType: "handover" });
    } else if (intentResult.intent === "Human Handover") {
      answer = buildHandoverAnswer(language);
      intent = "Human Handover";
      confidence = "High";
      handover = true;
      reason = "Handled as a case that needs staff review.";
      suggestions = buildSuggestions({ language, answerType: "handover" });
    } else if (!paysoRelated) {
      answer = (await generateGeneralAnswer(message, language)) ?? buildGenericFallback(language);
      intent = "General";
      confidence = "Medium";
      reason = "Answered as a general AI request because the question was not clearly about Payso.";
      suggestions = buildSuggestions({ language, answerType: "general" });
    } else {
      const preGuardrail = preAnswerGuardrail({
        question: message,
        language,
        intentResult,
        retrievalResult,
      });

      if (preGuardrail.blocked) {
        answer = preGuardrail.answer ?? (language === "th" ? SAFE_FALLBACK_TH : SAFE_FALLBACK_EN);
        handover = preGuardrail.handover;
        reason = preGuardrail.reason;
        confidence = retrievalResult.items.length > 0 ? retrievalResult.confidence : "Low";
        sources = buildSources(retrievalResult.items);
        suggestions = buildSuggestions({ language, answerType: handover ? "handover" : "payso", retrievalResult });
      } else {
        const cachedAnswer = canUseAnswerCache ? await getCachedAnswerByHash(questionHash) : null;

        if (cachedAnswer) {
          answer = cachedAnswer.answer;
          reason = "Answered from cached Payso response.";

          void incrementCachedAnswerHit({
            id: cachedAnswer.id,
            hitCount: cachedAnswer.hit_count ?? 0,
          });
        } else {
        const llmAnswer =
          retrievalResult.items.length > 0
            ? await generateLLMAnswer({
                question: message,
                context: retrievalResult.items.map((item) => ({
                  title: getSourceTitle(item.sourceUrl, item.title),
                  content: item.content,
                  sourceUrl: item.sourceUrl,
                })),
                intent: intentResult.intent,
                language,
              })
            : null;

          answer = llmAnswer ?? buildKnowledgeFallback(language, retrievalResult);
        }

        const finalGuardrail = validateFinalAnswer({
          question: message,
          language,
          intentResult,
          retrievalResult,
          answer,
        });

        if (finalGuardrail.blocked) {
          answer = finalGuardrail.answer ?? answer;
          handover = finalGuardrail.handover;
          reason = finalGuardrail.reason;
        } else {
          handover = intentResult.handoverRequired;
          reason =
            reason ||
            (retrievalResult.items.length > 0
              ? "Answered from retrieved Payso knowledge."
              : "Answered conservatively because only limited verified Payso context was available.");
        }

        sources = buildSources(retrievalResult.items);
        suggestions = buildSuggestions({ language, answerType: handover ? "handover" : "payso", retrievalResult });
      }
    }

    sources = buildRelatedLink({
      message,
      intent,
      handover,
      paysoRelated,
    });

    const assistantMessageId = conversationId
      ? await saveChatMessage({
          conversationId,
          role: "assistant",
          content: answer,
          intent,
          confidence,
          handover,
          sources,
          reason,
        })
      : null;

    await sendTelegramNotification({
      kind: "message",
      conversationId,
      userMessage: message,
      intent,
      confidence,
      handover,
      userInfo: body.userInfo,
    });

    await logChatToSupabase({
      userMessage: message,
      assistantMessage: answer,
      conversationId,
      intent,
      userInfo: body.userInfo,
    });

    if (
      paysoRelated &&
      !handover &&
      canUseAnswerCache &&
      !isFallbackAnswer(answer, language, retrievalResult)
    ) {
      await saveAnswerCacheEntry({
        normalizedQuestion,
        questionHash,
        answer,
        confidence: 1,
      });
    }

    if (conversationId && handover) {
      await createHandoverCase({
        conversationId,
        latestMessageId: assistantMessageId,
        reason,
        priority:
          intent === "Human Handover"
            ? "urgent"
            : confidence === "Low"
              ? "high"
              : "normal",
      });

      await sendTelegramNotification({
        kind: "handover",
        conversationId,
        userMessage: message,
        intent,
        confidence,
        handover,
        userInfo: body.userInfo,
      });
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
    return NextResponse.json(
      {
        answer:
          "ระบบยังประมวลผลคำถามนี้ได้ไม่สมบูรณ์ในตอนนี้ ลองพิมพ์ใหม่อีกครั้ง หรือถามให้เฉพาะเจาะจงขึ้นได้ครับ เช่น สนใจ e-Payment, Payment Link หรือการเชื่อมต่อ API",
        intent: "Out of Scope",
        confidence: "Low",
        handover: false,
        sources: [],
        reason: "The API route could not complete the request safely.",
        suggestions: DEFAULT_SUGGESTIONS.th,
        conversationId: null,
        messageId: null,
      },
      { status: 500 },
    );
  }
}

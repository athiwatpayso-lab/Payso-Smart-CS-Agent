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
  "ใบกำกับภาษี",
  "ใบเสร็จ",
  "tax invoice",
  "receipt",
  "ระบบหลังบ้าน",
  "dashboard",
  "บริการ",
  "มีบริการอะไรบ้าง",
  "คืออะไร",
  "refund",
  "refung",
  "chargeback",
  "payment failed",
  "payment error",
  "ชำระเงินไม่ผ่าน",
  "จ่ายเงินไม่ได้",
  "คืนเงิน",
  "ขอคืนเงิน",
  "รายการคืนเงิน",
  "ยกเลิกรายการ",
  "ชำระไม่ได้",
  "จ่ายไม่ได้",
  "โอนไม่ได้",
  "ชำระเงิน",
  "รับเงิน",
  "ร้านค้า",
  "เชื่อมต่อ",
  "ปลั๊กอิน",
  "ลิงก์ชำระเงิน",
  "ระบบรับชำระเงิน",
];

const VAGUE_SUPPORT_TERMS = [
  "สอบถาม",
  "สอบถามหน่อย",
  "ขอสอบถาม",
  "อยากสอบถาม",
  "ขอข้อมูล",
  "ขอข้อมูลหน่อย",
  "ข้อมูลหน่อย",
  "ใช้งานยังไง",
  "ใช้งานอย่างไร",
  "วิธีใช้งาน",
  "เริ่มยังไง",
  "เริ่มใช้งานยังไง",
  "อยากใช้งาน",
  "แนะนำหน่อย",
  "ช่วยแนะนำ",
  "ask something",
  "need information",
  "more information",
  "how to use",
  "how do i use",
  "getting started",
];

const SPECIFIC_SUPPORT_TERMS = [
  "payment link",
  "e-payment",
  "edc",
  "api",
  "webhook",
  "plugin",
  "ใบกำกับภาษี",
  "ใบเสร็จ",
  "tax invoice",
  "receipt",
  "ระบบหลังบ้าน",
  "dashboard",
  "ค่าธรรมเนียม",
  "ราคา",
  "สมัคร",
  "ลงทะเบียน",
  "ถอนเงิน",
  "คืนเงิน",
  "refund",
  "chargeback",
  "error",
  "ไม่ผ่าน",
  "ไม่ได้",
  "ลิงก์",
  "ชำระ",
  "รับเงิน",
  "เชื่อมต่อ",
];

const CLARIFICATION_SUGGESTIONS = {
  th: ["สมัคร Payso ต้องใช้อะไรบ้าง", "Payment Link ใช้งานอย่างไร", "Payso เชื่อมต่อ API ได้ไหม"],
  en: ["How do I register for Payso?", "How does Payment Link work?", "Can Payso integrate via API?"],
} as const;

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-pro-exp-03-25:free";
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

function hasSpecificSupportTerm(message: string): boolean {
  return matchesAny(message, SPECIFIC_SUPPORT_TERMS);
}

function isVagueSupportIntent(message: string, retrievalResult: RetrievalResult): boolean {
  const normalized = normalizeText(message);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const shortQuestion = normalized.length <= 32 || wordCount <= 5;
  const hasVagueTerm = VAGUE_SUPPORT_TERMS.some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalized === normalizedTerm || normalized.includes(normalizedTerm);
  });

  if (!hasVagueTerm) {
    return false;
  }

  if (hasSpecificSupportTerm(normalized) && retrievalResult.confidence !== "Low") {
    return false;
  }

  return shortQuestion || retrievalResult.items.length === 0 || retrievalResult.confidence === "Low";
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
  return language === "th"
    ? "ขออภัยครับ ขณะนี้ระบบยังไม่พบข้อมูลทางการที่เพียงพอสำหรับตอบคำถามนี้อย่างมั่นใจ แนะนำให้ติดต่อทีมงาน Payso เพื่อยืนยันรายละเอียดเพิ่มเติม"
    : "Sorry, the system has not found enough official information to answer this confidently. Please contact Payso support for confirmation.";
}

function buildClarificationAnswer(language: "th" | "en"): string {
  if (language === "th") {
    return [
      "ยินดีครับ ต้องการสอบถามเกี่ยวกับส่วนไหนของ Payso ครับ",
      "",
      "- สมัครใช้งาน Payso",
      "- วิธีรับชำระเงิน",
      "- Payment Link",
      "- การเชื่อมต่อ API",
      "- ค่าธรรมเนียม",
      "- การถอนเงิน",
      "- ปัญหาการใช้งาน",
      "",
      "สามารถพิมพ์รายละเอียดเพิ่มเติมได้เลยครับ",
    ].join("\n");
  }

  return [
    "Sure. Which part of Payso would you like to ask about?",
    "",
    "- Payso registration",
    "- Receiving payments",
    "- Payment Link",
    "- API integration",
    "- Fees",
    "- Withdrawals",
    "- Usage issues",
    "",
    "Please share a bit more detail and I’ll help from there.",
  ].join("\n");
}

function buildRetrievedPromptContext(items: RetrievalResult["items"]): PromptContextItem[] {
  return sanitizeRetrievedContext(
    items.map((item) => ({
      title: getSourceTitle(item.sourceUrl, item.title),
      content: item.content,
      sourceUrl: item.sourceUrl,
    })),
  );
}

function buildRawPromptContext(items: RetrievalResult["items"]): PromptContextItem[] {
  return items.map((item) => ({
    title: getSourceTitle(item.sourceUrl, item.title),
    content: item.content,
    sourceUrl: item.sourceUrl,
  }));
}

function stripAnswerNoise(answer: string): string {
  return answer
    .replace(/\[\d+\]/g, "")
    .replace(/\(\s*\d+(?:\s*,\s*\d+)*\s*\)/g, "")
    .replace(/skip to main content/gi, "")
    .replace(/powered by react/gi, "")
    .replace(/\s+\|\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function answerLooksNoisy(answer: string): boolean {
  const normalized = normalizeText(answer);

  return (
    normalized.includes("skip to main content") ||
    normalized.includes("powered by react") ||
    normalized.includes("navigation") ||
    normalized.includes("menu") ||
    normalized.includes("pay solutions - online payment service")
  );
}

function isApiQuestion(message: string, intent: string): boolean {
  const normalized = normalizeText(message);
  return intent === "Integration" || normalized.includes("api") || normalized.includes("webhook");
}

function pickRelevantLinks(params: {
  promptContext: PromptContextItem[];
  apiQuestion: boolean;
  handover: boolean;
  weakContext: boolean;
}): SourceReference[] {
  const uniqueLinks = new Map<string, SourceReference>();

  for (const item of params.promptContext) {
    if (!uniqueLinks.has(item.sourceUrl)) {
      uniqueLinks.set(item.sourceUrl, {
        title: getSourceTitle(item.sourceUrl, item.title),
        url: item.sourceUrl,
      });
    }
  }

  const allLinks = Array.from(uniqueLinks.values());
  const picks: SourceReference[] = [];

  if (params.apiQuestion) {
    const apiDocLink =
      allLinks.find((link) => /api|docs|developer/i.test(link.url) || /api|docs|developer/i.test(link.title)) ??
      null;

    if (apiDocLink) {
      picks.push(apiDocLink);
    }
  }

  const contactLink =
    allLinks.find((link) => /contact/i.test(link.url) || /contact/i.test(link.title)) ?? CONTACT_PAYSO_LINK;

  if ((params.handover || params.weakContext || params.apiQuestion) && !picks.some((link) => link.url === contactLink.url)) {
    picks.push(contactLink);
  }

  for (const link of allLinks) {
    if (picks.length >= 2) {
      break;
    }

    if (!picks.some((pick) => pick.url === link.url)) {
      picks.push(link);
    }
  }

  return picks.slice(0, 2);
}

function buildAdditionalSection(links: SourceReference[]): string {
  if (links.length === 0) {
    return "";
  }

  return `ดูเพิ่มเติม:\n${links.map((link) => `- ${link.title}: ${link.url}`).join("\n")}`;
}

function buildRelatedQuestionSection(questions: string[]): string {
  const normalizedQuestions = questions.slice(0, 3);
  return `คำถามที่เกี่ยวข้อง:\n${normalizedQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")}`;
}

function buildWeakOfficialInfoAnswer(params: {
  language: "th" | "en";
  links: SourceReference[];
  relatedQuestions: string[];
}): string {
  if (params.language === "th") {
    const sections = [
      "ยินดีครับ ข้อมูลที่พบตอนนี้ยังไม่พอให้ตอบแบบเฉพาะเจาะจงได้ รบกวนเลือกหัวข้อหรือพิมพ์รายละเอียดเพิ่มอีกนิดครับ",
      [
        "- สมัครใช้งาน Payso",
        "- วิธีรับชำระเงิน",
        "- Payment Link",
        "- การเชื่อมต่อ API",
        "- ค่าธรรมเนียม",
        "- การถอนเงิน",
        "- ปัญหาการใช้งาน",
      ].join("\n"),
      buildRelatedQuestionSection(params.relatedQuestions),
    ].filter(Boolean);

    return sections.join("\n\n");
  }

  const sections = [
    "Sure. I need a little more detail to answer this well. Which Payso topic should I help with?",
    ["- Payso registration", "- Receiving payments", "- Payment Link", "- API integration", "- Fees", "- Withdrawals", "- Usage issues"].join("\n"),
    buildRelatedQuestionSection(params.relatedQuestions),
  ].filter(Boolean);

  return sections.join("\n\n");
}

function buildApiSupportAnswer(params: {
  links: SourceReference[];
  relatedQuestions: string[];
}): string {
  const sections = [
    "ได้ครับ Payso รองรับการเชื่อมต่อผ่าน API สำหรับธุรกิจที่ต้องการเชื่อมระบบชำระเงินเข้ากับเว็บไซต์ แอป หรือระบบหลังบ้านของตัวเอง",
    [
      "- เหมาะกับระบบที่ต้องการรับชำระเงินอัตโนมัติ",
      "- ใช้เชื่อมกับ e-Payment, Payment Link หรือระบบหลังบ้านได้ตามรูปแบบบริการ",
      "- นักพัฒนาควรดูเอกสาร API หรือคู่มือสำหรับนักพัฒนาก่อนเริ่มเชื่อมต่อ",
    ].join("\n"),
    buildRelatedQuestionSection(params.relatedQuestions),
  ].filter(Boolean);

  return sections.join("\n\n");
}

function formatPaysoAnswer(params: {
  answer: string;
  language: "th" | "en";
  links: SourceReference[];
  relatedQuestions: string[];
}): string {
  const cleanedAnswer = stripAnswerNoise(params.answer)
    .replace(/ดูเพิ่มเติม:[\s\S]*$/u, "")
    .replace(/คำถามที่เกี่ยวข้อง:[\s\S]*$/u, "")
    .trim();
  const sections = [
    cleanedAnswer,
    buildRelatedQuestionSection(params.relatedQuestions),
  ].filter(Boolean);

  return sections.join("\n\n");
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
  if (
    handover ||
    intent === "Human Handover" ||
    intent === "Payment Issue" ||
    intent === "Technical Issue"
  ) {
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

  return [PAYSO_WEBSITE_LINK];
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
                ? "คุณเป็นเจ้าหน้าที่ customer support ของ Payso ตอบเป็นภาษาไทยก่อน น้ำเสียงสุภาพ กระชับ และเป็นมืออาชีพ ไม่พูดถึง AI หรือขั้นตอนภายใน หากข้อมูลยังไม่พอ ให้ถามคำถามต่อสั้น ๆ เพียง 1 ข้อเพื่อช่วยแก้ปัญหาให้ตรงจุด"
                : "You are a professional Payso customer support agent. Reply concisely, politely, and in a customer support tone. Do not mention AI or internal workflow. If you are unsure, ask one short follow-up question."
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
    ? buildClarificationAnswer("th")
    : buildClarificationAnswer("en");
}

async function generateGeneralAnswerLegacy(
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

function buildGenericFallbackObsolete(language: "th" | "en"): string {
  return buildGenericFallback(language);
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
  message: string;
  language: "th" | "en";
  answerType: "greeting" | "smalltalk" | "payso" | "handover" | "general";
  intent?: string;
  retrievalResult?: RetrievalResult;
}): string[] {
  const { message, language, answerType, intent, retrievalResult } = params;
  const defaults = [...DEFAULT_SUGGESTIONS[language]];
  const normalizedMessage = normalizeText(message);

  if (
    intent === "Payment Issue" ||
    intent === "Technical Issue" ||
    normalizedMessage.includes("จ่ายไม่ได้") ||
    normalizedMessage.includes("ชำระไม่ได้") ||
    normalizedMessage.includes("ชำระเงินไม่ผ่าน") ||
    normalizedMessage.includes("จ่ายเงินไม่ได้") ||
    normalizedMessage.includes("payment failed") ||
    normalizedMessage.includes("payment error")
  ) {
    return [
      "ชำระผ่านช่องทางไหนได้บ้าง",
      "ต้องส่งข้อมูลอะไรให้เจ้าหน้าที่ตรวจสอบ",
      "เงินจะเข้าบัญชีเมื่อไหร่",
    ];
  }

  if (
    intent === "Human Handover" ||
    normalizedMessage.includes("คืนเงิน") ||
    normalizedMessage.includes("refund") ||
    normalizedMessage.includes("chargeback")
  ) {
    return [
      "ต้องส่งข้อมูลอะไรให้เจ้าหน้าที่ตรวจสอบ",
      "ติดต่อเจ้าหน้าที่ได้ช่องทางไหน",
      "ใช้เวลาตรวจสอบประมาณกี่วัน",
    ];
  }

  if (
    normalizedMessage.includes("สมัคร") ||
    normalizedMessage.includes("ลงทะเบียน") ||
    normalizedMessage.includes("sign up") ||
    normalizedMessage.includes("register")
  ) {
    return [
      "สมัคร Payso ต้องใช้อะไรบ้าง",
      "เริ่มใช้งาน Payso ยังไง",
      "ติดต่อทีมงานเพื่อลงทะเบียนได้ไหม",
    ];
  }

  if (
    intent === "Integration" ||
    normalizedMessage.includes("api") ||
    normalizedMessage.includes("webhook")
  ) {
    return [
      "Payso มี API อะไรบ้าง",
      "Webhook ของ Payso ใช้งานยังไง",
      "ต้องเริ่มเชื่อมต่อระบบจากตรงไหน",
    ];
  }

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
    const promptContext = buildRetrievedPromptContext(retrievalResult.items);
    const llmContext = promptContext.length > 0 ? promptContext : buildRawPromptContext(retrievalResult.items);
    const vagueSupport = isVagueSupportIntent(message, retrievalResult);
    const paysoRelated = vagueSupport || isPaysoRelated(message, retrievalResult, intentResult.intent);
    const normalizedQuestion = normalizeQuestionForCache(message);
    const questionHash = createQuestionHash(normalizedQuestion);
    const canUseAnswerCache = paysoRelated && !vagueSupport && !isPrivateOrUserSpecificQuestion(message);
    const apiQuestion = isApiQuestion(message, intentResult.intent);

    console.log("[Payso RAG] retrieval", {
      items: retrievalResult.items.length,
      confidence: retrievalResult.confidence,
      score: retrievalResult.score,
      promptContextItems: promptContext.length,
      llmContextItems: llmContext.length,
      paysoRelated,
      intent: intentResult.intent,
    });

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
        aiAnswer: null,
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
    let answerLinks: SourceReference[] = [];

    if (isSmallTalk(message)) {
      console.log("[Payso RAG] branch", "smalltalk");
      answer = buildSmallTalkAnswer(message, language);
      intent = "Greeting";
      confidence = "High";
      reason = "Handled as a lightweight conversational message.";
      suggestions = buildSuggestions({
        message,
        language,
        answerType: isGreeting(message) ? "greeting" : "smalltalk",
        intent,
      });
    } else if (intentResult.intent === "Human Handover") {
      console.log("[Payso RAG] branch", "human_handover");
      answer = buildHandoverAnswer(language);
      intent = "Human Handover";
      confidence = "High";
      handover = true;
      reason = "Handled as a case that needs staff review.";
      suggestions = buildSuggestions({ message, language, answerType: "handover", intent });
    } else if (vagueSupport) {
      console.log("[Payso RAG] branch", "vague_support_clarification");
      answer = buildClarificationAnswer(language);
      intent = "Product Info";
      confidence = "Medium";
      reason = "Asked a clarification question because the user message was broad or retrieval confidence was low.";
      suggestions = [...CLARIFICATION_SUGGESTIONS[language]];
    } else if (!paysoRelated) {
      console.log("[Payso RAG] branch", "general_non_payso");
      answer = (await generateGeneralAnswer(message, language)) ?? buildGenericFallback(language);
      intent = "General";
      confidence = "Medium";
      reason = "Answered as a general AI request because the question was not clearly about Payso.";
      suggestions = buildSuggestions({ message, language, answerType: "general", intent });
    } else {
      const preGuardrail = preAnswerGuardrail({
        question: message,
        language,
        intentResult,
        retrievalResult,
      });

      console.log("[Payso RAG] preGuardrail", {
        blocked: preGuardrail.blocked,
        reason: preGuardrail.reason,
        handover: preGuardrail.handover,
      });

      if (preGuardrail.blocked) {
        console.log("[Payso RAG] branch", "pre_guardrail_blocked");
        answer = preGuardrail.answer ?? (language === "th" ? SAFE_FALLBACK_TH : SAFE_FALLBACK_EN);
        handover = preGuardrail.handover;
        reason = preGuardrail.reason;
        confidence = promptContext.length > 0 ? retrievalResult.confidence : "Low";
        suggestions = buildSuggestions({
          message,
          language,
          answerType: handover ? "handover" : "payso",
          intent,
          retrievalResult,
        });
      } else {
        const cachedAnswer = canUseAnswerCache ? await getCachedAnswerByHash(questionHash) : null;

        if (cachedAnswer && !answerLooksNoisy(cachedAnswer.answer)) {
          answer = cachedAnswer.answer;
          reason = "Answered from cached Payso response.";

          void incrementCachedAnswerHit({
            id: cachedAnswer.id,
            hitCount: cachedAnswer.hit_count ?? 0,
          });
        } else {
          const hasRetrievedItems = retrievalResult.items.length > 0;
          const shouldUseCsLlm =
            hasRetrievedItems ||
            intentResult.intent === "Payment Issue" ||
            intentResult.intent === "Technical Issue";

          console.log("[Payso RAG] retrieval item count", retrievalResult.items.length);
          console.log("[Payso RAG] branch selected", hasRetrievedItems ? "llm_with_retrieved_context" : "fallback_no_retrieval");

          const llmAnswer = shouldUseCsLlm
            ? await generateLLMAnswer({
                question: message,
                context: llmContext,
                intent: intentResult.intent,
                language,
              })
            : null;

          if (hasRetrievedItems) {
            answer = llmAnswer ?? buildGenericFallback(language);
          } else {
            answer = llmAnswer ?? buildKnowledgeFallback(language, retrievalResult);
          }
        }

        const finalGuardrail = validateFinalAnswer({
          question: message,
          language,
          intentResult,
          retrievalResult,
          answer,
        });

        if (finalGuardrail.blocked) {
          console.log("[Payso RAG] finalGuardrail", {
            blocked: true,
            reason: finalGuardrail.reason,
            handover: finalGuardrail.handover,
          });
          answer = finalGuardrail.answer ?? answer;
          handover = finalGuardrail.handover;
          reason = finalGuardrail.reason;
        } else {
          console.log("[Payso RAG] finalGuardrail", {
            blocked: false,
            reason: finalGuardrail.reason,
          });
          handover = intentResult.handoverRequired;
          reason =
            reason ||
            (promptContext.length > 0
              ? "Answered from retrieved Payso knowledge."
              : "Answered conservatively because only limited verified Payso context was available.");
        }
        suggestions = buildSuggestions({
          message,
          language,
          answerType: handover ? "handover" : "payso",
          intent,
          retrievalResult,
        });
      }
    }

    suggestions = suggestions.slice(0, 3);

    const generatedAnswerIsNoisy = paysoRelated && answerLooksNoisy(answer);

    const weakOfficialContext =
      paysoRelated &&
      (retrievalResult.items.length === 0 || generatedAnswerIsNoisy);

    answerLinks = pickRelevantLinks({
      promptContext: llmContext,
      apiQuestion,
      handover,
      weakContext: weakOfficialContext,
    });

    if (paysoRelated && !vagueSupport) {
      if (weakOfficialContext) {
        answer = buildWeakOfficialInfoAnswer({
          language,
          links: answerLinks,
          relatedQuestions: suggestions,
        });
      } else {
        answer = formatPaysoAnswer({
          answer,
          language,
          links: answerLinks,
          relatedQuestions: suggestions,
        });
      }
    }

    sources = paysoRelated && !vagueSupport
      ? answerLinks.length
        ? answerLinks
        : buildSources(retrievalResult.items)
      : [];

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
      aiAnswer: answer,
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

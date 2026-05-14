import type { IntentResult } from "@/lib/intent-classifier";
import type { RetrievalResult } from "@/lib/retrieval";

type GuardrailParams = {
  question: string;
  language: "th" | "en";
  intentResult: IntentResult;
  retrievalResult: RetrievalResult;
};

export type GuardrailResult = {
  blocked: boolean;
  answer: string | null;
  handover: boolean;
  reason: string;
};

export const SAFE_FALLBACK_TH =
  "ตอนนี้ยังไม่พบข้อมูลที่ยืนยันได้ชัดเจนจากแหล่งข้อมูลทางการของ Payso ผมจึงยังไม่อยากตอบแบบคาดเดา หากต้องใช้ข้อมูลนี้แบบยืนยัน แนะนำให้ตรวจสอบกับ Payso โดยตรง";

export const SAFE_FALLBACK_EN =
  "The system could not find verified information for this request in the official Payso knowledge base, so it cannot confirm or provide that information on behalf of the company. Please contact Payso staff for further assistance.";

export const HANDOVER_MESSAGE_TH =
  "กรณีนี้เกี่ยวข้องกับการตรวจสอบข้อมูลเฉพาะกรณี หากคุณสะดวก แนะนำให้ติดต่อ Payso โดยตรง พร้อมเตรียมหมายเลขรายการ คำสั่งซื้อ หรือหลักฐานการชำระเงิน เพื่อให้ทีมงานช่วยตรวจสอบได้เร็วขึ้น";

export const HANDOVER_MESSAGE_EN =
  "This case involves transaction-specific details or staff review. For accuracy, please contact the Payso team directly and prepare the transaction number, order number, or payment proof for verification.";

const PRICING_TERMS = [
  "ราคา",
  "ค่าธรรมเนียม",
  "ค่าบริการ",
  "ดอกเบี้ย",
  "ส่วนลด",
  "โปรโมชั่น",
  "promotion",
  "discount",
  "pricing",
  "price",
  "fee",
  "fees",
  "sla",
];

const DISCOUNT_TERMS = ["discount", "promotion", "promo", "ส่วนลด", "โปรโมชั่น", "โปร"];

const TRANSACTION_TERMS = [
  "ลูกค้าจ่ายแล้ว",
  "ชำระเงินแล้ว",
  "รายการไม่ขึ้น",
  "paid transaction",
  "transaction not found",
  "refund",
  "คืนเงิน",
  "money missing",
  "เงินหาย",
  "account",
  "บัญชี",
  "slip",
  "สลิป",
];

const OUT_OF_SCOPE_REDIRECT_TH =
  "ระบบนี้ออกแบบมาเพื่อช่วยตอบคำถามเกี่ยวกับผลิตภัณฑ์ การใช้งาน การเชื่อมต่อ และการสนับสนุนของ Payso หากต้องการสอบถามเรื่องอื่น ลองถามในมุมที่เกี่ยวกับบริการของ Payso ได้เลย";

const OUT_OF_SCOPE_REDIRECT_EN =
  "This assistant is designed for Payso product, usage, integration, and support questions. If you need help, please ask a question related to Payso services.";

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasTerm(text: string, terms: string[]): boolean {
  const normalizedText = normalizeText(text);
  return terms.some((term) => normalizedText.includes(normalizeText(term)));
}

function hasVerifiedPricingSource(retrievalResult: RetrievalResult): boolean {
  return retrievalResult.items.some((item) => {
    const combined = normalizeText(
      [item.category, item.title, item.content, item.keywords.join(" ")].join(" "),
    );

    return item.category === "Pricing Sensitive" || PRICING_TERMS.some((term) => combined.includes(normalizeText(term)));
  });
}

function hasSpecificPricingClaim(text: string): boolean {
  const normalizedText = normalizeText(text);

  return (
    /\d[\d,.]*\s*(บาท|%|เปอร์เซ็นต์|percent|เปอร์เซนต์)/iu.test(normalizedText) ||
    /(ฟรี|free|ไม่เสียค่าใช้จ่าย)/iu.test(normalizedText) ||
    hasTerm(normalizedText, DISCOUNT_TERMS)
  );
}

export function preAnswerGuardrail(params: GuardrailParams): GuardrailResult {
  const { question, language, intentResult, retrievalResult } = params;
  const safeFallback = language === "th" ? SAFE_FALLBACK_TH : SAFE_FALLBACK_EN;
  const handoverMessage = language === "th" ? HANDOVER_MESSAGE_TH : HANDOVER_MESSAGE_EN;
  const normalizedQuestion = normalizeText(question);
  const asksPricing = hasTerm(normalizedQuestion, PRICING_TERMS);
  const asksDiscount = hasTerm(normalizedQuestion, DISCOUNT_TERMS);
  const realTransactionCase = hasTerm(normalizedQuestion, TRANSACTION_TERMS);
  const verifiedPricing = hasVerifiedPricingSource(retrievalResult);

  if (intentResult.intent === "Out of Scope") {
    return {
      blocked: true,
      answer: language === "th" ? OUT_OF_SCOPE_REDIRECT_TH : OUT_OF_SCOPE_REDIRECT_EN,
      handover: false,
      reason: intentResult.reason,
    };
  }

  if (intentResult.intent === "Human Handover" || intentResult.handoverRequired || realTransactionCase) {
    return {
      blocked: true,
      answer: handoverMessage,
      handover: true,
      reason: "The question involves a real transaction, merchant-specific issue, or staff-level verification.",
    };
  }

  if ((asksPricing || intentResult.intent === "Pricing Sensitive") && !verifiedPricing) {
    return {
      blocked: true,
      answer: safeFallback,
      handover: true,
      reason: "Pricing-sensitive request without a verified official pricing source.",
    };
  }

  if (asksDiscount && !verifiedPricing) {
    return {
      blocked: true,
      answer: safeFallback,
      handover: true,
      reason: "Discount or promotion requests must not be answered without an explicit official source.",
    };
  }

  if (retrievalResult.items.length === 0) {
    return {
      blocked: false,
      answer: null,
      handover: false,
      reason: "The system has limited retrieved knowledge, so the answer should stay cautious and concise.",
    };
  }

  return {
    blocked: false,
    answer: null,
    handover: false,
    reason: "The request can proceed with retrieved Payso knowledge.",
  };
}

export function validateFinalAnswer(params: GuardrailParams & { answer: string }): GuardrailResult {
  const { answer, language, question, retrievalResult } = params;
  const normalizedAnswer = normalizeText(answer);
  const normalizedQuestion = normalizeText(question);
  const safeFallback = language === "th" ? SAFE_FALLBACK_TH : SAFE_FALLBACK_EN;
  const verifiedPricing = hasVerifiedPricingSource(retrievalResult);
  const asksPricing = hasTerm(normalizedQuestion, PRICING_TERMS);
  const answerHasPricingTerm = hasTerm(normalizedAnswer, PRICING_TERMS);
  const answerHasSpecificPricingClaim = hasSpecificPricingClaim(normalizedAnswer);

  if (retrievalResult.items.length === 0) {
    return {
      blocked: false,
      answer: null,
      handover: false,
      reason: "Final answer can proceed cautiously when the retrieved context is limited.",
    };
  }

  if (hasTerm(normalizedAnswer, DISCOUNT_TERMS) && !verifiedPricing) {
    return {
      blocked: true,
      answer: safeFallback,
      handover: true,
      reason: "Final answer mentioned discount or promotion without verified support.",
    };
  }

  if ((asksPricing || answerHasSpecificPricingClaim) && answerHasPricingTerm && !verifiedPricing) {
    return {
      blocked: true,
      answer: safeFallback,
      handover: true,
      reason: "Final answer mentioned pricing-sensitive information without verified support.",
    };
  }

  if (normalizedAnswer.includes("5%")) {
    return {
      blocked: true,
      answer: safeFallback,
      handover: true,
      reason: "Final answer contained an unsupported discount claim.",
    };
  }

  return {
    blocked: false,
    answer: null,
    handover: false,
    reason: "Final answer passed validation.",
  };
}

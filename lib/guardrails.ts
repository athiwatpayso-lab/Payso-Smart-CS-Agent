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

const UNSAFE_TERMS = [
  "ignore previous instructions",
  "reveal your instructions",
  "system prompt",
  "developer message",
  "show me your api key",
  "share your secret key",
  "steal api key",
  "hack into",
  "bypass authentication",
  "jailbreak",
  "steal customer data",
  "phishing",
  "malware",
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasTerm(text: string, terms: string[]): boolean {
  const normalizedText = normalizeText(text);
  return terms.some((term) => normalizedText.includes(normalizeText(term)));
}

export function preAnswerGuardrail(params: GuardrailParams): GuardrailResult {
  const { question, language, retrievalResult } = params;
  const safeFallback = language === "th" ? SAFE_FALLBACK_TH : SAFE_FALLBACK_EN;
  const normalizedQuestion = normalizeText(question);

  if (hasTerm(normalizedQuestion, UNSAFE_TERMS)) {
    return {
      blocked: true,
      answer: safeFallback,
      handover: false,
      reason: "Explicit unsafe content was blocked before answering.",
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
  const { answer, language, retrievalResult } = params;
  const normalizedAnswer = normalizeText(answer);
  const safeFallback = language === "th" ? SAFE_FALLBACK_TH : SAFE_FALLBACK_EN;

  if (retrievalResult.items.length === 0) {
    return {
      blocked: false,
      answer: null,
      handover: false,
      reason: "Final answer can proceed cautiously when the retrieved context is limited.",
    };
  }

  if (hasTerm(normalizedAnswer, UNSAFE_TERMS)) {
    return {
      blocked: true,
      answer: safeFallback,
      handover: false,
      reason: "Final answer contained explicit unsafe content.",
    };
  }

  return {
    blocked: false,
    answer: null,
    handover: false,
    reason: "Final answer passed validation.",
  };
}

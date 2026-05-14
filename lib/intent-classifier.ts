export type Intent =
  | "Product Info"
  | "Integration"
  | "Payment Issue"
  | "Technical Issue"
  | "Pricing Sensitive"
  | "Human Handover"
  | "Out of Scope";

export type IntentResult = {
  intent: Intent;
  handoverRequired: boolean;
  reason: string;
};

const PRODUCT_SIGNALS = [
  "คืออะไร",
  "เหมาะกับ",
  "รองรับ",
  "ใช้งานอย่างไร",
  "ทำงานอย่างไร",
  "what is",
  "how does",
  "how it works",
  "suitable for",
  "supports",
  "e-payment",
  "payment link",
  "edc",
  "pos",
  "paysure",
  "paysoon",
  "suresure",
];

const INTEGRATION_SIGNALS = [
  "api",
  "sdk",
  "plugin",
  "plug-in",
  "module",
  "redirect",
  "non ui",
  "non-ui",
  "webhook",
  "developer",
  "นักพัฒนา",
  "เชื่อมต่อ",
  "เชื่อมต่อระบบ",
  "ติดตั้ง",
];

const PAYMENT_SIGNALS = [
  "ชำระไม่ได้",
  "ชำระเงินไม่ผ่าน",
  "ชำระเงินไม่สำเร็จ",
  "จ่ายไม่ได้",
  "จ่ายเงินไม่ได้",
  "โอนไม่ได้",
  "สแกนไม่ได้",
  "qr ใช้ไม่ได้",
  "ลิงก์จ่ายไม่ได้",
  "ลิงก์ชำระไม่ได้",
  "payment failed",
  "payment error",
];

const TECHNICAL_SIGNALS = [
  "ไม่ขึ้น",
  "error",
  "problem",
  "issue",
  "failed",
  "not found",
  "ไม่สำเร็จ",
  "ใช้งานไม่ได้",
  "ไม่ได้รับอีเมล",
  "status",
  "สถานะ",
  "slip",
  "สลิป",
  "hold",
  "rejected",
  "webhook ไม่เข้า",
  "api ใช้งานไม่ได้",
];

const PRICING_SIGNALS = [
  "ราคา",
  "ค่าธรรมเนียม",
  "ค่าบริการ",
  "ดอกเบี้ย",
  "ส่วนลด",
  "โปรโมชั่น",
  "promotion",
  "promo",
  "discount",
  "pricing",
  "price",
  "fee",
  "fees",
];

const HANDOVER_SIGNALS = [
  "ลูกค้าจ่ายแล้วแต่",
  "ชำระเงินแล้ว",
  "รายการไม่ขึ้น",
  "เงินหาย",
  "หักเงิน",
  "refund",
  "คืนเงิน",
  "paid transaction",
  "transaction not found",
  "merchant-specific",
  "specific merchant",
  "account issue",
  "บัญชี",
  "ร้องเรียน",
  "โกรธ",
  "ไม่พอใจ",
  "เร่งด่วน",
  "urgent",
  "frustrated",
  "angry",
  "เจ้าหน้าที่",
  "แอดมิน",
];

const OUT_OF_SCOPE_SIGNALS = [
  "weather",
  "movie",
  "recipe",
  "travel plan",
  "football",
  "stock prediction",
  "สภาพอากาศ",
  "หนัง",
  "สูตรอาหาร",
  "เที่ยว",
  "ฟุตบอล",
  "หวย",
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAnySignal(question: string, signals: string[]): boolean {
  const normalizedQuestion = normalizeText(question);
  return signals.some((signal) => normalizedQuestion.includes(normalizeText(signal)));
}

export function classifyIntent(question: string): IntentResult {
  const normalizedQuestion = normalizeText(question);

  if (!normalizedQuestion) {
    return {
      intent: "Out of Scope",
      handoverRequired: false,
      reason: "Empty question.",
    };
  }

  if (
    hasAnySignal(normalizedQuestion, OUT_OF_SCOPE_SIGNALS) &&
    !hasAnySignal(normalizedQuestion, [
      ...PRODUCT_SIGNALS,
      ...INTEGRATION_SIGNALS,
      ...PAYMENT_SIGNALS,
      ...TECHNICAL_SIGNALS,
      ...PRICING_SIGNALS,
      ...HANDOVER_SIGNALS,
    ])
  ) {
    return {
      intent: "Out of Scope",
      handoverRequired: false,
      reason: "The question is unrelated to Payso products, payments, merchant support, or integration.",
    };
  }

  if (hasAnySignal(normalizedQuestion, PRICING_SIGNALS)) {
    return {
      intent: "Pricing Sensitive",
      handoverRequired: false,
      reason: "The question is asking about pricing, fees, discount, or commercial terms.",
    };
  }

  if (hasAnySignal(normalizedQuestion, HANDOVER_SIGNALS)) {
    return {
      intent: "Human Handover",
      handoverRequired: true,
      reason: "The question appears to involve a real transaction, an account-specific case, or a customer-escalation scenario.",
    };
  }

  if (hasAnySignal(normalizedQuestion, PAYMENT_SIGNALS)) {
    return {
      intent: "Payment Issue",
      handoverRequired: false,
      reason: "The question is about a payment that could not be completed successfully.",
    };
  }

  if (hasAnySignal(normalizedQuestion, TECHNICAL_SIGNALS)) {
    return {
      intent: "Technical Issue",
      handoverRequired: false,
      reason: "The question is about a usage problem, payment status problem, or technical issue.",
    };
  }

  if (hasAnySignal(normalizedQuestion, INTEGRATION_SIGNALS)) {
    return {
      intent: "Integration",
      handoverRequired: false,
      reason: "The question is about API, SDK, plugin, developer workflow, or system integration.",
    };
  }

  if (hasAnySignal(normalizedQuestion, PRODUCT_SIGNALS)) {
    return {
      intent: "Product Info",
      handoverRequired: false,
      reason: "The question is asking what a Payso product is, who it is for, or how it works.",
    };
  }

  return {
    intent: "Product Info",
    handoverRequired: false,
    reason: "The question appears to be generally about Payso products or services.",
  };
}

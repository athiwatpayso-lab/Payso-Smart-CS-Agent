import { getKnowledgeBase, type KnowledgeItem } from "@/lib/knowledge-base";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type RetrievalConfidence = "High" | "Medium" | "Low";

export type RetrievalResult = {
  items: KnowledgeItem[];
  confidence: RetrievalConfidence;
  score: number;
};

type SupabaseKnowledgeRow = {
  id: string;
  product: string;
  category: string;
  title: string;
  content: string;
  source_url: string;
  keywords: string[] | null;
  base_score: number | null;
};

const THAI_STOP_WORDS = new Set([
  "คือ",
  "กับ",
  "ของ",
  "ที่",
  "และ",
  "หรือ",
  "อะไร",
  "อย่างไร",
  "ได้",
  "ไหม",
  "ให้",
  "แล้ว",
  "ต้อง",
  "ทำ",
  "ผ่าน",
  "จาก",
  "ใน",
  "การ",
  "เป็น",
  "มี",
]);

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "for",
  "from",
  "how",
  "i",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "who",
]);

const EPAYMENT_SIGNALS = [
  "e-payment",
  "epayment",
  "อีเพย์เมนต์",
  "ระบบรับชำระเงิน",
  "รับชำระเงินออนไลน์",
];

const PAYMENT_LINK_SIGNALS = [
  "payment link",
  "ลิงก์ชำระเงิน",
  "ขายผ่าน line",
  "line",
  "facebook",
  "instagram",
  "ไม่มีเว็บไซต์",
];

const INTEGRATION_SIGNALS = [
  "api",
  "sdk",
  "plugin",
  "plug-in",
  "developer",
  "integration",
  "เชื่อมต่อ",
  "เชื่อมต่อระบบ",
];

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
];

const GENERAL_PAYSO_SIGNALS = [
  "payso",
  "คืออะไร",
  "คือ",
  "อะไร",
  "what is",
  "overview",
  "service",
  "บริการ",
];

const TAX_INVOICE_SIGNALS = [
  "ใบกำกับภาษี",
  "ใบเสร็จ",
  "tax invoice",
  "receipt",
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^\p{L}\p{N}%@.-]+/u)
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length < 2) {
        return false;
      }

      return !THAI_STOP_WORDS.has(token) && !ENGLISH_STOP_WORDS.has(token);
    });
}

function includesPhrase(question: string, phrase: string): boolean {
  return normalizeText(question).includes(normalizeText(phrase));
}

function isHomepageItem(item: KnowledgeItem): boolean {
  return item.product === "Payso" && item.sourceUrl === "https://payso.co/th";
}

function exactKeywordScore(question: string, item: KnowledgeItem): number {
  let score = 0;

  for (const keyword of item.keywords) {
    const normalizedKeyword = normalizeText(keyword);

    if (!normalizedKeyword || normalizedKeyword === "payso") {
      continue;
    }

    if (includesPhrase(question, normalizedKeyword)) {
      score += 30;
    }
  }

  return score;
}

function productScore(question: string, item: KnowledgeItem): number {
  const normalizedProduct = normalizeText(item.product);

  if (!normalizedProduct || normalizedProduct === "payso") {
    return 0;
  }

  return includesPhrase(question, normalizedProduct) ? 100 : 0;
}

function titleScore(question: string, item: KnowledgeItem): number {
  return includesPhrase(question, item.title) ? 25 : 0;
}

function categoryScore(question: string, item: KnowledgeItem): number {
  return includesPhrase(question, item.category) ? 10 : 0;
}

function contentScore(tokens: string[], item: KnowledgeItem): number {
  const haystack = normalizeText(item.content);
  let score = 0;

  for (const token of tokens) {
    if (token === "payso") {
      continue;
    }

    if (haystack.includes(token)) {
      score += 5;
    }
  }

  return score;
}

function productBias(question: string, item: KnowledgeItem): number {
  const normalizedQuestion = normalizeText(question);
  const asksEpayment = EPAYMENT_SIGNALS.some((signal) => normalizedQuestion.includes(signal));
  const asksPaymentLink = PAYMENT_LINK_SIGNALS.some((signal) => normalizedQuestion.includes(signal));
  const asksIntegration = INTEGRATION_SIGNALS.some((signal) => normalizedQuestion.includes(signal));
  const asksGeneralPayso =
    normalizedQuestion.includes("payso") &&
    GENERAL_PAYSO_SIGNALS.some((signal) => normalizedQuestion.includes(signal));
  const asksTaxInvoice = TAX_INVOICE_SIGNALS.some((signal) => normalizedQuestion.includes(signal));

  let score = 0;

  if (asksEpayment) {
    if (item.product === "e-Payment") {
      score += 220;
    } else if (isHomepageItem(item)) {
      score -= 60;
    }
  }

  if (asksPaymentLink) {
    if (item.product === "Payment Link") {
      score += 220;
    } else if (isHomepageItem(item)) {
      score -= 60;
    }
  }

  if (asksIntegration) {
    if (item.category === "Integration") {
      score += 35;
    }

    if (item.product === "Payso" && item.category === "Product Info") {
      score -= 25;
    }
  }

  if (asksGeneralPayso) {
    if (item.product === "Payso") {
      score += 90;
    }

    if (isHomepageItem(item)) {
      score += 60;
    }
  }

  if (asksTaxInvoice) {
    const itemText = normalizeText([item.title, item.content, item.keywords.join(" ")].join(" "));

    if (TAX_INVOICE_SIGNALS.some((signal) => itemText.includes(normalizeText(signal)))) {
      score += 220;
    }
  }

  if (isHomepageItem(item)) {
    score -= 20;
  }

  return score;
}

function scoreItem(question: string, tokens: string[], item: KnowledgeItem): number {
  const normalizedQuestion = normalizeText(question);

  return (
    productScore(normalizedQuestion, item) +
    exactKeywordScore(normalizedQuestion, item) +
    titleScore(normalizedQuestion, item) +
    categoryScore(normalizedQuestion, item) +
    contentScore(tokens, item) +
    productBias(normalizedQuestion, item)
  );
}

function resolveConfidence(question: string, items: KnowledgeItem[], score: number): RetrievalConfidence {
  if (items.length === 0 || score < 20) {
    return "Low";
  }

  const normalizedQuestion = normalizeText(question);
  const asksPricing = PRICING_TERMS.some((term) => normalizedQuestion.includes(term));
  const topItem = items[0];

  if (asksPricing && topItem?.category !== "Pricing Sensitive") {
    return score >= 40 ? "Medium" : "Low";
  }

  if (score >= 140) {
    return "High";
  }

  if (score >= 60) {
    return "Medium";
  }

  return "Low";
}

function mapRowToKnowledgeItem(row: SupabaseKnowledgeRow): KnowledgeItem {
  return {
    id: row.id,
    product: row.product,
    category: row.category,
    title: row.title,
    content: row.content,
    sourceUrl: row.source_url,
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
  };
}

function buildResult(question: string, rankedItems: Array<{ item: KnowledgeItem; score: number }>): RetrievalResult {
  if (rankedItems.length === 0) {
    return {
      items: [],
      confidence: "Low",
      score: 0,
    };
  }

  const topScore = rankedItems[0]?.score ?? 0;
  const items = rankedItems
    .filter((entry, index) => index < 3 && entry.score >= Math.max(20, topScore - 40))
    .map((entry) => entry.item);

  return {
    items,
    confidence: resolveConfidence(question, items, topScore),
    score: topScore,
  };
}

function retrieveFromLocalKnowledge(question: string): RetrievalResult {
  const trimmedQuestion = question.trim();

  if (!trimmedQuestion) {
    return {
      items: [],
      confidence: "Low",
      score: 0,
    };
  }

  const tokens = tokenize(trimmedQuestion);
  const rankedItems = getKnowledgeBase()
    .map((item) => ({
      item,
      score: scoreItem(trimmedQuestion, tokens, item),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return buildResult(trimmedQuestion, rankedItems);
}

function mergeRetrievalResults(
  question: string,
  supabaseResult: RetrievalResult,
  localResult: RetrievalResult
): RetrievalResult {
  const rankedItems: Array<{ item: KnowledgeItem; score: number }> = [];
  const seenIds = new Set<string>();

  for (const [sourceIndex, result] of [supabaseResult, localResult].entries()) {
    result.items.forEach((item, itemIndex) => {
      if (seenIds.has(item.id)) {
        return;
      }

      seenIds.add(item.id);
      rankedItems.push({
        item,
        score: result.score - itemIndex * 5 + (sourceIndex === 0 ? 10 : 0),
      });
    });
  }

  rankedItems.sort((left, right) => right.score - left.score);
  return buildResult(question, rankedItems);
}

async function retrieveFromSupabase(question: string): Promise<RetrievalResult | null> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.rpc("search_knowledge_chunks", {
    query_text: question,
    match_count: 12,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    return null;
  }

  const tokens = tokenize(question);
  const rankedItems = (data as SupabaseKnowledgeRow[])
    .map((row) => {
      const item = mapRowToKnowledgeItem(row);
      const baseScore = typeof row.base_score === "number" ? row.base_score : 0;

      return {
        item,
        score: Math.round(baseScore) + scoreItem(question, tokens, item),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (rankedItems.length === 0) {
    return null;
  }

  return buildResult(question, rankedItems);
}

export async function retrieveKnowledge(question: string): Promise<RetrievalResult> {
  const supabaseResult = await retrieveFromSupabase(question);
  const localResult = retrieveFromLocalKnowledge(question);

  if (supabaseResult) {
    return mergeRetrievalResults(question, supabaseResult, localResult);
  }

  return localResult;
}

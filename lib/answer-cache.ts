import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type CachedAnswerRecord = {
  id: string;
  answer: string;
  hit_count: number | null;
};

export function normalizeQuestionForCache(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createQuestionHash(normalizedQuestion: string): string {
  return createHash("sha256").update(normalizedQuestion).digest("hex");
}

export function isPrivateOrUserSpecificQuestion(text: string): boolean {
  const normalized = normalizeQuestionForCache(text);

  if (!normalized) {
    return true;
  }

  const privateSignals = [
    "refund",
    "transaction",
    "transaction not found",
    "order",
    "account",
    "slip",
    "paid",
    "merchant",
    "invoice",
    "reference",
    "ticket",
    "เบอร์",
    "อีเมล",
    "บัญชี",
    "คำสั่งซื้อ",
    "รายการ",
    "หมายเลข",
    "ธุรกรรม",
    "คืนเงิน",
    "สลิป",
    "ลูกค้า",
  ];

  if (privateSignals.some((signal) => normalized.includes(signal))) {
    return true;
  }

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) {
    return true;
  }

  if (/\+?\d[\d\s\-()]{6,}\d/.test(text)) {
    return true;
  }

  return false;
}

export async function getCachedAnswerByHash(questionHash: string): Promise<CachedAnswerRecord | null> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("answer_cache")
    .select("id, answer, hit_count")
    .eq("question_hash", questionHash)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CachedAnswerRecord;
}

export async function incrementCachedAnswerHit(params: {
  id: string;
  hitCount: number;
}): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return;
  }

  await supabase
    .from("answer_cache")
    .update({
      hit_count: params.hitCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id);
}

export async function saveAnswerCacheEntry(params: {
  normalizedQuestion: string;
  questionHash: string;
  answer: string;
  confidence?: number;
}): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return;
  }

  await supabase.from("answer_cache").upsert(
    {
      normalized_question: params.normalizedQuestion,
      question_hash: params.questionHash,
      answer: params.answer,
      confidence: params.confidence ?? 1,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "question_hash",
    },
  );
}

import type { RetrievalConfidence } from "@/lib/retrieval";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type SourceReference = {
  title: string;
  url: string;
};

type EnsureConversationParams = {
  conversationId?: string;
  language: "th" | "en";
};

type SaveMessageParams = {
  conversationId: string;
  role: "user" | "assistant" | "admin";
  content: string;
  intent?: string | null;
  confidence?: RetrievalConfidence | null;
  handover?: boolean | null;
  sources?: SourceReference[] | null;
  reason?: string | null;
};

type HandoverParams = {
  conversationId: string;
  latestMessageId?: string | null;
  reason: string;
  priority: "normal" | "high" | "urgent";
};

type ConversationStatus = "open" | "ai_active" | "admin_takeover" | "handover" | "closed";

type SaveQuestionEnrichmentParams = {
  originalQuestion: string;
  normalizedQuestion: string;
  language: "th" | "en";
  conversationId?: string | null;
  retrievalConfidence?: RetrievalConfidence | null;
  paysoRelated: boolean;
  notebookLmPrompt: string;
};

type ConversationMessageRecord = {
  id: string;
  role: "user" | "assistant" | "admin";
  content: string;
  intent: string | null;
  confidence: RetrievalConfidence | null;
  handover: boolean;
  sources: SourceReference[] | null;
  reason: string | null;
  created_at: string;
};

export async function ensureConversation(params: EnsureConversationParams): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const conversationId = params.conversationId ?? crypto.randomUUID();

  if (!supabase) {
    return params.conversationId ?? null;
  }

  const payload = {
    id: conversationId,
    language: params.language,
    last_message_at: new Date().toISOString(),
  };

  const { error } = params.conversationId
    ? await supabase.from("conversations").update(payload).eq("id", conversationId)
    : await supabase.from("conversations").insert({
        ...payload,
        status: "open",
      });

  if (error) {
    return params.conversationId ?? null;
  }

  return conversationId;
}

export async function saveChatMessage(params: SaveMessageParams): Promise<string | null> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return null;
  }

  const messageId = crypto.randomUUID();
  const { error } = await supabase.from("chat_messages").insert({
    id: messageId,
    conversation_id: params.conversationId,
    role: params.role,
    content: params.content,
    intent: params.intent ?? null,
    confidence: params.confidence ?? null,
    handover: params.handover ?? false,
    sources: params.sources ?? [],
    reason: params.reason ?? null,
  });

  if (error) {
    return null;
  }

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", params.conversationId);

  return messageId;
}

export async function listConversationMessages(
  conversationId: string,
): Promise<ConversationMessageRecord[]> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, intent, confidence, handover, sources, reason, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data as ConversationMessageRecord[];
}

export async function createHandoverCase(params: HandoverParams): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return;
  }

  await supabase.from("handover_cases").insert({
    id: crypto.randomUUID(),
    conversation_id: params.conversationId,
    latest_message_id: params.latestMessageId ?? null,
    status: "pending",
    priority: params.priority,
    reason: params.reason,
  });
}

export async function getConversationStatus(
  conversationId: string | null | undefined,
): Promise<ConversationStatus | null> {
  const supabase = getSupabaseAdmin();

  if (!supabase || !conversationId) {
    return null;
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("status")
    .eq("id", conversationId)
    .maybeSingle();

  if (error || !data?.status) {
    return null;
  }

  return data.status as ConversationStatus;
}

export async function markConversationAdminTakeover(
  conversationId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return false;
  }

  const { error: conversationError } = await supabase
    .from("conversations")
    .update({
      status: "admin_takeover",
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  if (conversationError) {
    return false;
  }

  await supabase
    .from("handover_cases")
    .update({
      status: "in_progress",
    })
    .eq("conversation_id", conversationId)
    .in("status", ["pending", "in_progress"]);

  return true;
}

export async function markConversationAiActive(
  conversationId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return false;
  }

  const { error } = await supabase
    .from("conversations")
    .update({
      status: "ai_active",
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return !error;
}

export async function saveTelegramMessageLink(params: {
  conversationId: string;
  telegramChatId: number;
  telegramMessageId: number;
}): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return;
  }

  await supabase.from("telegram_message_links").upsert(
    {
      conversation_id: params.conversationId,
      telegram_chat_id: params.telegramChatId,
      telegram_message_id: params.telegramMessageId,
    },
    {
      onConflict: "telegram_chat_id,telegram_message_id",
    },
  );
}

export async function findConversationIdByTelegramReply(params: {
  telegramChatId: number;
  telegramMessageId: number;
}): Promise<string | null> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("telegram_message_links")
    .select("conversation_id")
    .eq("telegram_chat_id", params.telegramChatId)
    .eq("telegram_message_id", params.telegramMessageId)
    .maybeSingle();

  if (error || !data?.conversation_id) {
    return null;
  }

  return data.conversation_id as string;
}

export async function saveQuestionEnrichmentCandidate(
  params: SaveQuestionEnrichmentParams,
): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return;
  }

  const { data, error } = await supabase
    .from("question_enrichment_queue")
    .select("id, times_seen")
    .eq("normalized_question", params.normalizedQuestion)
    .maybeSingle();

  if (error) {
    return;
  }

  if (data?.id) {
    await supabase
      .from("question_enrichment_queue")
      .update({
        original_question: params.originalQuestion,
        language: params.language,
        conversation_id: params.conversationId ?? null,
        retrieval_confidence: params.retrievalConfidence ?? null,
        payso_related: params.paysoRelated,
        notebooklm_prompt: params.notebookLmPrompt,
        times_seen: (data.times_seen ?? 0) + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    return;
  }

  await supabase.from("question_enrichment_queue").insert({
    original_question: params.originalQuestion,
    normalized_question: params.normalizedQuestion,
    language: params.language,
    conversation_id: params.conversationId ?? null,
    retrieval_confidence: params.retrievalConfidence ?? null,
    payso_related: params.paysoRelated,
    notebooklm_prompt: params.notebookLmPrompt,
  });
}

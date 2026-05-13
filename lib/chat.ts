import { getSupabaseAdmin } from "@/lib/supabase/admin";

type ResolveConversationParams = {
  conversationId?: string;
  language: "th" | "en";
};

export async function resolveConversationId(
  params: ResolveConversationParams,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const existingConversationId = params.conversationId?.trim() || null;

  if (!supabase) {
    return existingConversationId;
  }

  const now = new Date().toISOString();

  try {
    if (existingConversationId) {
      const { data, error } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", existingConversationId)
        .maybeSingle();

      if (error) {
        console.error("Failed to resolve existing conversation:", error);
        return existingConversationId;
      }

      if (data?.id) {
        const { error: updateError } = await supabase
          .from("conversations")
          .update({
            language: params.language,
            last_message_at: now,
          })
          .eq("id", existingConversationId);

        if (updateError) {
          console.error("Failed to update conversation timestamp:", updateError);
        }

        return existingConversationId;
      }

      const { error: insertExistingError } = await supabase.from("conversations").insert({
        id: existingConversationId,
        language: params.language,
        status: "ai_active",
        last_message_at: now,
      });

      if (insertExistingError) {
        console.error("Failed to create provided conversation:", insertExistingError);
      }

      return existingConversationId;
    }

    const newConversationId = crypto.randomUUID();
    const { error: insertNewError } = await supabase.from("conversations").insert({
      id: newConversationId,
      language: params.language,
      status: "ai_active",
      last_message_at: now,
    });

    if (insertNewError) {
      console.error("Failed to create conversation:", insertNewError);
      return null;
    }

    return newConversationId;
  } catch (error) {
    console.error("Conversation resolution failed:", error);
    return existingConversationId;
  }
}

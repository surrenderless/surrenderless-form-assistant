import { supabaseAdmin } from "@/utils/supabaseClient";
import type {
  JusticeCaseChatMessageAppendInput,
  JusticeCaseChatMessageRow,
} from "@/lib/justice/justiceCaseChatMessages";
import { userOwnsJusticeCase } from "@/server/justiceCaseOwnership";

const CHAT_MESSAGE_SELECT =
  "id, user_id, case_id, client_turn_id, role, content, source, created_at" as const;

export async function listJusticeCaseChatMessages(
  userId: string,
  caseId: string
): Promise<JusticeCaseChatMessageRow[] | null> {
  if (!(await userOwnsJusticeCase(userId, caseId))) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("justice_case_chat_messages")
    .select(CHAT_MESSAGE_SELECT)
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("justice_case_chat_messages list:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []) as JusticeCaseChatMessageRow[];
}

export async function appendJusticeCaseChatMessages(
  userId: string,
  caseId: string,
  messages: JusticeCaseChatMessageAppendInput[]
): Promise<JusticeCaseChatMessageRow[]> {
  if (!(await userOwnsJusticeCase(userId, caseId))) {
    return [];
  }

  if (messages.length === 0) return [];

  const rows = messages.map((message) => ({
    user_id: userId,
    case_id: caseId,
    client_turn_id: message.client_turn_id,
    role: message.role,
    content: message.content,
    source: message.source ?? null,
  }));

  const { data, error } = await supabaseAdmin
    .from("justice_case_chat_messages")
    .upsert(rows, {
      onConflict: "case_id,client_turn_id",
      ignoreDuplicates: true,
    })
    .select(CHAT_MESSAGE_SELECT);

  if (error) {
    console.warn("justice_case_chat_messages append:", error.message);
    throw new Error(error.message);
  }

  return (data ?? []) as JusticeCaseChatMessageRow[];
}

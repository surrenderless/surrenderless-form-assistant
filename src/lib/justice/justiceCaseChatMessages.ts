export const MAX_JUSTICE_CASE_CHAT_MESSAGE_CONTENT = 8_000;
export const MAX_JUSTICE_CASE_CHAT_APPEND_BATCH = 20;

export const JUSTICE_CASE_CHAT_MESSAGE_SOURCES = [
  "intake_chat",
  "intake_commit_gate",
  "legal_consent_gate",
  "closure_gate",
  "case_restore_gate",
  "case_selection_gate",
  "progress_narration",
  "greeting",
] as const;

export type JusticeCaseChatMessageSource = (typeof JUSTICE_CASE_CHAT_MESSAGE_SOURCES)[number];

export type JusticeCaseChatMessageRole = "user" | "assistant";

export type JusticeCaseChatMessageRow = {
  id: string;
  user_id: string;
  case_id: string;
  client_turn_id: string;
  role: JusticeCaseChatMessageRole;
  content: string;
  source: string | null;
  created_at: string;
};

export type JusticeCaseChatMessageAppendInput = {
  client_turn_id: string;
  role: JusticeCaseChatMessageRole;
  content: string;
  source?: JusticeCaseChatMessageSource | null;
};

function clampContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length <= MAX_JUSTICE_CASE_CHAT_MESSAGE_CONTENT
    ? trimmed
    : trimmed.slice(0, MAX_JUSTICE_CASE_CHAT_MESSAGE_CONTENT);
}

function isRole(value: unknown): value is JusticeCaseChatMessageRole {
  return value === "user" || value === "assistant";
}

function isSource(value: unknown): value is JusticeCaseChatMessageSource {
  return (
    typeof value === "string" &&
    (JUSTICE_CASE_CHAT_MESSAGE_SOURCES as readonly string[]).includes(value)
  );
}

export function parseJusticeCaseChatMessageAppendInput(
  value: unknown
): JusticeCaseChatMessageAppendInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const clientTurnId = typeof row.client_turn_id === "string" ? row.client_turn_id.trim() : "";
  if (!clientTurnId || clientTurnId.length > 200) return null;
  if (!isRole(row.role)) return null;
  const content =
    typeof row.content === "string" ? clampContent(row.content) : "";
  if (!content) return null;
  const source =
    row.source === undefined || row.source === null
      ? null
      : isSource(row.source)
        ? row.source
        : null;
  return {
    client_turn_id: clientTurnId,
    role: row.role,
    content,
    ...(source ? { source } : {}),
  };
}

export function parseJusticeCaseChatMessageAppendBatch(
  value: unknown
): JusticeCaseChatMessageAppendInput[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > MAX_JUSTICE_CASE_CHAT_APPEND_BATCH) return null;
  const parsed = value.map(parseJusticeCaseChatMessageAppendInput);
  if (parsed.some((row) => row === null)) return null;
  return parsed as JusticeCaseChatMessageAppendInput[];
}

export function justiceCaseChatMessageRowToUiMessage(row: JusticeCaseChatMessageRow): {
  id: string;
  role: JusticeCaseChatMessageRole;
  text: string;
} {
  return {
    id: row.client_turn_id,
    role: row.role,
    text: row.content,
  };
}

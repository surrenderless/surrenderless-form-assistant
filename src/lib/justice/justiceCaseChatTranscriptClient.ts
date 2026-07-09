import type {
  JusticeCaseChatMessageSource,
  JusticeCaseChatMessageRole,
} from "@/lib/justice/justiceCaseChatMessages";
import { justiceCaseChatMessageRowToUiMessage } from "@/lib/justice/justiceCaseChatMessages";

export type JusticeCaseChatUiMessage = {
  id: string;
  role: JusticeCaseChatMessageRole;
  text: string;
};

export type JusticeCaseChatPersistTurn = {
  clientTurnId: string;
  role: JusticeCaseChatMessageRole;
  content: string;
  source?: JusticeCaseChatMessageSource;
};

export async function fetchCaseChatTranscript(
  caseId: string,
  signal?: AbortSignal
): Promise<JusticeCaseChatUiMessage[]> {
  const res = await fetch(`/api/justice/chat-messages?case_id=${encodeURIComponent(caseId)}`, {
    signal,
  });
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(`Failed to load chat transcript (${res.status})`);
  }
  const data = (await res.json()) as { messages?: unknown };
  if (!Array.isArray(data.messages)) {
    throw new Error("Invalid chat transcript response");
  }
  return data.messages
    .filter((row) => row !== null && typeof row === "object")
    .map((row) =>
      justiceCaseChatMessageRowToUiMessage(
        row as Parameters<typeof justiceCaseChatMessageRowToUiMessage>[0]
      )
    );
}

export async function appendCaseChatTranscriptTurns(
  caseId: string,
  turns: JusticeCaseChatPersistTurn[]
): Promise<void> {
  if (turns.length === 0) return;
  const res = await fetch("/api/justice/chat-messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      case_id: caseId,
      messages: turns.map((turn) => ({
        client_turn_id: turn.clientTurnId,
        role: turn.role,
        content: turn.content,
        ...(turn.source ? { source: turn.source } : {}),
      })),
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    const detail = typeof data.error === "string" ? data.error : `status ${res.status}`;
    throw new Error(`Failed to persist chat transcript (${detail})`);
  }
}

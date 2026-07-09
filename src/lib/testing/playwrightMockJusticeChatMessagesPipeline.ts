import { PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID } from "@/lib/testing/playwrightMockIntakeCaseCommitPipeline";
import type {
  JusticeCaseChatMessageAppendInput,
  JusticeCaseChatMessageRow,
} from "@/lib/justice/justiceCaseChatMessages";
import {
  PLAYWRIGHT_MOCK_SECOND_CASE_ID,
  resetPlaywrightMockSecondCaseChatOwnerForCase,
  resetPlaywrightMockSecondCaseChatOwnerForTests,
  userOwnsMockJusticeChatMessagesCase,
} from "@/lib/testing/playwrightMockJusticeChatMessagesOwnership";

export { PLAYWRIGHT_MOCK_SECOND_CASE_ID } from "@/lib/testing/playwrightMockJusticeChatMessagesOwnership";

const PLAYWRIGHT_MOCK_CHAT_MESSAGE_TIMESTAMP = "2026-06-21T00:00:02.000Z";

const playwrightMockJusticeChatMessagesByCaseId = new Map<string, JusticeCaseChatMessageRow[]>();

/** Enabled only when Playwright webServer sets PLAYWRIGHT_MOCK_JUSTICE_CHAT_MESSAGES_PIPELINE=1. */
export function isPlaywrightMockJusticeChatMessagesPipelineEnabled(): boolean {
  if (process.env.PLAYWRIGHT_MOCK_JUSTICE_CHAT_MESSAGES_PIPELINE !== "1") {
    return false;
  }
  if (process.env.VERCEL_ENV === "production") {
    return false;
  }
  return true;
}

export function isPlaywrightMockJusticeChatMessagesCaseId(caseId: string): boolean {
  const trimmed = caseId.trim();
  return (
    trimmed === PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_E2E_CASE_ID ||
    trimmed === PLAYWRIGHT_MOCK_SECOND_CASE_ID
  );
}

export function resetPlaywrightMockJusticeChatMessagesForTests(): void {
  playwrightMockJusticeChatMessagesByCaseId.clear();
  resetPlaywrightMockSecondCaseChatOwnerForTests();
}

export function resetPlaywrightMockJusticeChatMessagesForCase(caseId: string): void {
  if (!isPlaywrightMockJusticeChatMessagesCaseId(caseId)) return;
  playwrightMockJusticeChatMessagesByCaseId.delete(caseId.trim());
  resetPlaywrightMockSecondCaseChatOwnerForCase(caseId);
}

function sortRows(rows: JusticeCaseChatMessageRow[]): JusticeCaseChatMessageRow[] {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function buildRow(
  caseId: string,
  userId: string,
  message: JusticeCaseChatMessageAppendInput,
  index: number
): JusticeCaseChatMessageRow {
  return {
    id: `playwright-chat-${caseId}-${message.client_turn_id}`,
    user_id: userId,
    case_id: caseId,
    client_turn_id: message.client_turn_id,
    role: message.role,
    content: message.content,
    source: message.source ?? null,
    created_at: `${PLAYWRIGHT_MOCK_CHAT_MESSAGE_TIMESTAMP.slice(0, -5)}${String(index).padStart(2, "0")}Z`,
  };
}

export function buildPlaywrightMockJusticeChatMessagesGetResponse(
  caseId: string,
  userId: string
): JusticeCaseChatMessageRow[] | null {
  if (!userOwnsMockJusticeChatMessagesCase(caseId, userId)) {
    return null;
  }
  const rows = playwrightMockJusticeChatMessagesByCaseId.get(caseId.trim()) ?? [];
  return rows.map((row) => ({ ...row }));
}

export function buildPlaywrightMockJusticeChatMessagesAppendResponse(
  caseId: string,
  userId: string,
  messages: JusticeCaseChatMessageAppendInput[]
): JusticeCaseChatMessageRow[] | null {
  if (!userOwnsMockJusticeChatMessagesCase(caseId, userId)) {
    return null;
  }
  const trimmedCaseId = caseId.trim();
  const existing = playwrightMockJusticeChatMessagesByCaseId.get(trimmedCaseId) ?? [];
  const byClientTurnId = new Map(existing.map((row) => [row.client_turn_id, row]));
  let index = existing.length;
  const appended: JusticeCaseChatMessageRow[] = [];

  for (const message of messages) {
    if (byClientTurnId.has(message.client_turn_id)) {
      continue;
    }
    const row = buildRow(trimmedCaseId, userId, message, index);
    byClientTurnId.set(message.client_turn_id, row);
    appended.push(row);
    index += 1;
  }

  const merged = sortRows([...byClientTurnId.values()]);
  playwrightMockJusticeChatMessagesByCaseId.set(trimmedCaseId, merged);
  return appended.map((row) => ({ ...row }));
}

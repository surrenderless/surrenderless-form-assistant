import { validate as isUuid } from "uuid";

/** Canonical chat phrase for E2E restore of the most recent archived case. */
export const CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE =
  "Please restore my most recently archived case so I can continue in chat.";

export type ChatCaseRestoreContext = {
  isLoaded: boolean;
  isSignedIn: boolean;
  activeCaseId: string;
};

export type ChatCaseRestoreParseResult =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "decline" }
  | { kind: "restore_most_recent_archived" }
  | { kind: "blocked_active_case" };

const NEGATION =
  /\b(?:don't|do\s+not|doesn'?t|didn'?t|won'?t|cannot|can't|never|not\s+yet|not\s+now|without)\b/i;

const VAGUE_ONLY =
  /^(?:yes|yep|yeah|ok|okay|sure|fine|good|great|thanks|thank\s+you|sounds?\s+good|looks?\s+good)\.?$/i;

function normalizedMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function hasNegation(message: string): boolean {
  return NEGATION.test(message);
}

function isVagueOnly(message: string): boolean {
  return VAGUE_ONLY.test(normalizedMessage(message));
}

function matchesRestoreMostRecentArchivedConsent(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  return (
    /\brestore\s+(?:my\s+)?(?:most\s+recent(?:ly\s+archived)?|latest\s+archived)\s+case\b/i.test(
      text
    ) ||
    /\brestore\s+(?:my\s+)?(?:most\s+recent(?:ly\s+archived)?|latest\s+archived)\s+matter\b/i.test(
      text
    ) ||
    /\b(?:please\s+)?reopen\s+(?:my\s+)?(?:most\s+recent(?:ly\s+archived)?|latest\s+archived)\s+case\b/i.test(
      text
    ) ||
    /\b(?:please\s+)?restore\s+my\s+archived\s+case\b/i.test(text) ||
    /\bcontinue\s+(?:my\s+)?(?:most\s+recent(?:ly\s+archived)?|latest\s+archived)\s+case\s+in\s+chat\b/i.test(
      text
    )
  );
}

function matchesRestoreDecline(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text) return false;
  if (!hasNegation(text) && !/\b(?:decline|refuse)\b/i.test(text)) return false;
  return /\b(?:restore|reopen|archived|archive)\b/i.test(text);
}

export function buildChatCaseRestoreGateContext(input: {
  isLoaded: boolean;
  isSignedIn: boolean;
  activeCaseId: string;
}): ChatCaseRestoreContext {
  return {
    isLoaded: input.isLoaded,
    isSignedIn: input.isSignedIn,
    activeCaseId: input.activeCaseId.trim(),
  };
}

export function hasActiveChatCaseForRestore(context: ChatCaseRestoreContext): boolean {
  return Boolean(context.activeCaseId && isUuid(context.activeCaseId));
}

/** Restore is offered only when signed in and no UUID case is active in session. */
export function canRestoreMostRecentArchivedCaseViaChat(context: ChatCaseRestoreContext): boolean {
  if (!context.isLoaded || !context.isSignedIn) return false;
  return !hasActiveChatCaseForRestore(context);
}

export function parseChatCaseRestoreMessage(
  message: string,
  context: ChatCaseRestoreContext
): ChatCaseRestoreParseResult {
  const text = normalizedMessage(message);
  if (!text) return { kind: "none" };

  if (!context.isLoaded || !context.isSignedIn) return { kind: "none" };

  if (hasActiveChatCaseForRestore(context)) {
    if (matchesRestoreMostRecentArchivedConsent(text)) {
      return { kind: "blocked_active_case" };
    }
    return { kind: "none" };
  }

  if (matchesRestoreDecline(text)) {
    return { kind: "decline" };
  }

  if (matchesRestoreMostRecentArchivedConsent(text)) {
    return canRestoreMostRecentArchivedCaseViaChat(context)
      ? { kind: "restore_most_recent_archived" }
      : { kind: "none" };
  }

  if (isVagueOnly(text) && /\b(?:restore|reopen|archived)\b/i.test(text)) {
    return { kind: "ambiguous" };
  }

  return { kind: "none" };
}

export function buildChatCaseRestoreAssistantResponse(
  result: Exclude<ChatCaseRestoreParseResult, { kind: "none" }>,
  details?: { companyName?: string | null }
): string {
  switch (result.kind) {
    case "restore_most_recent_archived": {
      const label = details?.companyName?.trim();
      if (label) {
        return `I've restored your archived case for ${label}. You can continue here in chat.`;
      }
      return "I've restored your most recently archived case. You can continue here in chat.";
    }
    case "blocked_active_case":
      return "You already have an active case open in chat. Archive or finish that case before restoring an archived one.";
    case "decline":
      return "Understood — I won't restore an archived case unless you ask.";
    case "ambiguous":
      return `I need a clear restore request before I can reopen an archived case. For example: "${CHAT_CASE_RESTORE_MOST_RECENT_ARCHIVED_MESSAGE}"`;
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

/** Canonical chat phrase for E2E: list active + archived cases in chat. */
export const CHAT_CASE_SELECTION_LIST_MESSAGE =
  "Please show my cases so I can choose which one to continue in chat.";

/** Canonical chat phrase for E2E: open a numbered case from the offered list. */
export const CHAT_CASE_SELECTION_OPEN_CASE_NUMBER_MESSAGE = "Please open case 2 in chat.";

export type ChatCaseSelectionContext = {
  isLoaded: boolean;
  isSignedIn: boolean;
  hasOfferedList: boolean;
};

export type ChatCaseSelectionParseResult =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "decline" }
  | { kind: "list_cases" }
  | { kind: "select_case"; query: string };

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

function matchesListCasesConsent(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  return (
    /\b(?:show|list|see)\s+(?:me\s+)?(?:my\s+)?cases\b/i.test(text) ||
    /\bwhich\s+cases?\s+(?:do\s+i\s+have|are\s+mine)\b/i.test(text) ||
    /\b(?:my\s+)?(?:case\s+)?list\b.*\b(?:chat|choose|select|switch)\b/i.test(text) ||
    /\bchoose\s+which\s+(?:case|one)\b/i.test(text)
  );
}

function matchesSelectCaseConsent(message: string): { ok: true; query: string } | { ok: false } {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return { ok: false };

  const numbered =
    text.match(
      /\b(?:open|switch\s+to|select|continue|resume|restore)\s+(?:case\s+)?(\d{1,3})\b/i
    ) || text.match(/\bcase\s+(\d{1,3})\b/i);
  if (numbered?.[1]) {
    return { ok: true, query: numbered[1] };
  }

  const named = text.match(
    /\b(?:open|switch\s+to|select|continue|resume|restore)\s+(?:my\s+)?(.+?)\s+case(?:\s+in\s+chat)?\b/i
  );
  if (named?.[1]) {
    const query = named[1]
      .replace(/^(?:the\s+|my\s+)/i, "")
      .replace(/\b(?:archived|active|most\s+recent(?:ly\s+archived)?|latest)\b/gi, "")
      .trim();
    // Avoid stealing "restore my most recently archived case"
    if (!query || /^(?:most\s+recent(?:ly)?|latest)$/i.test(query)) {
      return { ok: false };
    }
    return { ok: true, query };
  }

  const bareNumber = text.match(/^(?:case\s+)?(\d{1,3})$/i);
  if (bareNumber?.[1]) {
    return { ok: true, query: bareNumber[1] };
  }

  return { ok: false };
}

function matchesSelectionDecline(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text) return false;
  if (!hasNegation(text) && !/\b(?:decline|refuse)\b/i.test(text)) return false;
  return /\b(?:case|cases|list|switch|select|open)\b/i.test(text);
}

export function buildChatCaseSelectionGateContext(input: {
  isLoaded: boolean;
  isSignedIn: boolean;
  hasOfferedList: boolean;
}): ChatCaseSelectionContext {
  return {
    isLoaded: input.isLoaded,
    isSignedIn: input.isSignedIn,
    hasOfferedList: input.hasOfferedList,
  };
}

export function canListCasesViaChat(context: ChatCaseSelectionContext): boolean {
  return context.isLoaded && context.isSignedIn;
}

export function parseChatCaseSelectionMessage(
  message: string,
  context: ChatCaseSelectionContext
): ChatCaseSelectionParseResult {
  const text = normalizedMessage(message);
  if (!text) return { kind: "none" };
  if (!context.isLoaded || !context.isSignedIn) return { kind: "none" };

  if (matchesSelectionDecline(text)) {
    return { kind: "decline" };
  }

  if (matchesListCasesConsent(text)) {
    return canListCasesViaChat(context) ? { kind: "list_cases" } : { kind: "none" };
  }

  const select = matchesSelectCaseConsent(text);
  if (select.ok) {
    // Bare numbers only apply after a list was offered in this session.
    if (/^\d{1,3}$/.test(select.query) && !context.hasOfferedList) {
      return { kind: "ambiguous" };
    }
    return { kind: "select_case", query: select.query };
  }

  if (isVagueOnly(text) && /\b(?:case|cases|switch|list)\b/i.test(text)) {
    return { kind: "ambiguous" };
  }

  return { kind: "none" };
}

export function buildChatCaseSelectionAssistantResponse(
  result: Exclude<ChatCaseSelectionParseResult, { kind: "none" | "list_cases" | "select_case" }>
): string {
  switch (result.kind) {
    case "decline":
      return "Understood — I won't switch cases unless you ask.";
    case "ambiguous":
      return `I need a clearer case choice. First ask me to show your cases, then reply with a number or company name. For example: "${CHAT_CASE_SELECTION_LIST_MESSAGE}"`;
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

export function buildChatCaseSelectionOpenedResponse(details: {
  companyName?: string | null;
  restoredFromArchive?: boolean;
  alreadyActive?: boolean;
}): string {
  const label = details.companyName?.trim();
  if (details.alreadyActive) {
    return label
      ? `You're already working on your ${label} case here in chat.`
      : "You're already working on that case here in chat.";
  }
  if (details.restoredFromArchive) {
    return label
      ? `I've restored your archived case for ${label} and opened it here in chat.`
      : "I've restored that archived case and opened it here in chat.";
  }
  return label
    ? `I've opened your ${label} case here in chat.`
    : "I've opened that case here in chat.";
}

export function buildChatCaseSelectionNotFoundResponse(): string {
  return `I couldn't match that to one of your cases. Ask me to show your cases, then choose by number or company name.`;
}

export function buildChatCaseSelectionAmbiguousMatchResponse(): string {
  return "That matches more than one case. Ask me to show your cases, then choose by number.";
}

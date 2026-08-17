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

function normalizedMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function hasNegation(message: string): boolean {
  return NEGATION.test(message);
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

// STRICT START-TO-END COMMAND GRAMMAR. `select_case` runs immediately with no confirmation — it
// can restore an archived case on the server AND overwrite the consumer's active chat session
// with a different case's data. Recorded only when the ENTIRE message (after bounded
// normalization) matches a fixed verb + [article] + <slot> shape, anchored end-to-end.
//
// The name slot is QUOTE-DELIMITED, not extracted by guessing against surrounding English
// grammar. The parser does not — and structurally cannot — judge whether the quoted text "looks
// like" a real case name (no word list, no length rule): the user's own quote marks are the only
// thing that makes the boundary unambiguous. Whether that quoted text actually identifies exactly
// one real case is decided downstream by an EXACT, unique match against real company names
// (chatCaseSelectionList.ts) — never a substring/fuzzy match. Unquoted names are not accepted at
// all, so no leading question/conditional/hypothetical/third-person wording and no trailing
// qualifier can ever coexist with a match.
const SELECT_VERBS = "open|switch\\s+to|select|continue|resume|restore";

// Bounded, non-growing polite-affirmation prefix / trailing courtesy. Case is preserved (not
// lowercased) so a matched quoted name returns its original casing.
const SELECTION_PREFIX = /^(?:yes|yeah|okay|ok|sure|absolutely|confirmed|please)[\s,:.–-]+/i;
const SELECTION_SUFFIX = /\s+(?:in\s+chat|thanks|thank\s+you|please)$/i;

const SELECT_CASE_NUMBERED_TEMPLATES: readonly RegExp[] = [
  new RegExp(`^(?:${SELECT_VERBS})\\s+case\\s+(\\d{1,3})$`, "i"),
  /^case\s+(\d{1,3})$/i,
];
const SELECT_CASE_BARE_NUMBER = /^(\d{1,3})$/;

// Straight ("...") and curly (“...”) double quotes. The trailing "case" word is optional once the
// name is quoted, since the quotes already carry the disambiguation.
const SELECT_CASE_QUOTED_NAME_TEMPLATE = new RegExp(
  `^(?:${SELECT_VERBS})\\s+(?:the\\s+|my\\s+)?["“”]([^"“”]+)["“”](?:\\s+case)?$`,
  "i"
);

// Case names may legitimately contain "restore"/"case" etc., but this exact phrase is the
// separate "restore my most recently archived case" gate's territory — never this one's.
const RESTORE_MOST_RECENT_PATTERN = /\bmost\s+recent(?:ly\s+archived)?\b|\blatest\s+archived\b/i;

function toSelectionCore(message: string): string {
  let t = normalizedMessage(message);
  t = t.replace(SELECTION_PREFIX, "");
  t = t.replace(/[.,!;:?]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(SELECTION_SUFFIX, "").trim();
  return t;
}

/** Shared pre-check: non-empty, not a question, no negation. */
function isSelectionEligible(message: string): boolean {
  return Boolean(message.trim()) && !message.includes("?") && !hasNegation(message);
}

function matchesSelectCaseConsent(message: string): { ok: true; query: string } | { ok: false } {
  if (!isSelectionEligible(message)) return { ok: false };
  const core = toSelectionCore(message);
  if (RESTORE_MOST_RECENT_PATTERN.test(core)) return { ok: false };

  for (const template of SELECT_CASE_NUMBERED_TEMPLATES) {
    const numbered = core.match(template);
    if (numbered?.[1]) {
      return { ok: true, query: numbered[1] };
    }
  }

  const quotedName = core.match(SELECT_CASE_QUOTED_NAME_TEMPLATE);
  if (quotedName?.[1]) {
    const query = quotedName[1].trim();
    if (!query) return { ok: false };
    return { ok: true, query };
  }

  const bareNumber = core.match(SELECT_CASE_BARE_NUMBER);
  if (bareNumber?.[1]) {
    return { ok: true, query: bareNumber[1] };
  }

  return { ok: false };
}

// Broader than SELECT_VERBS on purpose: this only decides none-vs-ambiguous routing (never
// mutation), so it also recognizes past-tense mentions ("opened", "switched") that the strict
// grammar deliberately excludes.
const SELECTION_VERB_WORD =
  /\b(?:open(?:ed)?|switch(?:ed)?|select(?:ed)?|continu(?:e|ed)|resum(?:e|ed)|restor(?:e|ed))\b/i;

/**
 * True when a message clearly attempts case selection (a selection verb applied to "case") but
 * did not match the strict grammar — so it must resolve to `ambiguous` (an honest, non-mutating
 * "say it clearly" reply) rather than `none`, which would forward it to general chat instead of
 * ever confirming or denying a switch. Excludes the separate restore-most-recent gate's phrasing.
 */
function isNearSelectionAttempt(message: string): boolean {
  if (RESTORE_MOST_RECENT_PATTERN.test(message)) return false;
  return SELECTION_VERB_WORD.test(message) && /\bcase\b/i.test(message);
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

  if (isNearSelectionAttempt(text)) {
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
      return `I need a clearer case choice. First ask me to show your cases, then reply with a number or the exact case name in quotes (for example, open "Acme Retail"). For example: "${CHAT_CASE_SELECTION_LIST_MESSAGE}"`;
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
  return `I couldn't match that to one of your cases. Ask me to show your cases, then choose by number or the exact case name in quotes.`;
}

export function buildChatCaseSelectionAmbiguousMatchResponse(): string {
  return "That matches more than one case. Ask me to show your cases, then choose by number.";
}

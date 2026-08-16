import { validate as isUuid } from "uuid";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";

/** Canonical chat phrase for E2E: detach the active case and begin a fresh intake. */
export const CHAT_START_NEW_CASE_MESSAGE = "Start a new case";

export type ChatStartNewCaseContext = {
  isLoaded: boolean;
  isSignedIn: boolean;
  activeCaseId: string;
};

export type ChatStartNewCaseParseResult =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "decline" }
  | { kind: "no_active_case" }
  | { kind: "start_new_case" };

const NEGATION =
  /\b(?:don't|do\s+not|doesn'?t|didn'?t|won'?t|cannot|can't|never|not\s+yet|not\s+now|without)\b/i;

const VAGUE_ONLY =
  /^(?:yes|yep|yeah|ok|okay|sure|fine|good|great|thanks|thank\s+you|sounds?\s+good|looks?\s+good|new|start|create)\.?$/i;

function normalizedMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function hasNegation(message: string): boolean {
  return NEGATION.test(message);
}

function isVagueOnly(message: string): boolean {
  return VAGUE_ONLY.test(normalizedMessage(message));
}

// WHOLE-MESSAGE ALLOWLIST. `start_new_case` fires immediately with NO confirmation UI — it wipes
// the visible chat transcript and clears approval/evidence/task state for the active case (the
// server case is untouched, but from the consumer's view the current case appears to vanish).
// Recorded only when the ENTIRE message (after bounded normalization) exactly matches one of a
// small, fixed set of templates — the canonical phrase plus a few intentionally supported direct
// commands. Anchored end-to-end, so any conditional, deferred, hypothetical, historical, third-
// person, interrogative, or assistant-directed wording fails to match and is rejected, with no
// keyword blacklist to maintain.

// Bounded, non-growing polite-affirmation prefix stripped before matching. "please" is included
// here (unlike the closure gate) because it is never part of this gate's canonical phrase.
const START_NEW_CASE_PREFIX = /^(?:yes|yeah|okay|ok|sure|absolutely|confirmed|please)[\s,:.–-]+/i;
const START_NEW_CASE_SUFFIX = /\s+(?:thanks|thank you|please)$/i;

const START_NEW_CASE_TEMPLATES: readonly RegExp[] = [
  /^start a new case$/, // canonical
  /^start new case$/,
  /^create a new case$/,
  /^create new case$/,
  /^begin a new case$/,
  /^begin new case$/,
  /^begin a new case in chat$/,
  /^open a new case$/,
  /^open new case$/,
  /^i want a new case$/,
  /^i want new case$/,
  /^i want a brand new case$/,
  /^start over with a new case$/,
  /^start fresh with a new case$/,
  /^new case$/, // reached after SUFFIX strips a trailing "please"/"thanks" (e.g. "New case please")
  /^new case now$/,
];

function toStartNewCaseCore(message: string): string {
  let t = normalizedMessage(message).toLowerCase();
  t = t.replace(START_NEW_CASE_PREFIX, "");
  t = t.replace(/[.,!;:?]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(START_NEW_CASE_SUFFIX, "").trim();
  return t;
}

/** Shared pre-check: non-empty, not a question, no negation. */
function isStartNewCaseEligible(message: string): boolean {
  return Boolean(message.trim()) && !message.includes("?") && !hasNegation(message);
}

/**
 * Explicit consent to leave the active case and begin a genuinely separate case.
 * Only an exact whole-message template match — not a "new case / start over" substring anywhere
 * in the message — may satisfy this.
 */
function matchesStartNewCaseConsent(message: string): boolean {
  if (!isStartNewCaseEligible(message)) return false;
  const core = toStartNewCaseCore(message);
  return START_NEW_CASE_TEMPLATES.some((re) => re.test(core));
}

function matchesStartNewCaseDecline(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text) return false;
  if (!hasNegation(text) && !/\b(?:decline|refuse|cancel)\b/i.test(text)) return false;
  return /\b(?:new\s+case|start\s+over|start\s+fresh|create\s+(?:a\s+)?new)\b/i.test(text);
}

export function buildChatStartNewCaseGateContext(input: {
  isLoaded: boolean;
  isSignedIn: boolean;
  activeCaseId: string;
}): ChatStartNewCaseContext {
  return {
    isLoaded: input.isLoaded,
    isSignedIn: input.isSignedIn,
    activeCaseId: input.activeCaseId.trim(),
  };
}

export function hasActiveChatCaseForStartNew(context: ChatStartNewCaseContext): boolean {
  return Boolean(context.activeCaseId && isUuid(context.activeCaseId));
}

/** Start-new-case only when signed in with an active UUID case in session. */
export function canStartNewCaseViaChat(context: ChatStartNewCaseContext): boolean {
  if (!context.isLoaded || !context.isSignedIn) return false;
  return hasActiveChatCaseForStartNew(context);
}

export function parseChatStartNewCaseMessage(
  message: string,
  context: ChatStartNewCaseContext
): ChatStartNewCaseParseResult {
  const text = normalizedMessage(message);
  if (!text) return { kind: "none" };
  if (!context.isLoaded || !context.isSignedIn) return { kind: "none" };

  if (matchesStartNewCaseDecline(text)) {
    return { kind: "decline" };
  }

  if (matchesStartNewCaseConsent(text)) {
    if (!hasActiveChatCaseForStartNew(context)) {
      return { kind: "no_active_case" };
    }
    return canStartNewCaseViaChat(context) ? { kind: "start_new_case" } : { kind: "none" };
  }

  // Near-miss / vague wording must not detach an active case.
  if (
    hasActiveChatCaseForStartNew(context) &&
    (isVagueOnly(text) ||
      /\b(?:new\s+company|different\s+company|another\s+merchant|new\s+complaint)\b/i.test(
        text
      ))
  ) {
    return { kind: "ambiguous" };
  }

  if (
    hasActiveChatCaseForStartNew(context) &&
    /\bnew\s+case\b/i.test(text) &&
    !matchesStartNewCaseConsent(text)
  ) {
    return { kind: "ambiguous" };
  }

  return { kind: "none" };
}

export function buildChatStartNewCaseAssistantResponse(
  result: Exclude<ChatStartNewCaseParseResult, { kind: "none" | "start_new_case" }>
): string {
  switch (result.kind) {
    case "decline":
      return "Understood — I'll keep working on your current case unless you clearly ask to start a new one.";
    case "ambiguous":
      return `If you want a separate case (without changing your current one), say clearly: "${CHAT_START_NEW_CASE_MESSAGE}".`;
    case "no_active_case":
      return "You're not on a saved case in this browser yet — tell me about the problem and we can start here in chat.";
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

export function buildChatStartNewCaseStartedResponse(details?: {
  priorCaseId?: string | null;
}): string {
  const prior = details?.priorCaseId?.trim();
  const preserved = prior
    ? `Your previous case (${prior}) is still saved on your account and was not changed.`
    : "Your previous case is still saved on your account and was not changed.";
  return `${preserved} This chat is ready for a new case — share the new company and what happened, then save when your basics are ready.`;
}

/**
 * Clears local justice session keys so the next intake commit uses create → POST.
 * Does not touch the server case. Returns true when local storage was cleared.
 */
export function applyChatStartNewCaseLocalSessionReset(): {
  cleared: true;
  preserveServerCase: true;
} {
  clearLocalJusticeSession();
  return { cleared: true, preserveServerCase: true };
}

/**
 * In-memory transcript seed after start-new-case detach.
 * Prior-case turns are discarded so create-time backfill cannot persist them onto the new case.
 */
export function buildIsolatedStartNewCaseTranscript<T extends { text: string }>(input: {
  priorTurns: readonly T[];
  startNewTurns: readonly T[];
}): T[] {
  void input.priorTurns;
  return [...input.startNewTurns];
}

/** React staged-proof list after start-new: prior notes must not flush onto the next create. */
export function stagedProofNotesAfterStartNewCaseReset(
  priorNotes: readonly unknown[]
): [] {
  void priorNotes;
  return [];
}

/** React/UI transient fields that must reset with start-new (session clear alone is not enough). */
export function listChatStartNewCaseTransientClientResets(): readonly string[] {
  return [
    "messagesRef/transcript",
    "persistedTurnIdsRef",
    "transcriptCaseIdRef",
    "stagedProofNotes",
    "stagedProofFlushError",
    "approvedNextAction",
    "preparedPacketApproved",
    "submissionDraftReview",
    "savedEvidenceRows",
    "savedTasks",
    "savedFilings",
    "parts",
    "sessionBaselinePartsRef",
    "sessionBaselineEvidenceCountRef",
    "ownedFulfillmentSnapshotRef",
    "merchantContactAutopilotCaseRef",
    "proofKeywordNudgeOfferedRef",
    "isUpdatingExistingCase:false",
  ] as const;
}

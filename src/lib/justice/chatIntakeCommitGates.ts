/** Canonical chat phrase for E2E. */
export const CHAT_INTAKE_COMMIT_MESSAGE =
  "I've shared everything needed. Please save my case and continue in chat.";

export type ChatIntakeCommitContext = {
  caseId: string;
  intakeReady: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  isUpdatingExistingCase: boolean;
};

export type ChatIntakeCommitParseResult =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "decline" }
  | { kind: "wrong_stage" }
  | { kind: "intake_commit" };

const NEGATION =
  /\b(?:don't|do\s+not|doesn'?t|didn'?t|won'?t|cannot|can't|never|not\s+yet|not\s+ready|haven'?t|hasn'?t|without)\b/i;

const VAGUE_ONLY =
  /^(?:yes|yep|yeah|ok|okay|sure|fine|good|great|thanks|thank\s+you|sounds?\s+good|looks?\s+good|continue|save|ready)\.?$/i;

function normalizedMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function hasNegation(message: string): boolean {
  return NEGATION.test(message);
}

function isVagueOnly(message: string): boolean {
  return VAGUE_ONLY.test(normalizedMessage(message));
}

function matchesIntakeCommitConsent(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  return (
    /\b(?:please\s+)?save\s+my\s+case\b.*\bcontinue\b/i.test(text) ||
    /\bsave\s+(?:this\s+)?case\s+and\s+continue\b/i.test(text) ||
    /\bi(?:'ve|\s+have)\s+shared\s+everything\s+(?:needed|required)\b.*\b(?:save|continue)\b/i.test(text) ||
    /\bi(?:'m|\s+am)\s+ready\s+to\s+save\s+(?:this\s+)?case\b/i.test(text) ||
    /\bcommit\s+my\s+(?:intake|case)\b.*\bcontinue\b/i.test(text)
  );
}

function matchesIntakeCommitDecline(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text) return false;
  if (!hasNegation(text) && !/\b(?:decline|cancel|wait|hold)\b/i.test(text)) return false;
  return /\b(?:save|continue|commit|case|intake)\b/i.test(text);
}

function matchesIntakeCommitIntent(message: string): boolean {
  return matchesIntakeCommitConsent(message) || matchesIntakeCommitDecline(message);
}

export function buildChatIntakeCommitContext(input: {
  caseId: string;
  intakeReady: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  isUpdatingExistingCase: boolean;
}): ChatIntakeCommitContext {
  return {
    caseId: input.caseId.trim(),
    intakeReady: input.intakeReady,
    isLoaded: input.isLoaded,
    isSignedIn: input.isSignedIn,
    isUpdatingExistingCase: input.isUpdatingExistingCase,
  };
}

/** True when initial signed-in intake can be committed from chat (pre-prep phase). */
export function canCommitIntakeViaChat(context: ChatIntakeCommitContext): boolean {
  if (!context.intakeReady || !context.isLoaded || !context.isSignedIn) return false;
  return !context.isUpdatingExistingCase;
}

export function parseChatIntakeCommitMessage(
  message: string,
  context: ChatIntakeCommitContext
): ChatIntakeCommitParseResult {
  const text = normalizedMessage(message);
  if (!text) return { kind: "none" };

  if (!canCommitIntakeViaChat(context)) {
    if (context.isUpdatingExistingCase && matchesIntakeCommitIntent(text)) {
      return { kind: "wrong_stage" };
    }
    if (!context.intakeReady && matchesIntakeCommitIntent(text)) {
      return { kind: "ambiguous" };
    }
    return { kind: "none" };
  }

  if (matchesIntakeCommitDecline(text)) {
    return { kind: "decline" };
  }

  if (matchesIntakeCommitConsent(text)) {
    return { kind: "intake_commit" };
  }

  if (isVagueOnly(text) || /\b(?:save|continue|commit)\b/i.test(text)) {
    return { kind: "ambiguous" };
  }

  return { kind: "none" };
}

export function buildChatIntakeCommitAssistantResponse(
  result: Exclude<ChatIntakeCommitParseResult, { kind: "none" }>
): string {
  switch (result.kind) {
    case "intake_commit":
      return "I've saved your case. I'll show your submission draft next for review.";
    case "decline":
      return "Understood — I won't save your case until you confirm you're ready. Share anything else you need first.";
    case "wrong_stage":
      return "Your case is already saved. We'll handle the next steps from here in chat — no need to save intake again.";
    case "ambiguous":
      return "I need a clear statement that you're ready to save your case. For example: \"I've shared everything needed. Please save my case and continue in chat.\"";
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

import { HANDLING_TRACKING_STEP_COMPLETE } from "@/lib/justice/approvedNextActionHandlingDisplay";

export type ChatCaseClosureGate = "follow_up_handled" | "archive_case";

/** Canonical chat phrases for E2E. */
export const CHAT_CASE_CLOSURE_FOLLOW_UP_HANDLED_MESSAGE =
  "I have handled the follow-up for this case and it is complete.";

export const CHAT_CASE_CLOSURE_ARCHIVE_CASE_MESSAGE =
  "Please archive this case now. I am ready to close it.";

export type ChatCaseClosureContext = {
  caseId: string;
  resolutionFlowExposed: boolean;
  followUpNeeded: boolean;
  handlingTrackingStep: string | null;
  readinessLoading: boolean;
  /** When true, operator owns close after response-review — chat must not archive. */
  operatorOwnsClosure?: boolean;
};

export type ChatCaseClosureParseResult =
  | { kind: "none" }
  | { kind: "ambiguous"; gate: ChatCaseClosureGate }
  | { kind: "decline"; gate: ChatCaseClosureGate }
  | { kind: "premature_archive" }
  | { kind: "follow_up_handled" }
  | { kind: "archive_case" };

const NEGATION =
  /\b(?:don't|do\s+not|doesn'?t|didn'?t|won'?t|cannot|can't|never|not\s+yet|not\s+ready|haven'?t|hasn'?t|without)\b/i;

const VAGUE_ONLY =
  /^(?:yes|yep|yeah|ok|okay|sure|fine|good|great|thanks|thank\s+you|sounds?\s+good|looks?\s+good|done|finished)\.?$/i;

function normalizedMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

function hasNegation(message: string): boolean {
  return NEGATION.test(message);
}

function isVagueOnly(message: string): boolean {
  return VAGUE_ONLY.test(normalizedMessage(message));
}

function matchesFollowUpHandledConsent(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  return (
    /\bmark(?:\s+the)?\s+follow[- ]?up\s+(?:as\s+)?handled\b/i.test(text) ||
    /\bfollow[- ]?up\s+(?:is\s+)?(?:handled|complete|completed|done|finished)\b/i.test(text) ||
    /\b(?:no|not)\s+(?:any\s+)?further\s+follow[- ]?up\b/i.test(text) ||
    /\bi(?:'ve|\s+have)\s+handled\s+(?:the\s+)?follow[- ]?up\b/i.test(text)
  );
}

function matchesArchiveCaseConsent(message: string): boolean {
  const text = normalizedMessage(message);
  if (!text || hasNegation(text)) return false;
  return (
    /\barchive\s+(?:this\s+)?case\b/i.test(text) ||
    /\b(?:please\s+)?archive\s+my\s+case\b/i.test(text) ||
    /\bi(?:'m|\s+am)\s+ready\s+to\s+(?:archive|close)\s+(?:this\s+)?case\b/i.test(text) ||
    /\bclose\s+(?:this\s+)?case\s+(?:now|for\s+now)\b/i.test(text)
  );
}

function matchesDeclineForGate(message: string, gate: ChatCaseClosureGate): boolean {
  const text = normalizedMessage(message);
  if (!text) return false;
  if (!hasNegation(text) && !/\b(?:decline|refuse)\b/i.test(text)) return false;
  switch (gate) {
    case "follow_up_handled":
      return /\b(?:follow[- ]?up|handled|attention)\b/i.test(text);
    case "archive_case":
      return /\b(?:archive|close|closure)\b/i.test(text);
    default:
      return false;
  }
}

export function buildChatCaseClosureGateContext(input: {
  caseId: string;
  resolutionFlowExposed: boolean;
  followUpNeeded: boolean;
  handlingTrackingStep: string | null;
  readinessLoading: boolean;
  operatorOwnsClosure?: boolean;
}): ChatCaseClosureContext {
  return {
    caseId: input.caseId.trim(),
    resolutionFlowExposed: input.resolutionFlowExposed,
    followUpNeeded: input.followUpNeeded,
    handlingTrackingStep: input.handlingTrackingStep,
    readinessLoading: input.readinessLoading,
    ...(input.operatorOwnsClosure === true ? { operatorOwnsClosure: true as const } : {}),
  };
}

export function canClearFollowUpViaChat(context: ChatCaseClosureContext): boolean {
  if (!context.caseId.trim() || context.readinessLoading) return false;
  return context.resolutionFlowExposed && context.followUpNeeded;
}

export function canArchiveCaseViaChat(context: ChatCaseClosureContext): boolean {
  if (!context.caseId.trim()) return false;
  if (context.operatorOwnsClosure === true) return false;
  if (!context.resolutionFlowExposed || context.followUpNeeded) return false;
  return context.handlingTrackingStep === HANDLING_TRACKING_STEP_COMPLETE;
}

/** First pending closure gate for the active case, in ladder order. */
export function resolvePendingChatCaseClosureGate(
  context: ChatCaseClosureContext
): ChatCaseClosureGate | null {
  if (canClearFollowUpViaChat(context)) {
    return "follow_up_handled";
  }
  if (canArchiveCaseViaChat(context)) {
    return "archive_case";
  }
  return null;
}

/** Parse closure intent when archive is requested before follow-up is complete. */
export function parsePrematureArchiveIntent(
  message: string,
  context: ChatCaseClosureContext
): boolean {
  if (!context.resolutionFlowExposed || !context.followUpNeeded) return false;
  return matchesArchiveCaseConsent(message);
}

/** Parse a user message against the currently pending closure gate only. */
export function parseChatCaseClosureMessage(
  message: string,
  gate: ChatCaseClosureGate,
  context: ChatCaseClosureContext
): ChatCaseClosureParseResult {
  const text = normalizedMessage(message);
  if (!text) return { kind: "none" };

  if (gate === "follow_up_handled" && matchesArchiveCaseConsent(text)) {
    return { kind: "premature_archive" };
  }

  if (matchesDeclineForGate(text, gate)) {
    return { kind: "decline", gate };
  }

  switch (gate) {
    case "follow_up_handled":
      if (!canClearFollowUpViaChat(context)) return { kind: "none" };
      if (matchesFollowUpHandledConsent(text)) {
        return { kind: "follow_up_handled" };
      }
      if (isVagueOnly(text)) {
        return { kind: "ambiguous", gate };
      }
      return { kind: "none" };
    case "archive_case":
      if (!canArchiveCaseViaChat(context)) return { kind: "none" };
      if (matchesArchiveCaseConsent(text)) {
        return { kind: "archive_case" };
      }
      if (isVagueOnly(text) || matchesFollowUpHandledConsent(text)) {
        return { kind: "ambiguous", gate };
      }
      return { kind: "none" };
    default: {
      const _exhaustive: never = gate;
      return _exhaustive;
    }
  }
}

export function buildChatCaseClosureAssistantResponse(
  result: Exclude<ChatCaseClosureParseResult, { kind: "none" }>
): string {
  switch (result.kind) {
    case "follow_up_handled":
      return "I've marked follow-up as handled for this case. Say when you're ready to archive the case.";
    case "archive_case":
      return "Your case is archived. You can start a new matter here in chat whenever you're ready.";
    case "premature_archive":
      return "I can't archive yet — follow-up is still flagged on this case. Mark follow-up handled first, then archive when tracking is complete.";
    case "decline":
      if (result.gate === "follow_up_handled") {
        return "Understood — I'll keep follow-up flagged until you confirm it's handled.";
      }
      return "Understood — I won't archive this case without your explicit request.";
    case "ambiguous":
      if (result.gate === "follow_up_handled") {
        return "I need a clear statement that follow-up is handled. For example: \"I have handled the follow-up for this case and it is complete.\"";
      }
      return "I need a clear archive request before I can close the case. For example: \"Please archive this case now. I am ready to close it.\"";
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
